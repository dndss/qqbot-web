import assert from 'node:assert/strict'
import { createServer, get, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { handleMediaRequest } from '../src/media-download.ts'
import type { StoredMessage } from '../src/types.ts'
import { amrBytes, officialAudioPart, wavBytes } from './audio-fixture.ts'

test('WAV playback serves verified byte ranges without caching whole files', async (t) => {
  let mode = 'range'
  let accountId = 'account-a'
  let message: StoredMessage = {
    id: 'voice', conversationId: 'group:audio', direction: 'incoming', senderId: 'sender',
    senderName: 'Sender', timestamp: 1, content: '[音频]', status: 'received', parts: [officialAudioPart()],
  }
  const ranges: Array<string | undefined> = []
  let closed: (() => void) | undefined
  let aborted: (() => void) | undefined
  const upstream = createServer((request, response) => {
    const requested = request.headers.range
    ranges.push(requested)
    if (mode === 'expired') { response.writeHead(403); response.end('expired'); return }
    const bytes = mode === 'wrong-wav' ? amrBytes : wavBytes
    let start = 0
    let end = bytes.length - 1
    const isPartial = requested && !['ignore', 'unknown'].includes(mode)
    if (isPartial) {
      const [, first, last] = requested.match(/^bytes=(\d*)-(\d*)$/)!
      start = first ? Number(first) : Math.max(0, bytes.length - Number(last))
      end = first && last ? Math.min(Number(last), end) : end
    }
    if (mode === 'wrong-range' && requested !== 'bytes=0-63') { start++; end++ }
    const headers: Record<string, string | number> = { 'Content-Type': 'application/octet-stream' }
    if (mode !== 'unknown') headers['Content-Length'] = end - start + 1
    if (isPartial) headers['Content-Range'] = `bytes ${start}-${end}/${mode === 'oversized' ? 201 * 1024 * 1024 : bytes.length}`
    response.writeHead(isPartial ? 206 : 200, headers)
    if (mode === 'stall' && requested !== 'bytes=0-63') {
      response.once('close', () => closed?.())
      response.write(bytes.subarray(start, start + 1024))
    } else if (mode === 'unknown') {
      response.write(bytes.subarray(0, 1024))
      response.end(bytes.subarray(1024))
    } else {
      response.end(bytes.subarray(start, end + 1))
    }
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  const store = {
    getActiveAccount: () => ({ id: accountId, appid: 'test', secret: '', name: 'Test', sandbox: false }),
    getMessage: (conversation: string, id: string) => conversation === message.conversationId && id === message.id ? message : undefined,
  }
  const loader = async (source: URL, signal: AbortSignal, options?: { range?: string }): Promise<IncomingMessage> => {
    assert.equal(source.href, 'https://audio.example/copy.wav')
    if (mode === 'stall' && options?.range !== 'bytes=0-63') signal.addEventListener('abort', () => aborted?.(), { once: true })
    return new Promise((resolve, reject) => {
      get(origin, { signal, headers: options?.range ? { Range: options.range } : {} }, resolve).on('error', reject)
    })
  }
  const proxy = createServer(async (request, response) => {
    if (!await handleMediaRequest(request, response, new URL(request.url!, 'http://localhost'), store, loader)) {
      response.writeHead(404); response.end()
    }
  })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    proxy.closeAllConnections()
    upstream.closeAllConnections()
    await Promise.all([
      new Promise<void>((resolve) => proxy.close(() => resolve())),
      new Promise<void>((resolve) => upstream.close(() => resolve())),
    ])
  })
  const url = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/api/conversations/group%3Aaudio/messages/voice/audios/0/stream?accountId=account-a`
  const requestRange = (range: string) => fetch(url, { headers: { Range: range }, signal: AbortSignal.timeout(5000) })

  await t.test('full playback returns WAV with inline disposition', async () => {
    const response = await fetch(url)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'audio/wav')
    assert.match(response.headers.get('content-disposition')!, /^inline;/)
    assert.equal(response.headers.get('accept-ranges'), 'bytes')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wavBytes)
  })

  await t.test('closed, open, suffix and clamped ranges return exactly the requested bytes', async () => {
    for (const [range, start, end] of [
      ['bytes=0-63', 0, 63], ['bytes=100-199', 100, 199],
      ['bytes=120000-', 120000, wavBytes.length - 1],
      ['bytes=-100', wavBytes.length - 100, wavBytes.length - 1],
      ['bytes=120000-999999', 120000, wavBytes.length - 1],
      ['bytes=-999999', 0, wavBytes.length - 1],
    ] as const) {
      const before = ranges.length
      const response = await requestRange(range)
      assert.equal(response.status, 206, range)
      assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${wavBytes.length}`)
      assert.equal(response.headers.get('content-length'), String(end - start + 1))
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), wavBytes.subarray(start, end + 1))
      assert.deepEqual(ranges.slice(before), ['bytes=0-63', range])
    }
  })

  await t.test('unsatisfiable ranges report the total size; malformed or multiple ranges never reach upstream', async () => {
    const response = await requestRange(`bytes=${wavBytes.length}-`)
    assert.equal(response.status, 416)
    assert.equal(response.headers.get('content-range'), `bytes */${wavBytes.length}`)
    assert.equal(response.headers.get('content-disposition'), null)
    await response.json()
    const before = ranges.length
    for (const range of ['bytes=0-1,3-4', 'bytes=-0', 'bytes=10-1', 'bytes=9007199254740992-', 'seconds=0-2', 'bytes=-']) {
      assert.equal((await requestRange(range)).status, 400, range)
    }
    assert.equal(ranges.length, before)
  })

  await t.test('account, recall, missing WAV and unsupported original playback are rejected before fetching', async () => {
    const before = ranges.length
    accountId = 'account-b'
    assert.equal((await fetch(url)).status, 409)
    accountId = 'account-a'
    message.status = 'recalled'
    assert.equal((await fetch(url)).status, 404)
    message.status = 'received'
    message.parts = [{ type: 'audio', url: 'https://audio.example/original' }]
    assert.equal((await fetch(url)).status, 404)
    message.parts = [officialAudioPart()]
    assert.equal((await fetch(`${url}&format=original`)).status, 400)
    assert.equal((await fetch(url.replace('/audios/', '/videos/'))).status, 404)
    assert.equal(ranges.length, before)
  })

  await t.test('an upstream that ignores Range is sliced as a stream', async () => {
    mode = 'ignore'
    const response = await requestRange('bytes=2000-2099')
    assert.equal(response.status, 206)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wavBytes.subarray(2000, 2100))
  })

  await t.test('unknown upstream lengths safely fall back to a complete 200 response', async () => {
    mode = 'unknown'
    const response = await requestRange('bytes=100-199')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('accept-ranges'), 'none')
    assert.equal(response.headers.get('content-range'), null)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wavBytes)
  })

  await t.test('expired, non-WAV, oversized and mismatched partial responses fail explicitly', async () => {
    for (const [sourceMode, status] of [['expired', 502], ['wrong-wav', 502], ['oversized', 413], ['wrong-range', 502]] as const) {
      mode = sourceMode
      const response = await requestRange('bytes=100-199')
      assert.equal(response.status, status, sourceMode)
      assert.equal(response.headers.get('content-disposition'), null)
      assert.ok((await response.json()).error)
    }
  })

  await t.test('canceling playback closes the in-flight source immediately', async () => {
    mode = 'stall'
    const upstreamClosed = new Promise<void>((resolve) => { closed = resolve })
    const sourceAborted = new Promise<void>((resolve) => { aborted = resolve })
    const response = await requestRange('bytes=0-')
    const reader = response.body!.getReader()
    assert.ok((await reader.read()).value?.length)
    await reader.cancel()
    await Promise.race([
      Promise.all([upstreamClosed, sourceAborted]),
      new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('Playback source did not stop')), 2000); timer.unref() }),
    ])
  })
})
