import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonStore } from '../src/store.ts'
import type { Conversation, StoredMessage } from '../src/types.ts'

export async function createReferenceFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'web-qq-reference-'))
  const store = new JsonStore(directory)
  await store.initialize()
  const account = await store.saveAccount({ appid: 'test', secret: 'test-only', name: 'Test Bot', sandbox: true })
  const timestamp = Date.UTC(2026, 9, 10, 8)
  const conversation: Conversation = {
    id: 'group:fixture',
    type: 'group',
    targetId: 'fixture',
    title: 'Reference test',
    subtitle: 'Group',
    unread: 0,
    updatedAt: timestamp,
    lastMessage: 'Reference',
  }
  const otherConversation = { ...conversation, id: 'group:other', targetId: 'other', title: 'Other conversation' }
  const messages: StoredMessage[] = Array.from({ length: 450 }, (_, index) => ({
    id: `message-${String(index).padStart(3, '0')}`,
    msgIdx: `index-${index}`,
    conversationId: conversation.id,
    direction: index % 2 ? 'outgoing' : 'incoming',
    senderId: 'sender',
    senderName: 'Test sender',
    content: `Message ${index}`,
    timestamp: timestamp + index * 1000,
    status: 'received',
  }))
  messages[440].refMsgIdx = 'index-30'
  messages[441].parts = [{ type: 'reply', messageId: 'index-31' }, { type: 'text', text: 'Indexed reply' }]
  messages[442].parts = [{ type: 'reply', messageId: 'message-032' }, { type: 'text', text: 'Legacy reply' }]
  messages[443].refMsgIdx = 'missing'
  messages[444].refMsgIdx = 'index-40'
  messages[40].status = 'recalled'
  messages[445].refMsgIdx = 'index-430'
  messages[446].refMsgIdx = 'other-only'
  messages[447].refMsgIdx = 'index-447'
  messages[448].refMsgIdx = 'missing'
  messages[448].parts = [{ type: 'reply', messageId: 'message-032' }]
  const otherMessages: StoredMessage[] = [
    { ...messages[30], id: 'foreign-original', conversationId: otherConversation.id },
    { ...messages[30], id: 'foreign-only', msgIdx: 'other-only', conversationId: otherConversation.id },
  ]
  const botDirectory = join(directory, 'bots', account.id)
  await mkdir(botDirectory, { recursive: true })
  await writeFile(join(botDirectory, 'conversations.json'), JSON.stringify([conversation, otherConversation]))
  for (const [target, entries] of [['fixture', messages], ['other', otherMessages]] as const) {
    const path = join(botDirectory, 'messages', 'groups', `id_${target}`)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, '2026-10-10.jsonl'), entries.map((message) => JSON.stringify(message)).join('\n'))
  }
  await store.initialize()
  return { directory, store, conversation, otherConversation, messages }
}
