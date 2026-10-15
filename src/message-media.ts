import type { MessagePart } from './types.ts'

export function messageElementUrl(data: Record<string, unknown>): string | undefined {
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

/** Consume SDK audio metadata here; attachment classification remains in the SDK. */
export function normalizeMediaPart(type: 'video' | 'audio' | 'file', data: Record<string, unknown>): MessagePart {
  const url = messageElementUrl(data)
  const wavUrl = type === 'audio' ? messageElementUrl({ url: data.voice_wav_url }) : undefined
  const nameValue = data.name ?? data.filename
  const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : undefined
  const description = typeof data.description === 'string' && data.description.trim() ? data.description.trim() : undefined
  return {
    type,
    ...(url ? { url } : {}),
    ...(wavUrl ? { wavUrl } : {}),
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  }
}
