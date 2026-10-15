import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

// Execute the real server functions without its data initialization or HTTP listener.
const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8')
const lifecycleSource = source.slice(source.indexOf('async function connectBot()'), source.indexOf('interface SendMessageInput'))
const shutdownSource = source.slice(source.indexOf('function shutdown()'))
const compiled = stripTypeScriptTypes(`${lifecycleSource}\n${shutdownSource}`)

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture() {
  const instances: FakeBot[] = []
  const errors: unknown[][] = []
  const exits: number[] = []
  const process = Object.assign(new EventEmitter(), { exit: (code: number) => exits.push(code) })
  class FakeBot extends EventEmitter {
    stopCalls = 0
    constructor(..._arguments: unknown[]) {
      super()
      instances.push(this)
    }
    start(): Promise<void> { return Promise.resolve() }
    stop(): Promise<void> { this.stopCalls++; return Promise.resolve() }
  }
  const context = {
    Bot: FakeBot,
    ReceiverMode: { WEBSOCKET: 'websocket' },
    store: {
      getActiveAccount: () => ({ id: 'account-fixture' }),
      getConfig: async () => ({ appid: 'test-app', secret: 'test-only' }),
    },
    bot: null as FakeBot | null,
    botAppid: '',
    botAccountId: '',
    connectionOperation: 0,
    shuttingDown: false,
    shutdownPromise: null as Promise<void> | null,
    botStops: new WeakMap(),
    pendingBotStops: new Set<Promise<void>>(),
    failedBotStops: new Set<FakeBot>(),
    pendingMessages: new Set<Promise<void>>(),
    groupProfileRequests: new Map(),
    groupBotStateRequests: new Map(),
    forwardCacheRequests: new Map(),
    sseClients: new Set<{ end(): void }>(),
    server: { close: (callback: (error?: Error) => void) => callback() },
    state: 'disconnected',
    stateError: '',
    setConnectionState: (state: string, error = '') => { context.state = state; context.stateError = error },
    handleIncoming: async (_event: unknown, _account: string): Promise<void> => {},
    errorMessage: (error: unknown) => String((error as Error)?.message ?? error),
    console: { error: (...values: unknown[]) => errors.push(values) },
    process,
  }
  const api = runInNewContext(`${compiled}\n({ connectBot, disconnectBot, shutdown })`, context) as {
    connectBot(): Promise<void>
    disconnectBot(): Promise<void>
    shutdown(): Promise<void>
  }
  return { context, api, instances, errors, exits, process, FakeBot }
}

test('both message listeners contain synchronous throws and rejected promises without changing connection state', async () => {
  const { context, api, instances, errors } = fixture()
  await api.connectBot()
  for (const [index, eventType] of ['message.group', 'message.private.friend'].entries()) {
    context.handleIncoming = index === 0
      ? () => { throw new Error('sync failure') }
      : async () => { throw new Error('async failure') }
    instances[0].emit(eventType, { message_id: `message-${index}`, raw_message: 'private message body' })
    await Promise.all([...context.pendingMessages])
  }
  assert.equal(errors.length, 2)
  assert.match(String(errors[0]), /message.group account=account-fixture message=message-0/)
  assert.match(String(errors[1]), /message.private.friend/)
  assert.doesNotMatch(JSON.stringify(errors), /private message body|test-only/)
  assert.equal(context.state, 'connected')
  assert.equal(context.pendingMessages.size, 0)
})

test('constructor failure leaves an error state and start failure stops its instance while retaining the original error', async () => {
  const constructed = fixture()
  const constructorError = new Error('constructor failed')
  constructed.context.Bot = class extends constructed.FakeBot {
    constructor() { super(); throw constructorError }
  }
  await assert.rejects(constructed.api.connectBot(), (error) => error === constructorError)
  assert.equal(constructed.context.state, 'error')
  assert.equal(constructed.context.bot, null)

  const started = fixture()
  const startError = new Error('start failed')
  started.FakeBot.prototype.start = async () => { throw startError }
  started.FakeBot.prototype.stop = async function () { this.stopCalls++; throw new Error('cleanup failed') }
  await assert.rejects(started.api.connectBot(), (error) => error === startError)
  assert.equal(started.instances[0].stopCalls, 1)
  assert.equal(started.context.bot, null)
  assert.equal(started.context.stateError, 'start failed')
  assert.match(String(started.errors[0]), /cleanup failed/)
})

