import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Bot, ReceiverMode, segment } from 'qq-official-bot'
import { MediaCache } from './media-cache.ts'
import { JsonStore } from './store.ts'
import type { BotConfig, Conversation, ConversationType, GroupBotState, IncomingMessageLike, MessagePart, SenderRole, StoredMessage } from './types.ts'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

const applicationDirectory = fileURLToPath(new URL('..', import.meta.url))
const publicDirectory = join(applicationDirectory, 'public')
const dataDirectory = join(applicationDirectory, 'data')
const store = new JsonStore(dataDirectory)
const mediaCache = new MediaCache(dataDirectory)
const sseClients = new Set<ServerResponse>()

async function loadServerConfig(): Promise<{ host: string; port: number }> {
  let fileConfig: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(await readFile(join(applicationDirectory, 'server.config.json'), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('配置内容必须是 JSON 对象')
    fileConfig = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`读取 server.config.json 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const host = process.env.WEB_QQ_HOST?.trim() || String(fileConfig.host ?? '127.0.0.1').trim()
  const port = Number(process.env.WEB_QQ_PORT?.trim() || fileConfig.port || 3210)
  if (!host) throw new Error('WEB_QQ_HOST 或 server.config.json 中的 host 不能为空')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('WEB_QQ_PORT 或 server.config.json 中的 port 必须是 1 到 65535 之间的整数')
  }
  return { host, port }
}

const { host, port } = await loadServerConfig()

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

function messageElementUrl(data: Record<string, unknown>): string | undefined {
  const value = typeof data.url === 'string'
    ? data.url
    : typeof data.file === 'string'
      ? data.file
      : ''
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

async function normalizeMessagePart(
  element: NonNullable<IncomingMessageLike['message']>[number],
  accountId: string,
): Promise<MessagePart | undefined> {
  const type = String(element.type ?? '').toLowerCase()
  const data = element.data && typeof element.data === 'object' ? element.data : {}
  switch (type) {
    case 'text': {
      const text = String(data.text ?? '')
      return text ? { type: 'text', text } : undefined
    }
    case 'image': {
      const url = messageElementUrl(data)
      if (!url) return { type: 'unsupported', label: '[无法读取的图片]' }
      const localUrl = await mediaCache.cacheImage(accountId, url)
      const name = typeof data.name === 'string' ? data.name : undefined
      return { type: 'image', url, ...(localUrl ? { localUrl } : {}), ...(name ? { name } : {}) }
    }
    case 'face': {
      const id = String(data.id ?? '')
      const text = typeof data.text === 'string' && data.text.trim() ? data.text.trim() : undefined
      return { type: 'face', id, ...(text ? { text } : {}) }
    }
    case 'at': {
      const userId = String(data.user_id ?? '')
      const nameValue = data.user_name ?? data.username ?? data.name
      const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : undefined
      return { type: 'at', userId, ...(name ? { name } : {}) }
    }
    case 'reply':
      return { type: 'reply', messageId: String(data.message_id ?? data.id ?? '') }
    case 'video':
    case 'audio':
    case 'file': {
      const url = messageElementUrl(data)
      const nameValue = data.name ?? data.filename
      const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : undefined
      return { type, ...(url ? { url } : {}), ...(name ? { name } : {}) }
    }
    case 'markdown': {
      const text = String(data.content ?? '')
      return text ? { type: 'text', text } : { type: 'unsupported', label: '[Markdown 消息]' }
    }
    case 'forward':
      return { type: 'unsupported', label: '[合并转发消息]' }
    default:
      return type ? { type: 'unsupported', label: `[${type} 消息]` } : undefined
  }
}

async function normalizeMessageParts(event: IncomingMessageLike, accountId: string): Promise<MessagePart[]> {
  if (!Array.isArray(event.message)) return []
  const parts = await Promise.all(event.message.map((element) => normalizeMessagePart(element, accountId)))
  return parts.filter((part): part is MessagePart => Boolean(part))
}

function messagePreview(parts: MessagePart[]): string {
  return parts.map((part) => {
    switch (part.type) {
      case 'text': return part.text
      case 'image': return '[图片]'
      case 'face': return part.text || `[表情${part.id ? ` ${part.id}` : ''}]`
      case 'at': return `@${part.name || (part.userId === 'all' ? '所有人' : shortId(part.userId))}`
      case 'reply': return '[回复]'
      case 'video': return '[视频]'
      case 'audio': return '[音频]'
      case 'file': return `[文件${part.name ? `：${part.name}` : ''}]`
      case 'unsupported': return part.label
    }
  }).join('').trim()
}

function messageSceneIndexes(event: IncomingMessageLike): { msgIdx?: string; refMsgIdx?: string } {
  let msgIdx = event.msg_idx
  let refMsgIdx: string | undefined
  const ext = Array.isArray(event.message_scene?.ext) ? event.message_scene.ext : []
  for (const value of ext) {
    if (typeof value !== 'string') continue
    if (value.startsWith('msg_idx=')) msgIdx = value.slice('msg_idx='.length)
    else if (value.startsWith('msgidx=')) msgIdx = value.slice('msgidx='.length)
    else if (value.startsWith('ref_msg_idx=')) refMsgIdx = value.slice('ref_msg_idx='.length)
    else if (value.startsWith('refmsgidx=')) refMsgIdx = value.slice('refmsgidx='.length)
  }
  return { ...(msgIdx ? { msgIdx } : {}), ...(refMsgIdx ? { refMsgIdx } : {}) }
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

async function normalizeIncoming(event: IncomingMessageLike, accountId: string): Promise<{ conversation: Conversation; message: StoredMessage } | null> {
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
  const parts = await normalizeMessageParts(event, accountId)
  const content = messagePreview(parts) || event.raw_message?.trim() || '[暂不支持展示的消息]'
  const indexes = messageSceneIndexes(event)
  return {
    conversation: {
      id: conversationId,
      type,
      targetId,
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
      senderOpenid,
      senderName,
      avatarUrl: senderAvatarUrl,
      roles: senderRoles(event),
      content,
      ...(parts.length ? { parts } : {}),
      ...indexes,
      timestamp,
      status: 'received',
    },
  }
}

async function handleIncoming(event: IncomingMessageLike, accountId: string): Promise<void> {
  if (accountId !== botAccountId || accountId !== store.getActiveAccount()?.id) return
  const normalized = await normalizeIncoming(event, accountId)
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

interface SendMessageInput {
  content: string
  reply?: { messageId: string; quote: boolean }
  mentions?: Array<{ messageId: string; token: string }>
}

function markdownContent(conversation: Conversation, input: SendMessageInput): string {
  let content = input.content.replace(/@/g, '@\u200b').replace(/<qqbot-/g, '<qqbot-\u200b')
  if (conversation.type !== 'group') return content
  for (const mention of input.mentions ?? []) {
    const target = store.getMessage(conversation.id, mention.messageId)
    if (!target?.senderOpenid || target.direction !== 'incoming') continue
    const token = mention.token.trim()
    if (!token) continue
    const escapedToken = token.replace(/@/g, '@\u200b').replace(/<qqbot-/g, '<qqbot-\u200b')
    const index = content.indexOf(escapedToken)
    if (index < 0) continue
    const tag = `<qqbot-at-user id="${target.senderOpenid}" />`
    content = `${content.slice(0, index)}${tag}${content.slice(index + escapedToken.length)}`
  }
  return content
}

async function sendMessage(conversation: Conversation, input: SendMessageInput): Promise<StoredMessage> {
  if (!bot || connectionState !== 'connected') throw new Error('机器人尚未连接')
  const replyTarget = input.reply ? store.getMessage(conversation.id, input.reply.messageId) : undefined
  if (input.reply && !replyTarget) throw new Error('回复的消息不存在')
  if (input.reply?.quote && !replyTarget?.msgIdx) throw new Error('该消息没有引用索引，无法引用回复')
  const source = replyTarget ? { id: replyTarget.id, msg_idx: replyTarget.msgIdx } : undefined
  const sendable = segment.markdown(markdownContent(conversation, input))
  let result: { id?: string; timestamp?: number; ext_info?: { ref_idx?: string } }
  switch (conversation.type) {
    case 'private':
      result = await bot.sendPrivateMessage(conversation.targetId, sendable, source, { quote: input.reply?.quote === true })
      break
    case 'group':
      result = await bot.sendGroupMessage(conversation.targetId, sendable, source, { quote: input.reply?.quote === true })
      break
  }

  const message: StoredMessage = {
    id: result.id || randomUUID(),
    conversationId: conversation.id,
    direction: 'outgoing',
    senderId: bot.self_id || 'bot',
    senderName: '机器人',
    content: input.content,
    parts: [{ type: 'text', text: input.content }],
    ...(result.ext_info?.ref_idx ? { msgIdx: result.ext_info.ref_idx } : {}),
    ...(input.reply?.quote && replyTarget?.msgIdx ? { refMsgIdx: replyTarget.msgIdx } : {}),
    timestamp: result.timestamp ? result.timestamp * 1000 : Date.now(),
    status: 'sent',
  }
  await store.addMessage(conversation, message)
  publish('message', { conversation: store.getConversation(conversation.id), message })
  return message
}

async function recallMessage(conversation: Conversation, messageId: string): Promise<StoredMessage> {
  if (!bot || connectionState !== 'connected') throw new Error('机器人尚未连接')
  const message = store.getMessage(conversation.id, messageId)
  if (!message) throw new Error('消息不存在')
  if (message.direction !== 'outgoing') throw new Error('只能撤回当前 Bot 发送的消息')
  if (message.status === 'recalled') return message
  const recalled = conversation.type === 'private'
    ? await bot.recallPrivateMessage(conversation.targetId, message.id)
    : await bot.recallGroupMessage(conversation.targetId, message.id)
  if (!recalled) throw new Error('QQ 接口未确认消息撤回成功')
  const updated = await store.updateMessage(conversation.id, message.id, {
    content: '[消息已撤回]',
    parts: [],
    status: 'recalled',
    recalledAt: Date.now(),
  })
  publish('message-update', updated)
  return updated
}

async function setMemberMute(
  conversation: Conversation,
  messageId: string,
  durationMinutes: number,
): Promise<{ ok: true; mutedUntil: string | null }> {
  if (!bot || connectionState !== 'connected') throw new Error('机器人尚未连接')
  if (conversation.type !== 'group') throw new Error('只有群聊支持成员禁言')
  const message = store.getMessage(conversation.id, messageId)
  if (!message?.senderOpenid || message.direction !== 'incoming') throw new Error('无法确定该群成员的 OpenID')
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 43_200) {
    throw new Error('禁言时长必须在 1 到 43200 分钟之间，解除禁言请使用 0')
  }

  const setting = await bot.getGroupRestrictChatSetting(conversation.targetId)
  const alreadyMuted = setting.members.some((member) => member.member_openid === message.senderOpenid)
  const mutedUntil = durationMinutes === 0
    ? null
    : new Date(Date.now() + durationMinutes * 60_000).toISOString()
  await bot.setGroupMemberMuteState(conversation.targetId, [{
    op: durationMinutes === 0 ? 'del' : alreadyMuted ? 'update' : 'add',
    member_openid: message.senderOpenid,
    mute_expire_at: mutedUntil ?? '',
  }])
  return { ok: true, mutedUntil }
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
    const current = accountId ? store.getAccount(accountId) : undefined
    const appid = String(payload.appid ?? '').trim()
    const providedSecret = String(payload.secret ?? '').trim()
    const existingSecret = current?.secret ?? ''
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
      const replyValue = payload.reply
      const replyRecord = replyValue && typeof replyValue === 'object' && !Array.isArray(replyValue)
        ? replyValue as Record<string, unknown>
        : undefined
      const replyMessageId = String(replyRecord?.messageId ?? '').trim()
      const mentions = Array.isArray(payload.mentions)
        ? payload.mentions.slice(0, 20).flatMap((value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return []
          const record = value as Record<string, unknown>
          const messageId = String(record.messageId ?? '').trim()
          const token = String(record.token ?? '').trim()
          return messageId && token ? [{ messageId, token }] : []
        })
        : []
      sendJson(response, 201, await sendMessage(conversation, {
        content,
        ...(replyMessageId ? { reply: { messageId: replyMessageId, quote: replyRecord?.quote === true } } : {}),
        ...(mentions.length ? { mentions } : {}),
      }))
      return true
    }
    if (action === 'read' && request.method === 'POST') {
      await store.markRead(conversationId)
      sendJson(response, 200, { ok: true })
      return true
    }
  }

  const messageActionMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/)
  if (messageActionMatch && request.method === 'DELETE') {
    const conversationId = decodeURIComponent(messageActionMatch[1])
    const messageId = decodeURIComponent(messageActionMatch[2])
    const conversation = store.getConversation(conversationId)
    if (!conversation) {
      sendJson(response, 404, { error: '会话不存在' })
      return true
    }
    sendJson(response, 200, await recallMessage(conversation, messageId))
    return true
  }

  const memberMuteMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/members\/([^/]+)\/mute$/)
  if (memberMuteMatch && request.method === 'POST') {
    const conversationId = decodeURIComponent(memberMuteMatch[1])
    const messageId = decodeURIComponent(memberMuteMatch[2])
    const conversation = store.getConversation(conversationId)
    if (!conversation) {
      sendJson(response, 404, { error: '会话不存在' })
      return true
    }
    const payload = await readJson(request)
    const durationMinutes = Number(payload.durationMinutes)
    sendJson(response, 200, await setMemberMute(conversation, messageId, durationMinutes))
    return true
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

async function serveMedia(response: ServerResponse, pathname: string): Promise<void> {
  const match = pathname.match(/^\/media\/([^/]+)\/([^/]+)$/)
  const accountId = match ? decodeURIComponent(match[1]) : ''
  const filename = match ? decodeURIComponent(match[2]) : ''
  const path = mediaCache.mediaPath(accountId, filename)
  const contentType = mediaCache.contentType(filename)
  if (!path || !contentType) {
    sendJson(response, 404, { error: '媒体资源不存在' })
    return
  }
  try {
    const body = await readFile(path)
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(body)
  } catch {
    sendJson(response, 404, { error: '媒体资源不存在' })
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname.startsWith('/api/')) {
      if (!(await handleApi(request, response, url))) sendJson(response, 404, { error: '接口不存在' })
      return
    }
    if (url.pathname.startsWith('/media/')) {
      await serveMedia(response, url.pathname)
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
