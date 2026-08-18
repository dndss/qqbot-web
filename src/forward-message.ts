import type { MediaCache } from './media-cache.ts'
import type { ForwardAttachmentPart, ForwardMessagePart, ForwardNodePart } from './types.ts'

const MAX_CACHED_IMAGES_PER_FORWARD = 20

type NumberedSection = { index: number; body: string }

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function normalizeAttachment(value: unknown): ForwardAttachmentPart | undefined {
  const attachment = recordValue(value)
  if (!attachment) return undefined
  const rawType = optionalString(attachment.raw_type) ?? '文件'
  const rawKind = optionalString(attachment.type)
  const kind = ['image', 'video', 'audio', 'file'].includes(rawKind ?? '')
    ? rawKind as ForwardAttachmentPart['kind']
    : 'file'
  return {
    index: optionalNumber(attachment.index) ?? 0,
    kind,
    rawType,
    ...(optionalString(attachment.file_name) ? { name: optionalString(attachment.file_name) } : {}),
    ...(optionalNumber(attachment.width) !== undefined ? { width: optionalNumber(attachment.width) } : {}),
    ...(optionalNumber(attachment.height) !== undefined ? { height: optionalNumber(attachment.height) } : {}),
    ...(optionalString(attachment.size_text) ? { sizeText: optionalString(attachment.size_text) } : {}),
    ...(optionalString(attachment.url) ? { url: optionalString(attachment.url) } : {}),
    ...(attachment.animated === true ? { animated: true } : {}),
  }
}

function normalizeNode(value: unknown): ForwardNodePart | undefined {
  const node = recordValue(value)
  if (!node) return undefined
  const senderName = optionalString(node.sender_name)
  if (!senderName) return undefined
  const attachments = Array.isArray(node.attachments)
    ? node.attachments.map(normalizeAttachment).filter((item): item is ForwardAttachmentPart => Boolean(item))
    : []
  const children = Array.isArray(node.children)
    ? node.children.map(normalizeNode).filter((item): item is ForwardNodePart => Boolean(item))
    : []
  return {
    index: optionalNumber(node.index) ?? 0,
    senderName,
    content: typeof node.content === 'string' ? node.content : '',
    ...(attachments.length ? { attachments } : {}),
    ...(children.length ? { children } : {}),
  }
}

export function normalizeForwardData(value: unknown): ForwardMessagePart | undefined {
  const data = recordValue(value)
  if (!data || !Array.isArray(data.nodes)) return undefined
  const title = optionalString(data.title)
  const nodes = data.nodes.map(normalizeNode).filter((item): item is ForwardNodePart => Boolean(item))
  if (!title || !nodes.length) return undefined
  return { type: 'forward', title, nodes }
}

function splitNumberedSections(content: string, marker: RegExp): NumberedSection[] | undefined {
  const matches = [...content.matchAll(marker)]
  if (!matches.length || content.slice(0, matches[0].index).trim()) return undefined
  return matches.map((match, index) => ({
    index: Number(match[1]),
    body: content
      .slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? content.length)
      .replace(/^\n/, '')
      .replace(/\n+$/, ''),
  }))
}

function dedent(content: string): string {
  const lines = content.split('\n')
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0)
  const indent = indents.length ? Math.min(...indents) : 0
  return indent ? lines.map((line) => line.slice(Math.min(indent, line.length))).join('\n') : content
}

function parseAttachment(index: number, content: string): ForwardAttachmentPart | undefined {
  const matches = [...content.matchAll(/(?:^|[ \t]+)(类型|文件名|尺寸|大小|URL):/g)]
  const fields: Record<string, string> = {}
  for (let position = 0; position < matches.length; position++) {
    const match = matches[position]
    const start = (match.index ?? 0) + match[0].length
    fields[match[1]] = content.slice(start, matches[position + 1]?.index ?? content.length).trim()
  }
  const rawType = fields['类型']
  if (!rawType) return undefined
  const animated = rawType === '动图'
  const kind: ForwardAttachmentPart['kind'] = animated || rawType.includes('图片')
    ? 'image'
    : rawType.includes('视频')
      ? 'video'
      : rawType.includes('语音') || rawType.includes('音频')
        ? 'audio'
        : 'file'
  const size = fields['尺寸']?.match(/^(\d+)x(\d+)$/i)
  return {
    index,
    kind,
    rawType,
    ...(fields['文件名'] ? { name: fields['文件名'] } : {}),
    ...(size ? { width: Number(size[1]), height: Number(size[2]) } : {}),
    ...(fields['大小'] ? { sizeText: fields['大小'] } : {}),
    ...(fields['URL'] ? { url: fields['URL'] } : {}),
    ...(animated ? { animated: true } : {}),
  }
}

