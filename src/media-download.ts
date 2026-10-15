import { lookup } from 'node:dns/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isPublicIpAddress } from './media-cache.ts'
import type { JsonStore } from './store.ts'
import type { ForwardNodePart, StoredMessage } from './types.ts'

const MAX_MEDIA_BYTES = 200 * 1024 * 1024
const DOWNLOAD_IDLE_TIMEOUT_MS = 30_000
export type MediaKind = 'video' | 'audio'
export type AudioSourceFormat = 'original' | 'wav'
export type MediaResponseMode = 'attachment' | 'inline'
export type MediaAttachment = { url?: string; name?: string; wavUrl?: string }
export type SourceRequestOptions = { range?: string }
export type SourceLoader = (url: URL, signal: AbortSignal, options?: SourceRequestOptions) => Promise<IncomingMessage>
type DownloadStore = Pick<JsonStore, 'getActiveAccount' | 'getMessage'>

const mimeTypes: Record<MediaKind, Record<string, string>> = {
  video: {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
    '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.3gp': 'video/3gpp', '.ogv': 'video/ogg', '.ts': 'video/mp2t',
  },
  audio: {
    '.amr': 'audio/amr', '.awb': 'audio/amr-wb', '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.silk': 'audio/silk',
  },
}
const labels: Record<MediaKind, string> = { video: '视频', audio: '音频' }

class DownloadError extends Error {
  readonly status: number
  readonly headers: Record<string, string>

  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.headers = headers
  }
}

/** Count every attachment, including unavailable ones, in the same order as the renderer. */
export function findMessageMedia(message: StoredMessage, kind: MediaKind, index: number): MediaAttachment | undefined {
  if (!Number.isSafeInteger(index) || index < 0) return
  const attachments: MediaAttachment[] = []
  const collectNodes = (nodes: ForwardNodePart[]) => {
    for (const node of nodes) {
      for (const attachment of node.attachments || []) {
        if (attachment.kind === kind) attachments.push(attachment)
      }
      collectNodes(node.children || [])
    }
  }
  for (const part of message.parts || []) {
    if (part.type === kind) attachments.push(part)
    else if (part.type === 'forward') collectNodes(part.nodes)
  }
  return attachments[index]
}

function fileExtension(kind: MediaKind, name: string): string | undefined {
  const extension = name.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase()
  return extension && mimeTypes[kind][extension] ? extension : undefined
}

function headerExtension(kind: MediaKind, header: Buffer): string | undefined {
  if (kind === 'audio') {
    if (header.subarray(0, 9).toString('ascii') === '#!AMR-WB\n') return '.awb'
    if (header.subarray(0, 6).toString('ascii') === '#!AMR\n') return '.amr'
    if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WAVE') return '.wav'
    if (header.subarray(0, 3).toString('ascii') === 'ID3') return '.mp3'
    if (header.subarray(0, 4).toString('ascii') === 'OggS') return '.ogg'
    if (header.subarray(0, 4).toString('ascii') === 'fLaC') return '.flac'
    if (header.subarray(0, 9).toString('ascii') === '#!SILK_V3' || header.subarray(1, 10).toString('ascii') === '#!SILK_V3') return '.silk'
    return
  }
  if (header.length < 16 || header.subarray(4, 8).toString('ascii') !== 'ftyp') return
  const brand = header.subarray(8, 12).toString('ascii')
  if (brand === 'qt  ') return '.mov'
  if (/^3g[pe]/.test(brand)) return '.3gp'
  if (/^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV)$/.test(brand)) return '.mp4'
}

function canonicalContentType(contentType: string): string {
  const type = contentType.split(';')[0].trim().toLowerCase()
  if (['audio/x-wav', 'audio/wave', 'audio/vnd.wave'].includes(type)) return 'audio/wav'
  if (type === 'audio/x-amr') return 'audio/amr'
  if (type === 'audio/x-flac') return 'audio/flac'
  return type
}