test('disconnect invalidates a connect still loading configuration', async () => {
  const { context, api, instances } = fixture()
  const config = deferred<{ appid: string; secret: string }>()
  context.store.getConfig = () => config.promise
  const connecting = api.connectBot()
  const failed = assert.rejects(connecting, /连接操作已取消/)
  await api.disconnectBot()
  config.resolve({ appid: 'test-app', secret: 'test-only' })
  await failed
  assert.equal(instances.length, 0)
  assert.equal(context.state, 'disconnected')
})

test('new connect wins over an earlier config request', async () => {
  const { context, api, instances } = fixture()
  const config = deferred<{ appid: string; secret: string }>()
  let requests = 0
  context.store.getConfig = () => ++requests === 1 ? config.promise : Promise.resolve({ appid: 'new-app', secret: 'test-only' })
  const first = assert.rejects(api.connectBot(), /连接操作已取消/)
  await api.connectBot()
  config.resolve({ appid: 'old-app', secret: 'test-only' })
  await first
  assert.equal(instances.length, 1)
  assert.equal(context.botAppid, 'new-app')
  assert.equal(context.state, 'connected')
})

test('disconnect during old stop cancels waiting connect and late start cannot overwrite a replacement', async () => {
  const first = fixture()
  await first.api.connectBot()
  const stopping = deferred()
  first.instances[0].stop = () => stopping.promise
  const connecting = first.api.connectBot()
  const cancelled = assert.rejects(connecting, /连接操作已取消/)
  await Promise.resolve()
  const disconnecting = first.api.disconnectBot()
  stopping.resolve()
  await Promise.all([cancelled, disconnecting])
  assert.equal(first.context.state, 'disconnected')
  assert.equal(first.instances.length, 1)

  const second = fixture()
  const starting = deferred()
  second.FakeBot.prototype.start = function () { return second.instances.indexOf(this) === 0 ? starting.promise : Promise.resolve() }
  const oldStart = second.api.connectBot()
  const oldFailure = assert.rejects(oldStart, /连接操作已取消/)
  for (let turn = 0; turn < 10 && !second.context.bot; turn++) await Promise.resolve()
  assert.ok(second.context.bot)
  await second.api.connectBot()
  starting.resolve()
  await oldFailure
  assert.equal(second.context.bot, second.instances[1])
  assert.equal(second.context.state, 'connected')
  assert.equal(second.instances[0].stopCalls, 1)
})

test('an older disconnect cannot clear a replacement connection state', async () => {
  const { context, api, instances } = fixture()
  await api.connectBot()
  const stopping = deferred()
  instances[0].stop = () => stopping.promise
  const disconnecting = api.disconnectBot()
  const reconnecting = api.connectBot()
  stopping.resolve()
  await Promise.all([disconnecting, reconnecting])
  assert.equal(context.bot, instances[1])
  assert.equal(context.state, 'connected')
})

test('disconnect failure is visible and shutdown closes SSE and waits for message work', async () => {
  const failed = fixture()
  await failed.api.connectBot()
  failed.instances[0].stop = async () => { throw new Error('stop failed') }
  await assert.rejects(failed.api.disconnectBot(), /stop failed/)
  assert.equal(failed.context.state, 'error')

  const { context, api, instances } = fixture()
  await api.connectBot()
  const message = deferred()
  context.handleIncoming = () => message.promise
  instances[0].emit('message.group', { id: 'test' })
  await Promise.resolve()
  let ended = 0
  context.sseClients.add({ end: () => { ended++ } })
  let closed = 0
  context.server.close = (callback) => { closed++; callback() }
  const closing = api.shutdown()
  assert.equal(api.shutdown(), closing)
  let settled = false
  void closing.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  await assert.rejects(api.connectBot(), /服务正在关闭/)
  message.resolve()
  await closing
  assert.equal(ended, 1)
  assert.equal(closed, 1)
  assert.equal(instances[0].stopCalls, 1)
  assert.equal(context.sseClients.size, 0)
})

