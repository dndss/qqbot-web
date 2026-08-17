import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Bot, ReceiverMode } from 'qq-official-bot'
import { JsonStore } from './store.ts'
import type { BotConfig, Conversation, ConversationType, GroupBotState, IncomingMessageLike, SenderRole, StoredMessage } from './types.ts'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

const applicationDirectory = fileURLToPath(new URL('..', import.meta.url))
const publicDirectory = join(applicationDirectory, 'public')
const store = new JsonStore(join(applicationDirectory, 'data'))
const sseClients = new Set<ServerResponse>()
const port = Number.parseInt(process.env.WEB_QQ_PORT ?? '3210', 10)
const host = process.env.WEB_QQ_HOST ?? '127.0.0.1'

let bot: Bot | null = null
let botAppid = ''
let botAccountId = ''
let connectionState: ConnectionState = 'disconnected'
let connectionError = ''
const groupProfileRequests = new Map<string, Promise<Partial<Conversation>>>()
const groupBotStateRequests = new Map<string, Promise<GroupBotState>>()

await store.initialize()

function statusPayload() {
  const account = store.getActiveAccount()
  return {
    state: connectionState,
    error: connectionError,
    selfId: bot?.self_id ?? null,
    account: account ? { id: account.id, appid: account.appid, name: account.name } : null,
  }
}

function publish(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of sseClients) client.write(payload)
}

function setConnectionState(state: ConnectionState, error = ''): void {
  connectionState = state
  connectionError = error
  publish('status', statusPayload())
}