export function mediaDownloadName(kind: MediaKind, name: string | undefined, contentType: string, header: Buffer, timestamp: number): string {
  let safeName = (name || '').replace(/\\/g, '/').split('/').at(-1) || ''
  safeName = safeName.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '')
  const extension = fileExtension(kind, safeName)
    || headerExtension(kind, header)
    || Object.keys(mimeTypes[kind]).find((key) => mimeTypes[kind][key] === canonicalContentType(contentType))
  if (!extension) throw new DownloadError(422, `无法识别${labels[kind]}格式，不能确定下载后缀`)
  if (!safeName) safeName = `${kind}_${timestamp}`
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)) safeName = `${kind}_${safeName}`
  const stem = fileExtension(kind, safeName) ? safeName.slice(0, -extension.length) : safeName
  return `${[...stem].slice(0, 100).join('')}${extension}`
}

export function mediaContentDisposition(kind: MediaKind, name: string, mode: MediaResponseMode = 'attachment'): string {
  const extension = fileExtension(kind, name) || ''
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${mode}; filename="${kind}${extension}"; filename*=UTF-8''${encoded}`
}

/** Keep original and WAV sources separate so playback explicitly uses the official WAV copy. */
export function selectAudioSource(audio: MediaAttachment, format: AudioSourceFormat): MediaAttachment {
  if (format === 'original') return audio
  if (!audio.wavUrl) throw new DownloadError(404, '音频没有官方 WAV 副本地址')
  const name = audio.name?.replace(/\.[a-z0-9]+$/i, '')
  return { url: audio.wavUrl, ...(name ? { name: `${name}.wav` } : {}) }
}

export async function openMediaSource(initialUrl: URL, signal: AbortSignal, options: SourceRequestOptions = {}): Promise<IncomingMessage> {
  let url = initialUrl
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
      throw new DownloadError(400, '媒体下载地址必须为公网 HTTPS 地址')
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true })
    if (!addresses.length || !addresses.every((entry) => isPublicIpAddress(entry.address))) {
      throw new DownloadError(400, '媒体下载地址必须为公网 HTTPS 地址')
    }
    const address = addresses[0]
    // Pin the validated address so a second DNS lookup cannot reach a private host.
    const upstream = await new Promise<IncomingMessage>((resolve, reject) => {
      const source = httpsRequest(url, {
        signal,
        headers: { 'Accept-Encoding': 'identity', ...(options.range ? { Range: options.range } : {}) },
        lookup: (_hostname, options, callback) => callback(null, options.all ? [address] : address.address, address.family),
      }, resolve)
      const timer = setTimeout(() => source.destroy(new Error('媒体下载连接超时')), DOWNLOAD_IDLE_TIMEOUT_MS)
      source.once('response', () => clearTimeout(timer))
      source.once('close', () => clearTimeout(timer))
      source.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => source.destroy(new Error('媒体下载超时')))
      source.on('error', reject)
      source.end()
    })
    if (![301, 302, 303, 307, 308].includes(upstream.statusCode || 0)) return upstream
    const location = upstream.headers.location
    upstream.destroy()
    if (!location || redirects === 3) throw new DownloadError(502, '媒体下载地址重定向失败')
    url = new URL(location, url)
  }
  throw new DownloadError(502, '媒体下载地址重定向失败')
}

type ByteRange = { start?: number; end?: number; suffix?: number; header: string }
type ResolvedRange = { start: number; end: number; total: number }

function parseByteRange(value: string): ByteRange {
  const match = value.trim().match(/^bytes=(\d*)-(\d*)$/i)
  if (!match || (!match[1] && !match[2])) throw new DownloadError(400, '播放仅支持一个有效的 bytes 区间')
  const first = match[1] ? Number(match[1]) : undefined
  const last = match[2] ? Number(match[2]) : undefined
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))
    || (first !== undefined && last !== undefined && first > last) || (first === undefined && last === 0)) {
    throw new DownloadError(400, '播放字节区间无效')
  }
  return first === undefined
    ? { suffix: last, header: `bytes=-${last}` }
    : { start: first, end: last, header: `bytes=${first}-${last ?? ''}` }
}

function resolveByteRange(range: ByteRange, total: number): ResolvedRange {
  const start = range.suffix !== undefined ? Math.max(0, total - range.suffix) : range.start!
  if (start >= total) throw new DownloadError(416, '播放字节区间超出音频长度', { 'Content-Range': `bytes */${total}` })
  return { start, end: range.suffix !== undefined ? total - 1 : Math.min(range.end ?? total - 1, total - 1), total }
}

function partialRange(upstream: IncomingMessage): ResolvedRange {
  const match = String(upstream.headers['content-range'] || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/i)
  const [start, end, total] = match ? match.slice(1).map(Number) : []
  if (!match || ![start, end, total].every(Number.isSafeInteger) || start > end || end >= total) {
    throw new DownloadError(502, '上游音频字节区间响应无效')
  }
  if (total > MAX_MEDIA_BYTES) throw new DownloadError(413, '音频超过 200 MB 播放限制')
  const length = upstream.headers['content-length']
  if (length !== undefined && Number(length) !== end - start + 1) throw new DownloadError(502, '上游音频区间长度不一致')
  return { start, end, total }
}

function fullLength(upstream: IncomingMessage): number | undefined {
  const value = upstream.headers['content-length']
  if (value === undefined) return
  const length = Number(value)
  if (!Number.isSafeInteger(length) || length < 0) throw new DownloadError(502, '上游媒体长度无效')
  if (length > MAX_MEDIA_BYTES) throw new DownloadError(413, '媒体超过 200 MB 限制')
  return length
}

async function readPrefix(iterator: AsyncIterator<Buffer>) {
  const chunks: Buffer[] = []
  let size = 0
  while (size < 64) {
    const result = await iterator.next()
    if (result.done) break
    const chunk = Buffer.from(result.value)
    size += chunk.length
    if (size > MAX_MEDIA_BYTES) throw new DownloadError(413, '媒体超过 200 MB 限制')
    chunks.push(chunk)
  }
  return { chunks, size, header: Buffer.concat(chunks).subarray(0, 64) }
}

function validateWav(upstream: IncomingMessage, header: Buffer): void {
  const contentType = canonicalContentType(String(upstream.headers['content-type'] || ''))
  if ((contentType && contentType !== 'application/octet-stream' && !contentType.startsWith('audio/'))
    || headerExtension('audio', header) !== '.wav') {
    throw new DownloadError(502, '官方 WAV 地址返回的内容不是 WAV 音频')
  }
}

/** A bounded header probe validates WAV even when the requested range starts inside PCM data. */
async function probeWav(url: URL, signal: AbortSignal, loadSource: SourceLoader): Promise<number | undefined> {
  const upstream = await loadSource(url, signal, { range: 'bytes=0-63' })
  try {
    if (upstream.statusCode !== 200 && upstream.statusCode !== 206) throw new DownloadError(502, '音频链接已失效或上游播放失败')
    const partial = upstream.statusCode === 206 ? partialRange(upstream) : undefined
    if (partial && (partial.start !== 0 || partial.end !== Math.min(63, partial.total - 1))) {
      throw new DownloadError(502, '上游 WAV 头部区间响应无效')
    }
    const total = partial?.total ?? fullLength(upstream)
    const prefix = await readPrefix(upstream[Symbol.asyncIterator]())
    validateWav(upstream, prefix.header)
    if (partial && prefix.size !== partial.end + 1) throw new DownloadError(502, '上游 WAV 头部长度不一致')
    return total
  } finally {
    upstream.destroy()
  }
}

/** Slice a full upstream stream when it ignores Range; never buffer the whole file. */
async function* mediaBody(chunks: Buffer[], iterator: AsyncIterator<Buffer>, skip = 0, length?: number) {
  let received = 0
  let sent = 0
  const input = (async function* () {
    yield* chunks
    for (;;) {
      const result = await iterator.next()
      if (result.done) return
      yield Buffer.from(result.value)
    }
  })()
  for await (const chunk of input) {
    const offset = Math.max(0, skip - received)
    received += chunk.length
    if (received > MAX_MEDIA_BYTES) throw new DownloadError(413, '媒体超过 200 MB 限制')
    const count = Math.min(Math.max(0, chunk.length - offset), length === undefined ? Infinity : length - sent)
    if (count) {
      sent += count
      yield chunk.subarray(offset, offset + count)
    }
    if (length !== undefined && sent === length) return
  }
  if (length !== undefined && sent !== length) throw new DownloadError(502, '上游媒体内容不完整')
}

async function streamRangedWav(
  response: ServerResponse, attachment: MediaAttachment, timestamp: number,
  signal: AbortSignal, loadSource: SourceLoader, requested: ByteRange,
): Promise<void> {
  const url = new URL(attachment.url!)
  const probedTotal = await probeWav(url, signal, loadSource)
  if (probedTotal !== undefined) resolveByteRange(requested, probedTotal)
  const upstream = await loadSource(url, signal, { range: requested.header })
  try {
    if (upstream.statusCode === 416) {
      const match = String(upstream.headers['content-range'] || '').match(/^bytes \*\/(\d+)$/i)
      const total = match ? Number(match[1]) : NaN
      if (!Number.isSafeInteger(total) || total > MAX_MEDIA_BYTES) throw new DownloadError(502, '上游音频区间错误响应无效')
      throw new DownloadError(416, '播放字节区间超出音频长度', { 'Content-Range': `bytes */${total}` })
    }
    if (upstream.statusCode !== 200 && upstream.statusCode !== 206) throw new DownloadError(502, '音频链接已失效或上游播放失败')
    const contentType = canonicalContentType(String(upstream.headers['content-type'] || ''))
    if (contentType && contentType !== 'application/octet-stream' && !contentType.startsWith('audio/')) {
      throw new DownloadError(502, '音频链接返回了非音频内容')
    }
    const actual = upstream.statusCode === 206 ? partialRange(upstream) : undefined
    const total = actual?.total ?? fullLength(upstream)
    if (probedTotal !== undefined && total !== undefined && probedTotal !== total) throw new DownloadError(502, '上游音频在播放期间发生变化，请重试')
    const range = total === undefined ? undefined : resolveByteRange(requested, total)
    if (actual && (!range || actual.start !== range.start || actual.end !== range.end)) throw new DownloadError(502, '上游返回了不匹配的音频字节区间')
    const iterator = upstream[Symbol.asyncIterator]()
    const prefix = actual ? { chunks: [], size: 0, header: Buffer.alloc(0) } : await readPrefix(iterator)
    if (!actual) validateWav(upstream, prefix.header)
    const name = mediaDownloadName('audio', attachment.name, 'audio/wav', Buffer.alloc(0), timestamp)
    const length = range ? range.end - range.start + 1 : total
    response.writeHead(range ? 206 : 200, {
      'Content-Type': 'audio/wav', 'Content-Disposition': mediaContentDisposition('audio', name, 'inline'),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': range ? 'bytes' : 'none',
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${range.total}` } : {}),
      ...(length !== undefined ? { 'Content-Length': length } : {}),
    })
    await pipeline(Readable.from(mediaBody(prefix.chunks, iterator, actual ? 0 : range?.start ?? 0, length), { objectMode: false }), response, { signal })
  } finally {
    upstream.destroy()
  }
}