function parseNodes(content: string, nested = false): ForwardNodePart[] | undefined {
  const marker = nested ? /^[ \t]*--- 第(\d+)条 ---$/gm : /^[ \t]*=== 消息 (\d+) ===$/gm
  const sections = splitNumberedSections(content, marker)
  if (!sections) return undefined
  const nodes: ForwardNodePart[] = []
  for (const section of sections) {
    const node = parseNode(nested ? dedent(section.body) : section.body, section.index)
    if (!node) return undefined
    nodes.push(node)
  }
  return nodes
}

function parseNode(content: string, index: number): ForwardNodePart | undefined {
  const nestedPrefix = '[消息类型] 合并转发消息\n[关联消息]\n'
  const nestedIndex = content.indexOf(nestedPrefix)
  const nodeContent = nestedIndex >= 0 ? content.slice(0, nestedIndex) : content
  const nestedContent = nestedIndex >= 0 ? content.slice(nestedIndex + nestedPrefix.length) : ''
  const lines = nodeContent.replace(/\n+$/, '').split('\n')
  const senderIndex = lines.findLastIndex((line) => /^\[发送者\][ \t]*\S/.test(line))
  if (senderIndex < 0) return undefined
  const senderName = lines[senderIndex].replace(/^\[发送者\][ \t]*/, '').trim()
  const contentLines: string[] = []
  const attachments: ForwardAttachmentPart[] = []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (lineIndex === senderIndex) continue
    const match = lines[lineIndex].match(/^\[附件(\d+)\][ \t]*(.*)$/)
    const attachment = match ? parseAttachment(Number(match[1]), match[2]) : undefined
    if (attachment) attachments.push(attachment)
    else contentLines.push(lines[lineIndex])
  }
  while (contentLines.length && !contentLines[0].trim()) contentLines.shift()
  while (contentLines.length && !contentLines.at(-1)?.trim()) contentLines.pop()
  if (contentLines[0]?.startsWith('[消息内容]')) {
    contentLines[0] = contentLines[0].slice('[消息内容]'.length).replace(/^ /, '')
  }
  const children = nestedContent ? parseNodes(nestedContent, true) : undefined
  if (nestedContent && !children) return undefined
  return {
    index,
    senderName,
    content: contentLines.join('\n'),
    ...(attachments.length ? { attachments } : {}),
    ...(children?.length ? { children } : {}),
  }
}

export function parseForwardText(content: string): ForwardMessagePart | undefined {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n+$/, '')
  const title = normalized.match(/^\[([^\n]+)\]\n/)?.[1]
  if (!title) return undefined
  const nodes = parseNodes(normalized.slice(title.length + 3))
  return nodes?.length ? { type: 'forward', title, nodes } : undefined
}

function forwardAttachments(nodes: ForwardNodePart[]): ForwardAttachmentPart[] {
  return nodes.flatMap((node) => [
    ...(node.attachments ?? []),
    ...forwardAttachments(node.children ?? []),
  ])
}

export function hasUncachedForwardImages(part: ForwardMessagePart): boolean {
  return forwardAttachments(part.nodes).some((attachment) => attachment.kind === 'image' && attachment.url && !attachment.localUrl)
}

export async function cacheForwardImages(
  part: ForwardMessagePart,
  accountId: string,
  mediaCache: MediaCache,
): Promise<ForwardMessagePart> {
  const cached = structuredClone(part)
  const images = forwardAttachments(cached.nodes)
    .filter((attachment) => attachment.kind === 'image' && attachment.url && !attachment.localUrl)
    .slice(0, MAX_CACHED_IMAGES_PER_FORWARD)
  await Promise.all(images.map(async (attachment) => {
    attachment.localUrl = await mediaCache.cacheImage(accountId, attachment.url!)
  }))
  return cached
}