function shortId(value: string): string {
  if (value.length <= 12) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function openidAvatarUrl(openid: string): string | undefined {
  if (!botAppid || !openid) return undefined
  return `https://thirdqq.qlogo.cn/qqapp/${encodeURIComponent(botAppid)}/${encodeURIComponent(openid)}/100`
}

function senderRoles(event: IncomingMessageLike): SenderRole[] {
  const values = new Set<string>(
    (event.sender?.permissions ?? []).map((permission) => String(permission).toLowerCase()),
  )
  const explicitRole = event.sender?.member_role ?? event.member_role ?? event.author?.member_role
  if (explicitRole) values.add(explicitRole)

  const roles: SenderRole[] = []
  // SDK 的 User.Permission 枚举中 owner=4、admin=2；同时兼容官方字符串角色。
  if (values.has('owner') || values.has('4')) roles.push('owner')
  if (values.has('admin') || values.has('2') || values.has('channeladmin') || values.has('5')) roles.push('admin')
  return roles
}

async function getGroupProfile(groupOpenid: string): Promise<Partial<Conversation>> {
  const existing = store.getConversation(`group:${groupOpenid}`)
  if (existing?.groupMemberCount !== undefined || existing?.description || existing?.category || existing?.tags?.length) {
    return {
      title: existing.title,
      groupMemberCount: existing.groupMemberCount,
      description: existing.description,
      category: existing.category,
      tags: existing.tags,
    }
  }

  const pending = groupProfileRequests.get(groupOpenid)
  if (pending) return pending

  const request = (async (): Promise<Partial<Conversation>> => {
    if (!bot) return {}
    try {
      const info = await bot.getGroupInfo(groupOpenid)
      return {
        title: info.group_name || undefined,
        groupMemberCount: info.group_member_num,
        description: info.group_finger_memo || undefined,
        category: info.group_class_text || undefined,
        tags: Array.isArray(info.group_tags) ? info.group_tags : [],
      }
    } catch (error) {
      console.warn(`[GroupProfile] 获取群 ${shortId(groupOpenid)} 资料失败：${errorMessage(error)}`)
      return {}
    } finally {
      groupProfileRequests.delete(groupOpenid)
    }
  })()
  groupProfileRequests.set(groupOpenid, request)
  return request
}

async function getGroupBotState(
  groupOpenid: string,
  options: { force?: boolean; tolerateFailure?: boolean } = {},
): Promise<GroupBotState | undefined> {
  const existing = store.getConversation(`group:${groupOpenid}`)?.botState
  if (existing && !options.force) return existing

  const pending = groupBotStateRequests.get(groupOpenid)
  if (pending) return pending
  if (!bot) {
    if (options.tolerateFailure) return undefined
    throw new Error('机器人尚未连接')
  }

  const request = (async (): Promise<GroupBotState> => {
    const state = await bot!.getGroupBotState(groupOpenid)
    return {
      memberOpenid: state.member_openid,
      joinedAt: state.joined_at,
      allowProactiveMsg: state.allow_proactive_msg,
      recvMsgSetting: state.recv_msg_setting,
      memberRole: state.member_role,
      updatedAt: Date.now(),
    }
  })()
  groupBotStateRequests.set(groupOpenid, request)

  try {
    return await request
  } catch (error) {
    if (!options.tolerateFailure) throw error
    console.warn(`[GroupBotState] 获取群 ${shortId(groupOpenid)} 中的机器人状态失败：${errorMessage(error)}`)
    return undefined
  } finally {
    groupBotStateRequests.delete(groupOpenid)
  }
}

async function normalizeIncoming(event: IncomingMessageLike): Promise<{ conversation: Conversation; message: StoredMessage } | null> {
  const senderId = event.sender?.user_id ?? event.user_id ?? 'unknown'
  const senderName = event.sender?.user_name || `用户 ${shortId(senderId)}`
  const senderOpenid = event.sender?.user_openid || senderId
  const senderAvatarUrl = openidAvatarUrl(senderOpenid)
  let type: ConversationType
  let targetId: string
  let title: string
  let subtitle: string
  let profile: Partial<Conversation> = {}

  if (event.message_type === 'group' && event.group_id) {
    type = 'group'
    targetId = event.group_id
    const [groupProfile, botState] = await Promise.all([
      getGroupProfile(targetId),
      getGroupBotState(targetId, { tolerateFailure: true }),
    ])
    profile = { ...groupProfile, ...(botState ? { botState } : {}) }
    title = profile.title || event.group_name || `群聊 ${shortId(targetId)}`
    subtitle = 'QQ群聊'
  } else if (event.message_type === 'private' && event.user_id) {
    type = 'private'
    targetId = event.user_id
    title = senderName
    subtitle = 'C2C私聊'
  } else {
    return null
  }

  const conversationId = `${type}:${targetId}`
  const timestamp = event.timestamp ? event.timestamp * 1000 : Date.now()
  const content = event.raw_message?.trim() || '[暂不支持展示的消息]'
  return {
    conversation: {
      id: conversationId,
      type,
      targetId,
      title,
      subtitle,
      updatedAt: timestamp,
      unread: 0,
      lastMessage: content,
      ...(type === 'private' && senderAvatarUrl ? { avatarUrl: senderAvatarUrl } : {}),
      ...profile,
      title,
    },
    message: {
      id: event.message_id || event.id || randomUUID(),
      conversationId,
      direction: 'incoming',
      senderId,
      senderName,
      avatarUrl: senderAvatarUrl,
      roles: senderRoles(event),
      content,
      timestamp,
      status: 'received',
    },
  }
}

async function handleIncoming(event: IncomingMessageLike, accountId: string): Promise<void> {
  if (accountId !== botAccountId || accountId !== store.getActiveAccount()?.id) return
  const normalized = await normalizeIncoming(event)
  if (accountId !== botAccountId || accountId !== store.getActiveAccount()?.id) return
  if (!normalized) return
  await store.addMessage(normalized.conversation, normalized.message)
  publish('message', normalized)
}

async function connectBot(): Promise<void> {
  const account = store.getActiveAccount()
  const config = await store.getConfig()
  if (!account || !config?.appid || !config.secret) throw new Error('请先添加并选择 Bot 账号')
  if (bot) await disconnectBot()

  setConnectionState('connecting')
  const nextBot = new Bot({
    appid: config.appid,
    secret: config.secret,
    sandbox: config.sandbox,
    removeAt: false,
    logLevel: 'info',
    maxRetry: 10,
    intents: ['GROUP_AND_C2C_EVENT'],
    mode: ReceiverMode.WEBSOCKET,
  })

  const accountId = account.id
  nextBot.on('message.group', (event) => void handleIncoming(event as IncomingMessageLike, accountId))
  nextBot.on('message.private.friend', (event) => void handleIncoming(event as IncomingMessageLike, accountId))

  try {
    bot = nextBot
    botAppid = config.appid
    botAccountId = accountId
    await nextBot.start()
    setConnectionState('connected')
  } catch (error) {
    bot = null
    botAppid = ''
    botAccountId = ''
    setConnectionState('error', errorMessage(error))
    throw error
  }
}

async function disconnectBot(): Promise<void> {
  const current = bot
  bot = null
  botAppid = ''
  botAccountId = ''
  groupProfileRequests.clear()
  groupBotStateRequests.clear()
  if (current) await current.stop()
  setConnectionState('disconnected')
}

async function sendMessage(conversation: Conversation, content: string): Promise<StoredMessage> {
  if (!bot || connectionState !== 'connected') throw new Error('机器人尚未连接')
  let result: { id?: string; timestamp?: number }
  switch (conversation.type) {
    case 'private':
      result = await bot.sendPrivateMessage(conversation.targetId, content)
      break
    case 'group':
      result = await bot.sendGroupMessage(conversation.targetId, content)
      break
  }

  const message: StoredMessage = {
    id: result.id || randomUUID(),
    conversationId: conversation.id,
    direction: 'outgoing',
    senderId: bot.self_id || 'bot',
    senderName: '机器人',
    content,
    timestamp: result.timestamp ? result.timestamp * 1000 : Date.now(),
    status: 'sent',
  }
  await store.addMessage(conversation, message)
  publish('message', { conversation: store.getConversation(conversation.id), message })
  return message
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 64 * 1024) throw new Error('请求内容过大')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === '/api/status' && request.method === 'GET') {
    sendJson(response, 200, statusPayload())
    return true
  }

  if (url.pathname === '/api/config' && request.method === 'GET') {
    const account = store.getActiveAccount()
    sendJson(response, 200, {
      accountId: account?.id ?? null,
      name: account?.name ?? '',
      appid: account?.appid ?? '',
      sandbox: account?.sandbox ?? false,
      secretConfigured: Boolean(account?.secret),
    })
    return true
  }

  if (url.pathname === '/api/config' && request.method === 'PUT') {
    const payload = await readJson(request)
    const accountId = payload.accountId ? String(payload.accountId) : undefined
    const current = accountId
      ? store.listAccounts().find((account) => account.id === accountId)
      : null
    const activeAccount = store.getActiveAccount()
    const appid = String(payload.appid ?? '').trim()
    const providedSecret = String(payload.secret ?? '').trim()
    const existingSecret = accountId === activeAccount?.id ? activeAccount.secret : ''
    const secret = providedSecret || existingSecret
    const name = String(payload.name ?? '').trim() || `Bot ${appid}`
    if (!appid || !secret) throw new Error('AppID 和 Secret 均为必填项')
    if (accountId && !current) throw new Error('Bot 账号不存在')
    await disconnectBot()
    const saved = await store.saveAccount({ appid, secret, sandbox: payload.sandbox === true, name }, accountId)
    publish('reset', { accounts: store.listAccounts(), conversations: store.listConversations(), status: statusPayload() })
    sendJson(response, 200, { ok: true, accountId: saved.id })
    return true
  }

  if (url.pathname === '/api/accounts' && request.method === 'GET') {
    sendJson(response, 200, store.listAccounts())
    return true
  }

  if (url.pathname === '/api/accounts/select' && request.method === 'POST') {
    const payload = await readJson(request)
    const accountId = String(payload.accountId ?? '')
    if (!accountId) throw new Error('缺少 Bot 账号 ID')
    await disconnectBot()
    await store.selectAccount(accountId)
    publish('reset', { accounts: store.listAccounts(), conversations: store.listConversations(), status: statusPayload() })
    if (payload.connect !== false) {
      try {
        await connectBot()
      } catch {
        // 连接错误已写入 status，账号切换本身仍然成功。
      }
    }
    sendJson(response, 200, { accounts: store.listAccounts(), conversations: store.listConversations(), status: statusPayload() })
    return true
  }

  const accountDeleteMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)$/)
  if (accountDeleteMatch && request.method === 'DELETE') {
    const accountId = decodeURIComponent(accountDeleteMatch[1])
    if (store.getActiveAccount()?.id === accountId) await disconnectBot()
    await store.deleteAccount(accountId)
    publish('reset', { accounts: store.listAccounts(), conversations: store.listConversations(), status: statusPayload() })
    sendJson(response, 200, { accounts: store.listAccounts(), conversations: store.listConversations(), status: statusPayload() })
    return true
  }

  if (url.pathname === '/api/connect' && request.method === 'POST') {
    await connectBot()
    sendJson(response, 200, statusPayload())
    return true
  }

  if (url.pathname === '/api/disconnect' && request.method === 'POST') {
    await disconnectBot()
    sendJson(response, 200, statusPayload())
    return true
  }

  if (url.pathname === '/api/events' && request.method === 'GET') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    response.write(`event: status\ndata: ${JSON.stringify(statusPayload())}\n\n`)
    sseClients.add(response)
    request.on('close', () => sseClients.delete(response))
    return true
  }

  if (url.pathname === '/api/conversations' && request.method === 'GET') {
    sendJson(response, 200, store.listConversations())
    return true
  }

  const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/(messages|read)$/)
  if (conversationMatch) {
    const conversationId = decodeURIComponent(conversationMatch[1])
    const action = conversationMatch[2]
    const conversation = store.getConversation(conversationId)
    if (!conversation) {
      sendJson(response, 404, { error: '会话不存在' })
      return true
    }
    if (action === 'messages' && request.method === 'GET') {
      sendJson(response, 200, store.listMessages(conversationId, Number(url.searchParams.get('limit') ?? 200)))
      return true
    }
    if (action === 'messages' && request.method === 'POST') {
      const payload = await readJson(request)
      const content = String(payload.content ?? '').trim()
      if (!content) throw new Error('消息内容不能为空')
      if (content.length > 2000) throw new Error('消息不能超过 2000 个字符')
      sendJson(response, 201, await sendMessage(conversation, content))
      return true
    }
    if (action === 'read' && request.method === 'POST') {
      await store.markRead(conversationId)
      sendJson(response, 200, { ok: true })
      return true
    }
  }

  const botStateMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/bot-state$/)
  if (botStateMatch && request.method === 'POST') {
    const conversationId = decodeURIComponent(botStateMatch[1])
    const conversation = store.getConversation(conversationId)
    if (!conversation) {
      sendJson(response, 404, { error: '会话不存在' })
      return true
    }
    if (conversation.type !== 'group') {
      sendJson(response, 400, { error: '只有群聊会话支持机器人群内状态' })
      return true
    }
    const botState = await getGroupBotState(conversation.targetId, { force: true })
    const updated = await store.updateConversation(conversation.id, { botState })
    publish('conversation', updated)
    sendJson(response, 200, updated)
    return true
  }
  return false
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1)
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, '')
  const path = join(publicDirectory, safePath)
  try {
    const body = await readFile(path)
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': path.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    })
    response.end(body)
  } catch {
    sendJson(response, 404, { error: '资源不存在' })
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname.startsWith('/api/')) {
      if (!(await handleApi(request, response, url))) sendJson(response, 404, { error: '接口不存在' })
      return
    }
    await serveStatic(response, url.pathname)
  } catch (error) {
    console.error(error)
    sendJson(response, 400, { error: errorMessage(error) })
  }
})

server.listen(port, host, () => {
  console.log(`QQ 官方机器人 Web 工作台已启动：http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void disconnectBot().finally(() => server.close(() => process.exit(0)))
  })
}
