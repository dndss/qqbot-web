import assert from 'node:assert/strict'
import { createServer, get, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { isPublicIpAddress } from '../src/media-cache.ts'
import { findMessageVideo, handleVideoDownload, openVideoSource, videoContentDisposition, videoDownloadName } from '../src/video-download.ts'
import type { StoredMessage } from '../src/types.ts'

const mp4 = Buffer.concat([
  Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex'),
  Buffer.alloc(100, 0x42),
])
const sampleName = '3e80857c0172a44d9eeeea9fcb92c6ac.mp4'
const message: StoredMessage = {
  id: 'video-message',
  conversationId: 'group:video',
  direction: 'incoming',
  senderId: 'sender',
  senderName: 'Sender',
  content: '[视频]',
  timestamp: 1791904071000,
  status: 'received',
  parts: [{ type: 'video', url: 'https://video.example/original', name: sampleName }],
}

test('video filenames preserve metadata and identify missing suffixes', () => {
  assert.equal(videoDownloadName(sampleName, 'application/octet-stream', mp4, 1), sampleName)
  assert.equal(videoDownloadName('中文视频.mp4', 'application/octet-stream', mp4, 1), '中文视频.mp4')
  assert.equal(videoDownloadName('download', 'application/octet-stream', mp4, 1), 'download.mp4')
  assert.equal(videoDownloadName(undefined, 'application/octet-stream', mp4, 1), 'video_1.mp4')
  assert.equal(videoDownloadName(undefined, 'video/webm', Buffer.alloc(64), 1), 'video_1.webm')
  assert.equal(videoDownloadName('C:\\folder\\clip.mp4', 'video/mp4', mp4, 1), 'clip.mp4')
  assert.equal(videoDownloadName('CON.mp4', 'video/mp4', mp4, 1), 'video_CON.mp4')
  assert.equal(videoDownloadName('clip\r\n.mp4', 'video/mp4', mp4, 1), 'clip__.mp4')
  assert.throws(() => videoDownloadName('download', 'application/octet-stream', Buffer.alloc(64), 1), /无法识别/)
  const imageHeader = Buffer.from(mp4)
  imageHeader.write('avif', 8, 'ascii')
  assert.throws(() => videoDownloadName(undefined, 'application/octet-stream', imageHeader, 1), /无法识别/)
  const movieHeader = Buffer.from(mp4)
  movieHeader.write('qt  ', 8, 'ascii')
  assert.equal(videoDownloadName(undefined, 'application/octet-stream', movieHeader, 1), 'video_1.mov')
  assert.doesNotThrow(() => videoContentDisposition(videoDownloadName(String.fromCodePoint(0x20bb7).repeat(151), 'video/mp4', mp4, 1)))
  const disposition = videoContentDisposition('中文视频.mp4')
  assert.match(disposition, /filename="video\.mp4"/)
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), '中文视频.mp4')
})

test('video indexes include missing URLs and nested forwarded attachments in render order', () => {
  const nested: StoredMessage = {
    ...message,
    parts: [
      { type: 'video' },
      { type: 'forward', title: 'Forward', nodes: [{
        index: 1, senderName: 'Sender', content: '',
        attachments: [
          { index: 0, kind: 'image', rawType: '图片', url: 'https://video.example/image' },
          { index: 1, kind: 'video', rawType: '视频', url: 'https://video.example/first' },
        ],
        children: [{
          index: 0, senderName: 'Sender', content: '',
          attachments: [{ index: 0, kind: 'video', rawType: '视频', url: 'https://video.example/second' }],
        }],
      }] },
      { type: 'video', url: 'https://video.example/third' },
    ],
  }
  assert.equal(findMessageVideo(nested, 0)?.url, undefined)
  assert.equal(findMessageVideo(nested, 1)?.url, 'https://video.example/first')
  assert.equal(findMessageVideo(nested, 2)?.url, 'https://video.example/second')
  assert.equal(findMessageVideo(nested, 3)?.url, 'https://video.example/third')
  assert.equal(findMessageVideo(nested, -1), undefined)
  assert.equal(findMessageVideo(nested, 4), undefined)
})

test('video source rejects local addresses and unsafe protocols before connecting', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.equal(isPublicIpAddress(address), false)
  }
  for (const source of ['http://video.example/file', 'https://127.0.0.1/file', 'https://[::1]/file', 'https://user:password@video.example/file']) {
    await assert.rejects(openVideoSource(new URL(source), new AbortController().signal), /公网 HTTPS/)
  }
})

