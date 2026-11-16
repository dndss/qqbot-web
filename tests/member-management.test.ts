import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { JsonStore } from '../src/store.ts'
import type { Conversation, StoredMessage } from '../src/types.ts'

const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8')
const { Bot, MessageEvent } = createRequire(import.meta.url)('qq-official-bot')
const compiled = stripTypeScriptTypes(source.slice(source.indexOf('function requireCurrentBot('), source.indexOf('function errorMessage(')))
const normalizer = stripTypeScriptTypes(source.slice(source.indexOf('async function normalizeIncoming('), source.indexOf('async function handleIncoming(')))
const group: Conversation = { id: 'group:g', type: 'group', targetId: 'g', title: '测试群', subtitle: '', updatedAt: 0, unread: 0, lastMessage: '' }
const contact: Conversation = { ...group, id: 'private:u', type: 'private', targetId: 'u', title: '旧昵称' }
const message: StoredMessage = { id: 'm', conversationId: group.id, direction: 'incoming', senderId: 'member', senderOpenid: 'member', senderName: '成员', content: '', timestamp: 1, status: 'received' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

function fixture() {
  const conversations = new Map([group, contact].map((item) => [item.id, structuredClone(item)]))
  const messages = new Map([[message.id, structuredClone(message)]])
  const calls: unknown[] = []
  const events: unknown[] = []
  const context = {
    bot: {
      getUserInfo: async (openid: string) => { calls.push(openid); return { username: '新昵称', avatar: 'https://example.com/avatar.png', allow_proactive_msg: false, union_openid: 'unused' } },
      batchRemoveGroupMembers: async (groupId: string, members: string[]) => { calls.push([groupId, [...members]]); return { remove_members_result: 'success' } },
    },
    botAccountId: 'account', botAppid: 'app', connectionState: 'connected', connectionOperation: 1, shuttingDown: false,
    userProfileRequests: new Map(), memberRemovalRequests: new Set(), userProfileCallTimes: new WeakMap(), memberRemovalCallTimes: new WeakMap(),
    store: {
      getActiveAccount: () => ({ id: 'account' }),
      getConversation: (id: string) => conversations.get(id),
      getMessage: (conversationId: string, id: string) => messages.get(id)?.conversationId === conversationId ? messages.get(id) : undefined,
      updateConversation: async (id: string, patch: Partial<Conversation>) => {
        const updated = { ...conversations.get(id)!, ...patch }
        conversations.set(id, updated)
        return structuredClone(updated)
      },
    },
    publish: (...args: unknown[]) => events.push(args), errorMessage: (error: Error) => error.message,
    shortId: (id: string) => id, openidAvatarUrl: () => 'https://example.com/fallback.png',
    getGroupDetails: async () => ({}), normalizeMessageParts: async () => [], messagePreview: () => '', senderRoles: () => [], messageSceneIndexes: () => ({}), randomUUID: () => 'generated',
  }
  const api = runInNewContext(`${compiled}\n${normalizer}\n({ refreshUserProfile, removeGroupMember, normalizeIncoming })`, context)
  return { context, api, calls, events, conversations, messages }
}

test('installed SDK exposes the new APIs and carries actual group nicknames into Web messages', async () => {
  assert.equal(typeof Bot.prototype.getUserInfo, 'function')
  assert.equal(typeof Bot.prototype.batchRemoveGroupMembers, 'function')
  const event = MessageEvent.parse.call({ removeAt() {}, logger: { info() {} } }, 'message.group', {
    id: 'sdk-event', message_type: 0, group_id: 'g', timestamp: '2026-11-16T12:00:00+08:00', content: '内容',
    author: { id: 'member', member_openid: 'member', username: 'QQ昵称', member_nickname: '实际群名片' },
  })
  const { api } = fixture()
  assert.equal((await api.normalizeIncoming(event, 'account')).message.senderName, '实际群名片')
})

test('group display names prefer member nickname with existing fallbacks; private names ignore group nicknames', async () => {
  const { api } = fixture()
  const event = { message_type: 'group', group_id: 'g', sender: { user_openid: 'member', user_name: 'QQ昵称', member_nickname: '群名片' } }
  assert.equal((await api.normalizeIncoming(event, 'account')).message.senderName, '群名片')
  assert.equal((await api.normalizeIncoming({ ...event, sender: { ...event.sender, member_nickname: undefined } }, 'account')).message.senderName, 'QQ昵称')
  assert.equal((await api.normalizeIncoming({ ...event, sender: { user_id: 'member', user_openid: 'member' } }, 'account')).message.senderName, '用户 member')
  const privateMessage = await api.normalizeIncoming({ ...event, message_type: 'private', user_id: 'u' }, 'account')
  assert.equal(privateMessage.message.senderName, 'QQ昵称')
})

test('profile requests coalesce, persist only needed fields and retain refreshed details on incoming messages', async () => {
  const { api, context, calls, conversations, events } = fixture()
  const pending = deferred<any>()
  context.bot.getUserInfo = async (id) => { calls.push(id); return pending.promise }
  const first = api.refreshUserProfile(contact, 'account')
  const second = api.refreshUserProfile(contact, 'account')
  assert.equal(calls.length, 1)
  pending.resolve({ username: '资料昵称', avatar: 'https://example.com/profile.png', allow_proactive_msg: false, union_openid: 'unused' })
  await Promise.all([first, second])
  const updated = conversations.get(contact.id)!
  assert.equal(updated.title, '资料昵称')
  assert.equal(updated.userProfile?.allowProactiveMsg, false)
  assert.equal('union_openid' in updated.userProfile!, false)
  assert.equal(events.length, 1)
  const incoming = await api.normalizeIncoming({ message_type: 'private', user_id: 'u', sender: { user_name: '旧昵称' } }, 'account')
  assert.equal(incoming.conversation.title, '资料昵称')
  assert.equal(incoming.conversation.avatarUrl, updated.avatarUrl)
  await assert.rejects(api.refreshUserProfile(group, 'account'), /只有私聊/)
  await assert.rejects(api.refreshUserProfile(contact, 'other-account'), /账号已切换/)
  await assert.rejects(api.refreshUserProfile(contact, 'account'), /过于频繁/)
})

test('late profile responses after account changes or reconnects cannot save or publish', async () => {
  for (const change of ['account', 'connection']) {
    const { api, context, conversations, events } = fixture()
    const pending = deferred<any>()
    context.bot.getUserInfo = () => pending.promise
    const request = api.refreshUserProfile(contact, 'account')
    if (change === 'account') context.store.getActiveAccount = () => ({ id: 'other' })
    else context.connectionOperation++
    pending.resolve({ username: '不应写入', avatar: '', allow_proactive_msg: true })
    await assert.rejects(request, /已切换|已变化/)
    assert.equal(conversations.get(contact.id)?.userProfile, undefined)
    assert.equal(events.length, 0)
    assert.equal(context.userProfileRequests.size, 0)
  }
})

test('failed profile queries retain cached information and explain missing friendship', async () => {
  const { api, context, conversations } = fixture()
  conversations.get(contact.id)!.userProfile = { username: '缓存', avatar: '', allowProactiveMsg: true, updatedAt: 1 }
  context.bot.getUserInfo = async () => { throw { response: { data: { code: 40184001 } } } }
  await assert.rejects(api.refreshUserProfile(contact, 'account'), /没有好友关系.*40184001/)
  assert.equal(conversations.get(contact.id)?.userProfile?.username, '缓存')
})

test('removal resolves the target from stored messages, blocks unsafe targets and keeps chat history', async () => {
  const { api, context, calls, messages, events } = fixture()
  await assert.rejects(api.removeGroupMember(contact, message.id, 'account'), /只有群聊/)
  await assert.rejects(api.removeGroupMember(group, 'missing', 'account'), /无法确定/)
  messages.get(message.id)!.roles = ['admin']
  await assert.rejects(api.removeGroupMember(group, message.id, 'account'), /群主或管理员/)
  messages.get(message.id)!.roles = []
  messages.get(message.id)!.direction = 'outgoing'
  await assert.rejects(api.removeGroupMember(group, message.id, 'account'), /无法确定/)
  messages.get(message.id)!.direction = 'incoming'
  const ownGroup = { ...group, botState: { memberOpenid: 'member' } }
  await assert.rejects(api.removeGroupMember(ownGroup, message.id, 'account'), /机器人自己/)
  context.connectionState = 'disconnected'
  await assert.rejects(api.removeGroupMember(group, message.id, 'account'), /尚未连接/)
  context.connectionState = 'connected'
  await api.removeGroupMember(group, message.id, 'account')
  assert.deepEqual(calls, [['g', ['member']]])
  assert.equal(messages.size, 1)
  assert.equal(events.length, 0)
  await assert.rejects(api.removeGroupMember(group, message.id, 'account'), /过于频繁/)
})

test('inflight removals cannot repeat; unsuccessful responses and official switches are not treated as success', async () => {
  const { api, context, calls } = fixture()
  const pending = deferred<any>()
  context.bot.batchRemoveGroupMembers = async () => { calls.push('remove'); return pending.promise }
  const request = api.removeGroupMember(group, message.id, 'account')
  await assert.rejects(api.removeGroupMember(group, message.id, 'account'), /请勿重复/)
  pending.resolve({ remove_members_result: 'failed' })
  await assert.rejects(request, /未确认成员移除成功/)
  assert.equal(calls.length, 1)
  assert.equal(context.memberRemovalRequests.size, 0)
  for (const code of [40103011, 40103012]) {
    const current = fixture()
    current.context.bot.batchRemoveGroupMembers = async () => { throw { response: { data: { code } } } }
    await assert.rejects(current.api.removeGroupMember(group, message.id, 'account'), new RegExp(`尚未开启.*${code}`))
  }
})

test('stored profiles survive later message writes, reloads and account switches', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'web-qq-profile-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new JsonStore(directory)
  await store.initialize()
  const account = await store.saveAccount({ appid: 'a', secret: 'test', name: 'A', sandbox: true })
  await store.addMessage(contact, { ...message, conversationId: contact.id })
  await store.updateConversation(contact.id, { userProfile: { username: '已刷新', avatar: 'https://example.com/profile.png', allowProactiveMsg: false, updatedAt: 1 } })
  await store.addMessage({ ...contact, avatarUrl: 'https://example.com/old.png' }, { ...message, id: 'm2', conversationId: contact.id })
  assert.equal(store.getConversation(contact.id)?.title, '已刷新')
  assert.equal(store.getConversation(contact.id)?.avatarUrl, 'https://example.com/profile.png')
  await store.initialize()
  assert.equal(store.getConversation(contact.id)?.userProfile?.allowProactiveMsg, false)
  await store.saveAccount({ appid: 'b', secret: 'test', name: 'B', sandbox: true })
  assert.equal(store.getConversation(contact.id), undefined)
  await store.selectAccount(account.id)
  assert.equal(store.getConversation(contact.id)?.title, '已刷新')
  assert.equal(store.getMessage(contact.id, message.id)?.senderName, '成员')
})

