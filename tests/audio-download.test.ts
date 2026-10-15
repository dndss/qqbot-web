import assert from 'node:assert/strict'
import { createServer, type IncomingMessage } from 'node:http'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { findMessageMedia, handleMediaDownload, mediaContentDisposition, mediaDownloadName, openMediaSource } from '../src/media-download.ts'
import { normalizeMediaPart } from '../src/message-media.ts'
import { normalizeForwardData } from '../src/forward-message.ts'
import { JsonStore } from '../src/store.ts'
import type { StoredMessage } from '../src/types.ts'
import { createReferenceFixture } from './reference-fixture.ts'
import { amrBytes, audioName, officialAudioPart, wavBytes } from './audio-fixture.ts'

const message: StoredMessage = {
  id: 'voice-message', conversationId: 'group:audio', direction: 'incoming',
  senderId: 'sender', senderName: 'Sender', content: '[音频]',
  timestamp: 1791990249000, status: 'received', parts: [officialAudioPart()],
}

test('installed SDK voice parsing survives Web normalization and persistence with both sources', async (t) => {
  const part = officialAudioPart()
  assert.deepEqual(part, {
    type: 'audio', name: audioName,
    url: 'https://audio.example/original', wavUrl: 'https://audio.example/copy.wav',
  })
  const fixture = await createReferenceFixture()
  t.after(async () => {
    assert.equal(dirname(resolve(fixture.directory)), resolve(tmpdir()))
    await rm(fixture.directory, { recursive: true, force: true })
  })
  await fixture.store.addMessage(fixture.conversation, { ...message, conversationId: fixture.conversation.id })
  const reloaded = new JsonStore(fixture.directory)
  await reloaded.initialize()
  assert.deepEqual(reloaded.getMessage(fixture.conversation.id, message.id)?.parts, [part])
  assert.deepEqual(normalizeMediaPart('audio', { url: 'https://audio.example/original', voice_wav_url: 'javascript:unsafe()' }), {
    type: 'audio', url: 'https://audio.example/original',
  })
  assert.deepEqual(normalizeMediaPart('file', { url: 'https://audio.example/file.amr', voice_wav_url: 'https://audio.example/copy.wav' }), {
    type: 'file', url: 'https://audio.example/file.amr',
  })
})

test('audio and video indexes remain independent across missing URLs and nested forwards', () => {
  const forward = normalizeForwardData({ title: 'Mixed', nodes: [{
    index: 0, sender_name: 'Sender', content: '',
    attachments: [{ index: 0, type: 'audio', raw_type: '语音', file_name: 'nested.amr', url: 'https://audio.example/first', voice_wav_url: 'https://audio.example/first.wav' }],
    children: [{ index: 0, sender_name: 'Sender', content: '', attachments: [{ index: 0, type: 'audio', raw_type: '音频', url: 'https://audio.example/second' }] }],
  }] })!
  const mixed = { ...message, parts: [{ type: 'audio' as const }, { type: 'video' as const, url: 'https://video.example/only' }, forward, officialAudioPart()] }
  assert.equal(findMessageMedia(mixed, 'audio', 0)?.url, undefined)
  assert.equal(findMessageMedia(mixed, 'audio', 1)?.wavUrl, 'https://audio.example/first.wav')
  assert.equal(findMessageMedia(mixed, 'audio', 2)?.url, 'https://audio.example/second')
  assert.equal(findMessageMedia(mixed, 'audio', 3)?.url, 'https://audio.example/original')
  assert.equal(findMessageMedia(mixed, 'video', 0)?.url, 'https://video.example/only')
  assert.equal(findMessageMedia(mixed, 'audio', -1), undefined)
})

test('audio filenames preserve metadata and identify AMR and WAV without URL guessing', () => {
  assert.equal(mediaDownloadName('audio', audioName, 'application/octet-stream', amrBytes, 1), audioName)
  assert.equal(mediaDownloadName('audio', undefined, 'application/octet-stream', amrBytes, 1), 'audio_1.amr')
  assert.equal(mediaDownloadName('audio', '语音', 'application/octet-stream', wavBytes, 1), '语音.wav')
  assert.equal(mediaDownloadName('audio', 'sample', 'audio/x-wav', Buffer.alloc(64), 1), 'sample.wav')
  assert.equal(mediaDownloadName('audio', 'CON.amr', 'audio/amr', amrBytes, 1), 'audio_CON.amr')
  assert.throws(() => mediaDownloadName('audio', undefined, 'application/octet-stream', Buffer.alloc(64), 1), /无法识别/)
  assert.match(mediaContentDisposition('audio', '语音.wav', 'inline'), /^inline; filename="audio.wav"/)
})

test('audio sources use the shared HTTPS and public-address checks', async () => {
  for (const source of ['http://audio.example/original', 'https://127.0.0.1/original', 'https://user:pass@audio.example/original', 'https://audio.example:444/original']) {
    await assert.rejects(openMediaSource(new URL(source), new AbortController().signal), /公网 HTTPS/)
  }
})