test('downloads stream saved attachments with filenames, account isolation and cleanup', async (t) => {
  let currentMessage = structuredClone(message)
  let sourceMode = 'normal'
  let sourceCalls = 0
  let signalAborted!: () => void
  let upstreamClosed!: () => void
  let finishStream!: () => void
  const upstream = createServer((_request, response) => {
    if (sourceMode === 'expired') {
      response.writeHead(403)
      response.end('expired')
    } else if (sourceMode === 'html') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<html>expired</html>')
    } else if (sourceMode === 'disguised-error') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.end('{"error":"expired"}')
    } else if (sourceMode === 'empty') {
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '0' })
      response.end()
    } else if (sourceMode === 'oversized') {
      response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': String(201 * 1024 * 1024) })
      response.end(mp4)
    } else if (sourceMode === 'stream' || sourceMode === 'cancel') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      response.write(mp4)
      finishStream = () => response.end(mp4)
      response.once('close', () => upstreamClosed?.())
    } else {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': mp4.length })
      response.end(mp4)
    }
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
  const store = {
    getActiveAccount: () => ({ id: 'account-a', appid: 'test', secret: '', sandbox: false, name: 'Test' }),
    getMessage: (conversationId: string, messageId: string) => (
      conversationId === message.conversationId && messageId === message.id ? currentMessage : undefined
    ),
  }
  const loadSource = async (url: URL, signal: AbortSignal): Promise<IncomingMessage> => {
    assert.equal(url.href, message.parts?.[0].type === 'video' ? message.parts[0].url : undefined)
    sourceCalls++
    signal.addEventListener('abort', () => signalAborted?.(), { once: true })
    return new Promise((resolve, reject) => {
      get(upstreamUrl, { signal }, resolve).on('error', reject)
    })
  }
  const proxy = createServer(async (request, response) => {
    const handled = await handleVideoDownload(request, response, new URL(request.url!, 'http://localhost'), store, loadSource)
    if (!handled) { response.writeHead(404); response.end() }
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
  const downloadUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/api/conversations/group%3Avideo/messages/video-message/videos/0/download?accountId=account-a`

  await t.test('original filename and bytes survive the proxy', async () => {
    const response = await fetch(downloadUrl)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'video/mp4')
    assert.equal(response.headers.get('content-length'), String(mp4.length))
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(decodeURIComponent(response.headers.get('content-disposition')!.split("filename*=UTF-8''")[1]), sampleName)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4)
  })

  await t.test('Unicode and missing names produce usable filenames', async () => {
    for (const name of ['中文视频.mp4', undefined]) {
      currentMessage = { ...message, parts: [{ type: 'video', url: 'https://video.example/original', ...(name ? { name } : {}) }] }
      const response = await fetch(downloadUrl)
      assert.equal(response.status, 200)
      const filename = decodeURIComponent(response.headers.get('content-disposition')!.split("filename*=UTF-8''")[1])
      assert.equal(filename, name || `video_${message.timestamp}.mp4`)
      await response.arrayBuffer()
    }
    currentMessage = structuredClone(message)
  })

  await t.test('wrong account, missing message, recalled video and invalid index never fetch upstream', async () => {
    const before = sourceCalls
    assert.equal((await fetch(downloadUrl.replace('account-a', 'account-b'))).status, 409)
    assert.equal((await fetch(downloadUrl.replace('video-message', 'missing-message'))).status, 404)
    assert.equal((await fetch(downloadUrl.replace('/videos/0/', '/videos/1/'))).status, 404)
    currentMessage = { ...message, status: 'recalled' }
    assert.equal((await fetch(downloadUrl)).status, 404)
    currentMessage = structuredClone(message)
    assert.equal(sourceCalls, before)
  })

  await t.test('expired links and non-video responses return errors without attachment headers', async () => {
    for (const [mode, status] of [['expired', 502], ['html', 502], ['disguised-error', 502], ['empty', 502], ['oversized', 413]] as const) {
      sourceMode = mode
      const response = await fetch(downloadUrl)
      assert.equal(response.status, status, mode)
      assert.equal(response.headers.get('content-disposition'), null)
      assert.ok((await response.json()).error)
    }
  })

  await t.test('bytes arrive while upstream is still producing the video', async () => {
    sourceMode = 'stream'
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(5000) })
    assert.equal(response.status, 200)
    const reader = response.body!.getReader()
    const first = await reader.read()
    assert.deepEqual(Buffer.from(first.value!), mp4)
    finishStream()
    const chunks = [Buffer.from(first.value!)]
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      chunks.push(Buffer.from(result.value))
    }
    assert.deepEqual(Buffer.concat(chunks), Buffer.concat([mp4, mp4]))
  })

  await t.test('canceling the browser download closes the upstream request', async () => {
    sourceMode = 'cancel'
    const aborted = new Promise<void>((resolve) => { signalAborted = resolve })
    const closed = new Promise<void>((resolve) => { upstreamClosed = resolve })
    const response = await fetch(downloadUrl)
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    await Promise.race([
      Promise.all([aborted, closed]),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Download did not cancel upstream')), 2000)
        timer.unref()
      }),
    ])
  })
})