test('registered signal handlers are idempotent and report cleanup failure through a nonzero exit', async () => {
  const failed = fixture()
  await failed.api.connectBot()
  const stopped = deferred()
  failed.instances[0].stop = () => stopped.promise
  failed.process.emit('SIGINT')
  failed.process.emit('SIGTERM')
  assert.deepEqual(failed.exits, [])
  stopped.reject(new Error('stop failed'))
  await failed.context.shutdownPromise!.catch(() => {})
  await Promise.resolve()
  assert.deepEqual(failed.exits, [1])
  assert.equal(failed.errors.length, 1)

  const successful = fixture()
  successful.process.emit('SIGTERM')
  await successful.context.shutdownPromise
  await Promise.resolve()
  assert.deepEqual(successful.exits, [0])
})

test('failed stops retain the old instance, block replacement until cleanup succeeds and can be retried', async () => {
  const { context, api, instances } = fixture()
  await api.connectBot()
  const current = instances[0]
  let fail = true
  let attempts = 0
  current.stop = async () => {
    attempts++
    if (fail) throw new Error('resources still open')
  }
  await assert.rejects(api.disconnectBot(), /resources still open/)
  await assert.rejects(api.connectBot(), /resources still open/)
  assert.equal(instances.length, 1)
  assert.equal(context.failedBotStops.has(current), true)
  assert.equal(context.state, 'error')
  fail = false
  await api.disconnectBot()
  assert.equal(context.failedBotStops.size, 0)
  await api.connectBot()
  assert.equal(context.bot, instances[1])
  assert.equal(context.state, 'connected')
  assert.equal(attempts, 3)
})

test('shutdown waits for all started cleanup tasks even if one fails immediately', async () => {
  const { context, FakeBot, process, exits } = fixture()
  const failed = new FakeBot()
  const slow = new FakeBot()
  const stopped = deferred()
  failed.stop = async () => { throw new Error('first stop failed') }
  slow.stop = () => stopped.promise
  context.failedBotStops.add(failed)
  context.failedBotStops.add(slow)
  process.emit('SIGTERM')
  for (let turn = 0; turn < 10; turn++) await Promise.resolve()
  assert.deepEqual(exits, [])
  assert.equal(context.pendingBotStops.size, 1)
  stopped.resolve()
  await context.shutdownPromise!.catch(() => {})
  await Promise.resolve()
  assert.deepEqual(exits, [1])
  assert.equal(context.pendingBotStops.size, 0)
  assert.equal(context.failedBotStops.has(failed), true)
  assert.equal(context.failedBotStops.has(slow), false)
})

test('shutdown reports every failed instance cleanup without dumping error objects', async () => {
  const { context, FakeBot, process, errors, exits } = fixture()
  for (const message of ['first cleanup failed', 'second cleanup failed']) {
    const current = new FakeBot()
    current.stop = async () => { throw Object.assign(new Error(message), { request: { secret: 'do-not-log' } }) }
    context.failedBotStops.add(current)
  }
  process.emit('SIGTERM')
  await context.shutdownPromise!.catch(() => {})
  await Promise.resolve()
  assert.deepEqual(exits, [1])
  assert.equal(errors.length, 2)
  assert.match(String(errors[0]), /first cleanup failed/)
  assert.match(String(errors[1]), /second cleanup failed/)
  assert.doesNotMatch(JSON.stringify(errors), /do-not-log/)
})
