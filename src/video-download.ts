import type { IncomingMessage, ServerResponse } from 'node:http'
import { findMessageMedia, handleMediaDownload, mediaContentDisposition, mediaDownloadName, openMediaSource } from './media-download.ts'
import type { SourceLoader } from './media-download.ts'
import type { JsonStore } from './store.ts'
import type { StoredMessage } from './types.ts'

// Preserve the existing video helper API while sharing the transfer logic with audio.
export const openVideoSource = openMediaSource

export function findMessageVideo(message: StoredMessage, index: number) {
  return findMessageMedia(message, 'video', index)
}

export function videoDownloadName(name: string | undefined, contentType: string, header: Buffer, timestamp: number): string {
  return mediaDownloadName('video', name, contentType, header, timestamp)
}

export function videoContentDisposition(name: string): string {
  return mediaContentDisposition('video', name)
}

export function handleVideoDownload(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  store: Pick<JsonStore, 'getActiveAccount' | 'getMessage'>,
  loadSource: SourceLoader = openMediaSource,
): Promise<boolean> {
  return handleMediaDownload(request, response, url, store, loadSource, 'video')
}
