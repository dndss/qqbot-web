import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { test } from 'node:test'
import { createReferenceFixture } from './reference-fixture.ts'

test('resolves references within the current conversation and preserves contiguous history', async (t) => {
  const { directory, store, conversation, otherConversation } = await createReferenceFixture()
  t.after(() => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}web-qq-reference-`))
    return rm(directory, { recursive: true, force: true })
  })

  await t.test('reference indexes, SDK reply segments and legacy IDs', () => {
    assert.equal(store.getMessageReference(conversation.id, 'message-440')?.id, 'message-030')
    assert.equal(store.getMessageReference(conversation.id, 'message-441')?.id, 'message-031')
    assert.equal(store.getMessageReference(conversation.id, 'message-442')?.id, 'message-032')
    assert.equal(store.getMessageReference(otherConversation.id, 'message-440'), undefined)
    assert.equal(store.getMessageReference(conversation.id, 'message-446'), undefined)
    assert.equal(store.getMessageReference(conversation.id, 'message-447'), undefined)
    assert.equal(store.getMessageReference(conversation.id, 'message-448'), undefined)
    assert.equal(store.getMessageReference(conversation.id, 'message-443'), undefined)
  })

  await t.test('previews resolve targets outside the latest page without persisting snapshots', () => {
    const page = store.listMessagesPage(conversation.id)
    assert.equal(page.messages.length, 200)
    assert.equal(page.nextCursor, 'message-250')
    assert.equal(page.messages.find((message) => message.id === 'message-440')?.reference?.id, 'message-030')
    assert.equal(page.messages.find((message) => message.id === 'message-444')?.reference?.status, 'recalled')
    assert.equal(store.getMessage(conversation.id, 'message-440')?.reference, undefined)
  })

  await t.test('one request fills the gap to the original and preserves an older cursor', () => {
    const latest = store.listMessagesPage(conversation.id)
    const page = store.listMessagesPage(conversation.id, 200, latest.nextCursor!, 'message-030')
    assert.equal(page.messages[0].id, 'message-010')
    assert.equal(page.messages.at(-1)?.id, 'message-249')
    assert.equal(page.messages.length, 240)
    assert.equal(page.hasMore, true)
    assert.equal(page.nextCursor, 'message-010')
    const combined = [...page.messages, ...latest.messages]
    assert.equal(new Set(combined.map((message) => message.id)).size, combined.length)
    const older = store.listMessagesPage(conversation.id, 200, page.nextCursor!)
    assert.equal(older.messages.length, 10)
    assert.equal(older.hasMore, false)
    assert.equal(older.nextCursor, null)
  })

  await t.test('missing cursors and unknown targets fail explicitly', () => {
    assert.throws(() => store.listMessagesPage(conversation.id, 200, 'missing'))
    assert.throws(() => store.listMessagesPage(conversation.id, 200, undefined, 'foreign-original'))
  })

  await t.test('reference snapshots reflect recall updates and survive reload', async () => {
    await store.updateMessage(conversation.id, 'message-030', { status: 'recalled' })
    assert.equal(store.listMessagesPage(conversation.id).messages.find((message) => message.id === 'message-440')?.reference?.status, 'recalled')
    await store.initialize()
    assert.equal(store.getMessageReference(conversation.id, 'message-440')?.id, 'message-030')
    assert.equal(store.getMessageReference(conversation.id, 'message-440')?.status, 'recalled')
  })
})