export async function streamMedia(
  response: ServerResponse,
  attachment: MediaAttachment,
  timestamp: number,
  signal: AbortSignal,
  loadSource: SourceLoader,
  options: { kind: MediaKind; format?: AudioSourceFormat; mode?: MediaResponseMode; range?: string },
): Promise<void> {
  const { kind, format = 'original', mode = 'attachment' } = options
  if (kind === 'audio' && format === 'wav' && mode === 'inline' && options.range) {
    return streamRangedWav(response, attachment, timestamp, signal, loadSource, parseByteRange(options.range))
  }
  const label = labels[kind]
  const upstream = await loadSource(new URL(attachment.url!), signal)
  try {
    if (upstream.statusCode !== 200) throw new DownloadError(502, `${label}链接已失效或上游下载失败，请重新发送${label}`)
    const contentType = canonicalContentType(String(upstream.headers['content-type'] || ''))
    if (contentType && contentType !== 'application/octet-stream' && !contentType.startsWith(`${kind}/`)) {
      throw new DownloadError(502, `${label}链接返回了非${label}内容，请重新发送${label}`)
    }
    const declaredLength = Number(upstream.headers['content-length'])
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES) {
      throw new DownloadError(413, `${label}超过 200 MB 下载限制`)
    }
    const iterator = upstream[Symbol.asyncIterator]()
    const initialChunks: Buffer[] = []
    let size = 0
    while (size < 64) {
      const result = await iterator.next()
      if (result.done) break
      const chunk = Buffer.from(result.value)
      size += chunk.length
      if (size > MAX_MEDIA_BYTES) throw new DownloadError(413, `${label}超过 200 MB 下载限制`)
      initialChunks.push(chunk)
    }
    if (!size) throw new DownloadError(502, `${label}链接返回了空文件`)
    const header = Buffer.concat(initialChunks).subarray(0, 64)
    if (/^\s*(?:<!doctype|<html|<\?xml|\{|\[)/i.test(header.toString('ascii'))) {
      throw new DownloadError(502, `${label}链接返回了错误内容，请重新发送${label}`)
    }
    if (kind === 'audio' && format === 'wav' && headerExtension('audio', header) !== '.wav') {
      throw new DownloadError(502, '官方 WAV 地址返回的内容不是 WAV 音频')
    }
    const name = mediaDownloadName(kind, attachment.name, contentType, header, timestamp)
    response.writeHead(200, {
      'Content-Type': mimeTypes[kind][fileExtension(kind, name)!],
      'Content-Disposition': mediaContentDisposition(kind, name, mode),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(mode === 'inline' ? { 'Accept-Ranges': Number.isSafeInteger(declaredLength) && declaredLength > 0 ? 'bytes' : 'none' } : {}),
      ...(Number.isSafeInteger(declaredLength) && declaredLength > 0 ? { 'Content-Length': declaredLength } : {}),
    })
    const body = Readable.from(mediaBody(initialChunks, iterator), { objectMode: false })
    await pipeline(body, response, { signal })
  } finally {
    upstream.destroy()
  }
}

export async function handleMediaRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  store: DownloadStore,
  loadSource: SourceLoader = openMediaSource,
  onlyKind?: MediaKind,
): Promise<boolean> {
  const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/(videos|audios)\/(\d+)\/(download|stream)$/)
  if (!match || request.method !== 'GET') return false
  const kind: MediaKind = match[3] === 'videos' ? 'video' : 'audio'
  const playback = match[5] === 'stream'
  if (playback && kind !== 'audio') return false
  if (onlyKind && kind !== onlyKind) return false
  const controller = new AbortController()
  const cancel = () => { if (!response.writableFinished) controller.abort() }
  response.once('close', cancel)
  try {
    const accountId = url.searchParams.get('accountId')
    if (!accountId || accountId !== store.getActiveAccount()?.id) {
      throw new DownloadError(409, 'Bot 账号已切换，请刷新消息后重新下载')
    }
    const message = store.getMessage(decodeURIComponent(match[1]), decodeURIComponent(match[2]))
    if (!message || message.status === 'recalled') throw new DownloadError(404, `${labels[kind]}消息不存在或已撤回`)
    const attachment = findMessageMedia(message, kind, Number(match[4]))
    if (!attachment) throw new DownloadError(404, `${labels[kind]}附件不存在或没有下载地址`)
    const format = kind === 'audio' ? url.searchParams.get('format') ?? (playback ? 'wav' : 'original') : 'original'
    if (format !== 'original' && format !== 'wav') throw new DownloadError(400, '音频格式必须为 original 或 wav')
    if (playback && format !== 'wav') throw new DownloadError(400, '在线播放仅支持官方 WAV 音频副本')
    const source = kind === 'audio' ? selectAudioSource(attachment, format) : attachment
    if (!source.url) throw new DownloadError(404, `${labels[kind]}附件不存在或没有下载地址`)
    await streamMedia(response, source, message.timestamp, controller.signal, loadSource, {
      kind, format, mode: playback ? 'inline' : 'attachment', ...(playback && request.headers.range ? { range: request.headers.range } : {}),
    })
  } catch (error) {
    if (!response.destroyed && !response.headersSent) {
      response.writeHead(error instanceof DownloadError ? error.status : 502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(error instanceof DownloadError ? error.headers : {}),
      })
      response.end(JSON.stringify({
        error: error instanceof DownloadError ? error.message : `${labels[kind]}下载失败，请稍后重试或重新发送${labels[kind]}`,
      }))
    } else if (!response.destroyed) {
      response.destroy()
    }
  } finally {
    controller.abort()
    response.removeListener('close', cancel)
  }
  return true
}

// Compatibility for callers of the original download handler.
export const handleMediaDownload = handleMediaRequest
