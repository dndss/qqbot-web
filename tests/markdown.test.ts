import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { renderMarkdown, renderMarkdownParts } from '../public/markdown.js'
import { createReferenceFixture } from './reference-fixture.ts'
import { officialMenuEvent, officialMenuParts } from './markdown-fixture.ts'

test('Markdown renders formatting, line breaks, tables and safe links', () => {
  const html = renderMarkdown('# 标题\n\n**粗体** *斜体* ~~删除~~\n换行\n\n- 列表\n\n> 引用\n\n```js\nconst value = "<tag>"\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[链接](https://example.com)')
  for (const expected of ['<h1>标题</h1>', '<strong>粗体</strong>', '<em>斜体</em>', '<s>删除</s>', '<br>', '<ul>', '<blockquote>', '<table>', 'class="language-js"', '&lt;tag&gt;']) assert.ok(html.includes(expected), expected)
  assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/)
})

test('QQ images preserve the supplied URL and dimensions, including linked images', () => {
  const url = 'https://qq.example/image.png?key=abc&size=1'
  const html = renderMarkdown(`![#1200 #800](${url})`)
  assert.match(html, /src="https:\/\/qq.example\/image.png\?key=abc&amp;size=1"/)
  assert.match(html, /width="1200" height="800"/)
  assert.match(html, /alt="消息图片"/)
  assert.match(html, /loading="lazy"/)
  const icon = renderMarkdown('![伊蕾娜 #20px #20px](https://qq.example/icon.png)')
  assert.match(icon, /alt="伊蕾娜"/)
  assert.match(icon, /width="20" height="20"/)
  assert.match(renderMarkdown('![说明 #32 #24](https://qq.example/icon.png)'), /width="32" height="24"/)
  assert.doesNotMatch(renderMarkdown('![#0 #200](https://qq.example/image.png)'), /width=/)
  const linked = renderMarkdown('[![图片](https://qq.example/a.png)](https://example.com)')
  assert.equal((linked.match(/<a /g) || []).length, 1)
  assert.match(linked, /href="https:\/\/example.com"/)
})

test('received text and mentions render as one Markdown document, including real QQ menu syntax', () => {
  const parts = officialMenuParts()
  assert.deepEqual(parts.map((part) => part.type), ['text', 'at', 'text'])
  const html = renderMarkdownParts(parts)
  for (const expected of ['<h1>', '🍹伊蕾娜菜单', '<blockquote>', '@测试成员', 'width="20" height="20"', 'data-qq-command="娱乐菜单"', 'data-qq-command="QQ秀"', '<hr>', 'https://docs.qq.com/']) assert.ok(html.includes(expected), expected)
  assert.equal((html.match(/class="message-command"/g) || []).length, 7)
  assert.equal((html.match(/<img /g) || []).length, 2)
  assert.doesNotMatch(html, /href="mqqapi:/)
  const mention = renderMarkdownParts([{ type: 'text', text: '> **' }, { type: 'at', userId: 'test', name: '*<img src=x onerror=alert(1)>*' }, { type: 'text', text: '** 后文' }])
  assert.match(mention, /<strong><span class="message-mention">@\*&lt;img/)
  assert.doesNotMatch(mention, /<img/)
})

test('QQ commands become local buttons, while unrelated protocols and command images stay inert', () => {
  const html = renderMarkdown('[菜单](mqqapi://aio/inlinecmd?command=%E6%B5%8B%E8%AF%95%22%3C%26&enter=true&reply=true)')
  assert.match(html, /<button type="button" class="message-command" data-qq-command="测试&quot;&lt;&amp;">菜单<\/button>/)
  assert.doesNotMatch(html, /href=|onclick=/)
  for (const url of ['mqqapi://evil/inlinecmd?command=test', 'mqqapi://aio/other?command=test', 'mqqapi://aio/inlinecmd?command=', 'mqqapi://aio/inlinecmd?command=a&command=b', 'mqqapi://user@aio/inlinecmd?command=x', 'mqqapi://aio:123/inlinecmd?command=x', 'javascript:alert(1)']) {
    assert.doesNotMatch(renderMarkdown(`[菜单](${url})`), /<button|<a /)
  }
  assert.doesNotMatch(renderMarkdown('![图片](mqqapi://aio/inlinecmd?command=test)'), /<img|<button|<a /)
})

test('HTML and unsafe URLs cannot execute; QQ mentions render only outside code', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))\n![x](data:image/png;base64,AAAA)\n[x](file:///etc/passwd)\n[x](jav&#x61;script:alert(1))')
  assert.doesNotMatch(html, /<(script|img)\b|(?:href|src)="(?:javascript|data|file):/i)
  assert.match(html, /&lt;script&gt;/)
  assert.match(renderMarkdown('<qqbot-at-user id="user-123" />'), /class="message-mention">@user-123<\/span>/)
  assert.match(renderMarkdown('<qqbot-at-user id="all" />'), /@所有人/)
  assert.doesNotMatch(renderMarkdown('`<qqbot-at-user id="all" />`\n\n```\n<qqbot-at-user id="all" />\n```'), /<span/)
})

test('real server normalization and sends retain Markdown through persistence and SSE', async (t) => {
  const { directory, store, conversation } = await createReferenceFixture()
  t.after(() => {
    assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}web-qq-reference-`))
    return rm(directory, { recursive: true, force: true })
  })
  const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8')
  const functions = source.slice(source.indexOf('async function normalizeMessagePart('), source.indexOf('function forwardPart('))
    + source.slice(source.indexOf('async function sendMessage('), source.indexOf('async function recallMessage('))
  const events: unknown[] = []
  const sent: unknown[] = []
  const api = runInNewContext(`${stripTypeScriptTypes(functions)}\n({ normalizeMessageParts, messagePreview, sendMessage })`, {
    store,
    connectionState: 'connected',
    bot: { self_id: 'bot', sendGroupMessage: async (_id: string, payload: unknown) => { sent.push(payload); return { id: `sent-${sent.length}` } } },
    segment: { markdown: (content: string) => ({ type: 'markdown', data: { content } }), text: (text: string) => ({ type: 'text', data: { text } }) },
    publish: (event: string, data: unknown) => events.push({ event, data }),
  })
  const content = '**Markdown**\n![#300 #200](https://qq.example/image.png)'
  const parts = await api.normalizeMessageParts({ message: [{ type: 'markdown', data: { content } }, { type: 'text', data: { text: '**普通文本**' } }] }, 'test')
  assert.deepEqual(JSON.parse(JSON.stringify(parts)), [{ type: 'markdown', text: content }, { type: 'text', text: '**普通文本**' }])
  assert.equal(api.messagePreview(parts), content + '**普通文本**')
  const menuParts = await api.normalizeMessageParts(officialMenuEvent(), 'test')
  assert.deepEqual(JSON.parse(JSON.stringify(menuParts)), officialMenuParts())
  assert.match(renderMarkdownParts(menuParts), /data-qq-command="娱乐菜单"/)
  const message = await api.sendMessage(conversation, { type: 'markdown', content })
  assert.deepEqual(sent[0], { type: 'markdown', data: { content } })
  assert.equal(message.parts[0].type, 'markdown')
  assert.equal(message.content, content)
  assert.equal((events[0] as any).data.message.parts[0].type, 'markdown')
  await store.initialize()
  assert.deepEqual(store.getMessage(conversation.id, message.id)?.parts, [{ type: 'markdown', text: content }])
  const text = await api.sendMessage(conversation, { type: 'text', content: '**普通文本**' })
  assert.equal(text.parts[0].type, 'text')
})
