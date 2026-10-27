import MarkdownIt from 'markdown-it/browser'

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true })
const escape = markdown.utils.escapeHtml
const defaultValidateLink = markdown.validateLink.bind(markdown)
function isWebUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url, 'https://markdown.invalid/').protocol)
  } catch {
    return false
  }
}

function inlineCommand(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'mqqapi:' || parsed.hostname !== 'aio' || parsed.pathname !== '/inlinecmd'
      || parsed.username || parsed.password || parsed.port || parsed.hash) return null
    const commands = parsed.searchParams.getAll('command')
    return commands.length === 1 && commands[0].trim() ? commands[0] : null
  } catch {
    return null
  }
}

markdown.validateLink = (url) => defaultValidateLink(url) && (isWebUrl(url) || inlineCommand(url) !== null)

// QQ 的 @ 标签是独立语法；其余 HTML 仍作为文字显示。
markdown.inline.ruler.before('autolink', 'qq_mention', (state, silent) => {
  if (state.src[state.pos] !== '<') return false
  const match = /^<qqbot-at-user\s+id\s*=\s*(["'])([^"'<>]+)\1\s*\/?>/i.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) {
    const token = state.push('qq_mention', '', 0)
    token.content = match[2]
  }
  state.pos += match[0].length
  return true
})
markdown.renderer.rules.qq_mention = (tokens, index, _options, env) => {
  const id = tokens[index].content
  const label = env.mentions?.get(id) || (id === 'all' ? '所有人' : id)
  return `<span class="message-mention">@${escape(label)}</span>`
}

const renderLink = markdown.renderer.rules.link_open || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options))
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const command = inlineCommand(tokens[index].attrGet('href') || '')
  env.commandLinks ??= []
  env.commandLinks.push(command !== null)
  if (command !== null) {
    return `<button type="button" class="message-command" data-qq-command="${escape(command)}">`
  }
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return renderLink(tokens, index, options, env, self)
}
markdown.renderer.rules.link_close = (_tokens, _index, _options, env) => env.commandLinks.pop() ? '</button>' : '</a>'

const renderImage = markdown.renderer.rules.image
markdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]
  if (!isWebUrl(token.attrGet('src') || '')) {
    return `<span class="message-media-fallback">[图片地址无效：${escape(token.content)}]</span>`
  }
  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  token.attrSet('referrerpolicy', 'no-referrer')
  let image = renderImage(tokens, index, options, env, self)
  const dimensions = /^(.*?)\s*#(\d+)(?:px)?\s+#(\d+)(?:px)?\s*$/i.exec(token.attrGet('alt') || '')
  if (dimensions && dimensions.slice(2).every((value) => Number.isSafeInteger(Number(value)) && Number(value) > 0)) {
    token.attrSet('width', String(Number(dimensions[2])))
    token.attrSet('height', String(Number(dimensions[3])))
    token.attrSet('style', `aspect-ratio: ${Number(dimensions[2])} / ${Number(dimensions[3])}`)
    token.attrSet('alt', dimensions[1].trim() || '消息图片')
    image = self.renderToken(tokens, index, options)
  }
  // 图片若已处于 Markdown 链接中，保留外层链接，避免嵌套 a 元素。
  const linked = tokens.slice(0, index).reduce((depth, item) => depth + (item.type === 'link_open' ? 1 : item.type === 'link_close' ? -1 : 0), 0)
  return linked ? image : `<a href="${escape(token.attrGet('src') || '')}" target="_blank" rel="noopener noreferrer">${image}</a>`
}

export function renderMarkdown(source) {
  return markdown.render(source)
}

export function renderMarkdownParts(parts) {
  const mentions = new Map()
  const source = parts.map((part) => {
    if (part.type !== 'at') return String(part.text || '')
    const id = encodeURIComponent(String(part.userId || '用户'))
    mentions.set(id, String(part.name || (part.userId === 'all' ? '所有人' : part.userId || '用户')))
    return `<qqbot-at-user id="${id}" />`
  }).join('')
  return markdown.render(source, { mentions })
}

export function appendMarkdown(container, source, { onCommand, inline = false } = {}) {
  const content = document.createElement('div')
  content.className = 'message-markdown'
  content.classList.toggle('message-markdown-inline', inline)
  content.innerHTML = Array.isArray(source) ? renderMarkdownParts(source) : renderMarkdown(source)
  for (const button of content.querySelectorAll('.message-command')) {
    button.disabled = !onCommand
    button.addEventListener('click', () => onCommand?.(button.dataset.qqCommand))
  }
  for (const image of content.querySelectorAll('img')) {
    image.addEventListener('error', () => {
      const fallback = document.createElement('span')
      fallback.className = 'message-media-fallback'
      fallback.textContent = `[图片加载失败：${image.alt || '消息图片'}]`
      image.replaceWith(fallback)
    }, { once: true })
  }
  container.append(content)
}
