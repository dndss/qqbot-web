import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createReadStream } from 'node:fs'
import { access, mkdir, open, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_LOCAL_IMAGE_BYTES = 200 * 1024 * 1024
const MAX_ACCOUNT_CACHE_BYTES = 1024 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 15_000
const imageExtensions = ['.jpg', '.png', '.gif', '.webp'] as const

const imageMimeTypes: Record<(typeof imageExtensions)[number], string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

function imageExtension(buffer: Buffer): (typeof imageExtensions)[number] | undefined {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return '.jpg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png'
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return '.gif'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp'
  return undefined
}

function validAccountId(accountId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(accountId)
}

function isPublicIpAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return isPublicIpAddress(mappedIpv4)
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number)
    return !(
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 198 && [18, 19].includes(b))
      || a >= 224
    )
  }
  if (isIP(normalized) === 6) {
    const first = Number.parseInt(normalized.split(':')[0] || '0', 16)
    return !(
      normalized === '::'
      || normalized === '::1'
      || (first & 0xfe00) === 0xfc00
      || (first & 0xffc0) === 0xfe80
      || (first & 0xff00) === 0xff00
      || normalized.startsWith('2001:db8:')
    )
  }
  return false
}

async function isPublicHttpsUrl(url: URL): Promise<boolean> {
  if (url.protocol !== 'https:' || url.username || url.password || url.hostname.toLowerCase() === 'localhost') return false
  try {
    const addresses = isIP(url.hostname)
      ? [url.hostname]
      : (await lookup(url.hostname, { all: true, verbatim: true })).map((entry) => entry.address)
    return addresses.length > 0 && addresses.every(isPublicIpAddress)
  } catch {
    return false
  }
}

export class MediaCache {
  readonly dataDirectory: string
  #pending = new Map<string, Promise<string | undefined>>()

  constructor(dataDirectory: string) {
    this.dataDirectory = dataDirectory
  }

  async cacheImage(accountId: string, sourceUrl: string): Promise<string | undefined> {
    if (!validAccountId(accountId)) return undefined
    let url: URL
    try {
      url = new URL(sourceUrl)
    } catch {
      return undefined
    }
    if (!(await isPublicHttpsUrl(url))) return undefined

    const key = `${accountId}:${url.href}`
    const existingRequest = this.#pending.get(key)
    if (existingRequest) return existingRequest
    const request = this.#cacheImage(accountId, url).finally(() => this.#pending.delete(key))
    this.#pending.set(key, request)
    return request
  }

  async storeLocalImage(accountId: string, sourcePath: string): Promise<string | undefined> {
    if (!validAccountId(accountId)) return undefined
    let temporaryPath = ''
    try {
      const details = await stat(sourcePath)
      if (!details.isFile() || details.size === 0 || details.size > MAX_LOCAL_IMAGE_BYTES) return undefined

      const header = Buffer.alloc(12)
      const handle = await open(sourcePath, 'r')
      let bytesRead = 0
      try {
        ({ bytesRead } = await handle.read(header, 0, header.length, 0))
      } finally {
        await handle.close()
      }
      const extension = imageExtension(header.subarray(0, bytesRead))
      if (!extension || !['.jpg', '.png'].includes(extension)) return undefined

      const hash = createHash('sha256')
      for await (const chunk of createReadStream(sourcePath)) hash.update(chunk)
      const directory = join(this.dataDirectory, 'bots', accountId, 'media')
      const filename = `${hash.digest('hex')}${extension}`
      const path = join(directory, filename)
      await mkdir(directory, { recursive: true })
      try {
        await access(path)
        return this.#localUrl(accountId, filename)
      } catch {
        // 缓存中不存在相同内容，继续移动本地上传文件。
      }

      temporaryPath = `${path}.${randomUUID()}.tmp`
      await rename(sourcePath, temporaryPath)
      try {
        await rename(temporaryPath, path)
        temporaryPath = ''
      } catch (error) {
        try {
          await access(path)
          await unlink(temporaryPath).catch(() => undefined)
          temporaryPath = ''
        } catch {
          throw error
        }
      }
      await this.#trimCache(directory).catch(() => undefined)
      return this.#localUrl(accountId, filename)
    } catch {
      if (temporaryPath) await rename(temporaryPath, sourcePath).catch(() => undefined)
      return undefined
    }
  }

  mediaPath(accountId: string, filename: string): string | undefined {
    if (!validAccountId(accountId) || !/^[a-f0-9]{64}\.(?:jpg|png|gif|webp)$/.test(filename)) return undefined
    return join(this.dataDirectory, 'bots', accountId, 'media', filename)
  }

  contentType(filename: string): string | undefined {
    const extension = imageExtensions.find((value) => filename.endsWith(value))
    return extension ? imageMimeTypes[extension] : undefined
  }

  async #cacheImage(accountId: string, url: URL): Promise<string | undefined> {
    const directory = join(this.dataDirectory, 'bots', accountId, 'media')
    const hash = createHash('sha256').update(url.href).digest('hex')
    const existing = await this.#findExisting(directory, hash)
    if (existing) return this.#localUrl(accountId, existing)

    try {
      const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
      const response = await this.#fetchWithSafeRedirects(url, signal)
      if (!response?.ok || !response.body) return undefined
      const declaredSize = Number(response.headers.get('content-length') ?? 0)
      if (declaredSize > MAX_IMAGE_BYTES) return undefined

      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response.body) {
        const buffer = Buffer.from(chunk)
        size += buffer.length
        if (size > MAX_IMAGE_BYTES) return undefined
        chunks.push(buffer)
      }
      const body = Buffer.concat(chunks)
      const extension = imageExtension(body)
      if (!extension) return undefined

      await mkdir(directory, { recursive: true })
      const filename = `${hash}${extension}`
      const path = join(directory, filename)
      const temporaryPath = `${path}.${randomUUID()}.tmp`
      await writeFile(temporaryPath, body, { mode: 0o600 })
      try {
        await rename(temporaryPath, path)
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined)
        try {
          await access(path)
        } catch {
          throw error
        }
      }
      await this.#trimCache(directory)
      return this.#localUrl(accountId, filename)
    } catch {
      return undefined
    }
  }

  async #findExisting(directory: string, hash: string): Promise<string | undefined> {
    for (const extension of imageExtensions) {
      const filename = `${hash}${extension}`
      try {
        await access(join(directory, filename))
        return filename
      } catch {
        // 继续检查其他受支持格式。
      }
    }
    return undefined
  }

  async #fetchWithSafeRedirects(initialUrl: URL, signal: AbortSignal): Promise<Response | undefined> {
    let url = initialUrl
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!(await isPublicHttpsUrl(url))) return undefined
      const response = await fetch(url, { redirect: 'manual', signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) return response
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location || redirects === 3) return undefined
      url = new URL(location, url)
    }
    return undefined
  }

  async #trimCache(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    const files = await Promise.all(entries
      .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.(?:jpg|png|gif|webp)$/.test(entry.name))
      .map(async (entry) => {
        const path = join(directory, entry.name)
        const details = await stat(path)
        return { path, size: details.size, modifiedAt: details.mtimeMs }
      }))
    let totalSize = files.reduce((sum, file) => sum + file.size, 0)
    for (const file of files.sort((a, b) => a.modifiedAt - b.modifiedAt)) {
      if (totalSize <= MAX_ACCOUNT_CACHE_BYTES) break
      await unlink(file.path).catch(() => undefined)
      totalSize -= file.size
    }
  }

  #localUrl(accountId: string, filename: string): string {
    return `/media/${encodeURIComponent(accountId)}/${filename}`
  }
}