test('HTTP routes require confirmation and the active account before calling the SDK', async () => {
  const { context, calls } = fixture()
  const responses: Array<{ status: number; body: any }> = []
  let body: Record<string, unknown> = {}
  const routes = stripTypeScriptTypes(source.slice(source.indexOf('async function handleApi('), source.indexOf('const mimeTypes:')))
  const handleApi = runInNewContext(`${compiled}\n${routes}\nhandleApi`, {
    ...context, handleMediaRequest: async () => false,
    readJson: async () => body,
    sendJson: (_response: unknown, status: number, value: unknown) => responses.push({ status, body: value }),
  })
  const removeUrl = new URL('http://localhost/api/conversations/group%3Ag/members/m/remove')
  await assert.rejects(handleApi({ method: 'POST' }, {}, removeUrl), /请先确认/)
  body = { confirmed: true, accountId: 'other' }
  await assert.rejects(handleApi({ method: 'POST' }, {}, removeUrl), /已切换/)
  assert.equal(calls.length, 0)
  body = { confirmed: true, accountId: 'account' }
  await handleApi({ method: 'POST' }, {}, removeUrl)
  assert.equal(responses.at(-1)?.body.ok, true)
  assert.equal(calls.length, 1)
  await handleApi({ method: 'POST' }, {}, new URL('http://localhost/api/conversations/private%3Au/user-profile'))
  assert.equal(responses.at(-1)?.body.userProfile.username, '新昵称')
  await handleApi({ method: 'POST' }, {}, new URL('http://localhost/api/conversations/private%3Amissing/user-profile'))
  assert.equal(responses.at(-1)?.status, 404)
})