test('audio downloads select original or verified WAV sources through the shared route', async (t) => {
  let currentMessage: StoredMessage | undefined = structuredClone(message)
  let mode = 'normal'
  const fetched: string[] = []
  const store = {
    getActiveAccount: () => ({ id: 'account-a', appid: 'test', secret: '', sandbox: false, name: 'Test' }),
    getMessage: (conversationId: string, messageId: string) => (
      conversationId === message.conversationId && messageId === message.id ? currentMessage : undefined
    ),
  }
  const loader = async (url: URL): Promise<IncomingMessage> => {
    fetched.push(url.href)
    let bytes = url.href.endsWith('.wav') ? wavBytes : amrBytes
    let statusCode = 200
    let contentType = 'application/octet-stream'
    let length = bytes.length
    if (mode === 'expired') statusCode = 403
    if (mode === 'html') { contentType = 'text/html'; bytes = Buffer.from('<html>error</html>') }
    if (mode === 'json') bytes = Buffer.from('{"error":"expired"}')
    if (mode === 'empty') bytes = Buffer.alloc(0)
    if (mode === 'oversized') length = 201 * 1024 * 1024
    if (mode === 'wrong-wav') bytes = amrBytes
    if (mode === 'audio-mime') contentType = url.href.endsWith('.wav') ? 'audio/x-wav' : 'audio/amr'
    return Object.assign(Readable.from([bytes], { objectMode: false }), {
      statusCode, headers: { 'content-type': contentType, 'content-length': String(mode === 'oversized' ? length : bytes.length) },
    }) as unknown as IncomingMessage
  }
  const server = createServer(async (request, response) => {
    if (!await handleMediaDownload(request, response, new URL(request.url!, 'http://localhost'), store, loader)) {
      response.writeHead(404); response.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  const downloadUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/conversations/group%3Aaudio/messages/voice-message/audios/0/download?accountId=account-a`

  await t.test('original AMR and WAV use different sources, filenames and response MIME', async () => {
    for (const format of ['original', 'wav'] as const) {
      const response = await fetch(`${downloadUrl}&format=${format}`)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), format === 'wav' ? 'audio/wav' : 'audio/amr')
      const filename = decodeURIComponent(response.headers.get('content-disposition')!.split("filename*=UTF-8''")[1])
      assert.equal(filename, format === 'wav' ? audioName.replace(/\.amr$/, '.wav') : audioName)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), format === 'wav' ? wavBytes : amrBytes)
    }
    assert.deepEqual(fetched.slice(-2), ['https://audio.example/original', 'https://audio.example/copy.wav'])
    mode = 'audio-mime'
    const response = await fetch(`${downloadUrl}&format=wav`)
    assert.equal(response.status, 200)
    await response.arrayBuffer()
    mode = 'normal'
  })

  await t.test('account, message, recall, index and format errors never fetch upstream', async () => {
    const before = fetched.length
    for (const [url, status] of [
      [downloadUrl.replace('account-a', 'account-b'), 409],
      [downloadUrl.replace('voice-message', 'missing'), 404],
      [downloadUrl.replace('/audios/0/', '/audios/99/'), 404],
      [`${downloadUrl}&format=mp3`, 400],
    ] as const) assert.equal((await fetch(url)).status, status)
    currentMessage = { ...message, status: 'recalled' }
    assert.equal((await fetch(downloadUrl)).status, 404)
    currentMessage = { ...message, parts: [{ type: 'audio', url: 'https://audio.example/original', name: audioName }] }
    assert.equal((await fetch(`${downloadUrl}&format=wav`)).status, 404)
    assert.equal(fetched.length, before)
    currentMessage = structuredClone(message)
  })

  await t.test('WAV-only attachments work and missing names are derived from bytes', async () => {
    currentMessage = { ...message, parts: [{ type: 'audio', wavUrl: 'https://audio.example/copy.wav' }] }
    assert.equal((await fetch(downloadUrl)).status, 404)
    const response = await fetch(`${downloadUrl}&format=wav`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-disposition')!, /audio_1791990249000\.wav/)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wavBytes)
    currentMessage = structuredClone(message)
  })

  await t.test('failed and oversized sources produce errors without download headers', async () => {
    for (const [sourceMode, status] of [['expired', 502], ['html', 502], ['json', 502], ['empty', 502], ['oversized', 413], ['wrong-wav', 502]] as const) {
      mode = sourceMode
      const response = await fetch(`${downloadUrl}&format=wav`)
      assert.equal(response.status, status, sourceMode)
      assert.equal(response.headers.get('content-disposition'), null)
      assert.ok((await response.json()).error)
    }
    mode = 'normal'
  })

  await t.test('playback uses the WAV copy and inline response while download remains an attachment', async () => {
    const response = await fetch(downloadUrl.replace('/download?', '/stream?'))
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-disposition')!, /^inline;/)
    assert.equal(response.headers.get('content-type'), 'audio/wav')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), wavBytes)
    assert.equal(fetched.at(-1), 'https://audio.example/copy.wav')
  })
})
