import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createReferenceFixture } from './reference-fixture.ts'
import { handleMediaDownload } from '../src/media-download.ts'
import { amrBytes, audioName, officialAudioPart, wavBytes } from './audio-fixture.ts'
import { officialMenuParts } from './markdown-fixture.ts'

const playwright = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : 'playwright')
const { chromium } = playwright.default ?? playwright
const fixture = await createReferenceFixture()
const markdownSource = '# Markdown 消息\n\n**粗体**、*斜体*、~~删除线~~，还有 `代码`。\n下一行\n\n- 列表一\n- 列表二\n\n> 引用内容\n\n| 名称 | 状态 |\n| --- | --- |\n| 渲染 | 完成 |\n\n[示例链接](https://example.com) <qqbot-at-user id="test-user" />\n\n![#1200 #800](/test-markdown-image.svg)\n\n![失效图片](/test-markdown-missing.png)\n\n<img src=x onerror="window.markdownUnsafe=true">'
const outgoingMarkdown = '# 机器人回复\n\n**渲染成功**\n\n> 支持引用和链接\n\n```js\nconst example = "' + '长代码'.repeat(100) + '"\n```\n\n![#120 #80](/test-markdown-image.svg)'
await fixture.store.updateMessage(fixture.conversation.id, 'message-429', { direction: 'incoming', content: markdownSource, parts: [{ type: 'markdown', text: markdownSource }] })
await fixture.store.updateMessage(fixture.conversation.id, 'message-428', { direction: 'outgoing', content: outgoingMarkdown, parts: [{ type: 'markdown', text: outgoingMarkdown }] })
await fixture.store.updateMessage(fixture.conversation.id, 'message-427', { content: '**普通文本**', parts: [{ type: 'text', text: '**普通文本**' }] })
const menuParts = officialMenuParts()
const menuContent = menuParts.map((part) => part.type === 'at' ? `@${part.name}` : part.type === 'text' ? part.text : '').join('')
await fixture.store.updateMessage(fixture.conversation.id, 'message-426', { content: menuContent, parts: menuParts })
await fixture.store.updateMessage(fixture.conversation.id, 'message-424', { content: '# 历史文本也能渲染\n\n**历史粗体**' })
await fixture.store.updateMessage(fixture.conversation.id, 'message-422', { content: '前[表情]后', parts: [{ type: 'text', text: '前' }, { type: 'face', id: '0' }, { type: 'text', text: '后' }] })
const videoName = '3e80857c0172a44d9eeeea9fcb92c6ac.mp4'
const videoBytes = Buffer.concat([
  Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex'),
  Buffer.alloc(100, 0x42),
])
await fixture.store.updateMessage(fixture.conversation.id, 'message-435', {
  parts: [{ type: 'video', url: 'https://video.example/download', name: videoName }],
})
await fixture.store.updateMessage(fixture.conversation.id, 'message-432', {
  parts: [officialAudioPart()],
})
await fixture.store.updateMessage(fixture.conversation.id, 'message-431', {
  parts: [
    { type: 'audio', name: '无副本.amr', url: 'https://audio.example/original' },
    { type: 'file', name: '普通文件.amr', url: 'https://audio.example/file' },
  ],
})
await fixture.store.updateMessage(fixture.conversation.id, 'message-433', {
  parts: [
    { type: 'video' },
    { type: 'audio' },
    { type: 'forward', title: 'Videos', nodes: [{
      index: 0, senderName: 'Test sender', content: '',
      attachments: [
        { index: 0, kind: 'video', rawType: '视频', url: 'https://video.example/download' },
        { index: 1, kind: 'audio', rawType: '语音', url: 'https://audio.example/original', name: '转发语音.amr' },
      ],
      children: [{
        index: 0, senderName: 'Test sender', content: '',
        attachments: [
          { index: 0, kind: 'video', rawType: '视频', url: 'https://video.example/download', name: '中文视频.mp4' },
          { index: 1, kind: 'audio', rawType: '语音', url: 'https://audio.example/original', wavUrl: 'https://audio.example/copy.wav', name: '嵌套语音.amr' },
        ],
      }],
    }] },
    { type: 'audio', url: 'https://audio.example/download' },
  ],
})
const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public')
const outputDirectory = process.env.TEST_OUTPUT_DIR || resolve(publicDirectory, '../data/test-results/reference')
await mkdir(outputDirectory, { recursive: true })
const primaryAccountId = fixture.store.getActiveAccount().id
const otherAccount = await fixture.store.saveAccount({ appid: 'other-test', secret: 'test-only', name: 'Other Bot', sandbox: true })
await fixture.store.selectAccount(primaryAccountId)
let referenceRequests = 0
let delayReference = false
let failPlayback = false
let messageSendRequests = 0
const streamRequests = []
const eventStreams = new Set()
const broadcast = (event, payload) => {
  for (const response of eventStreams) response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}
const status = { state: 'disconnected', error: '', selfId: null, account: { id: fixture.store.getActiveAccount().id, name: 'Test Bot' } }
const currentStatus = () => ({ ...status, account: { id: fixture.store.getActiveAccount().id, name: fixture.store.getActiveAccount().name } })
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    const json = (code, value) => {
      response.writeHead(code, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (url.pathname === '/test-markdown-image.svg') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' })
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#e5f2ff"/><circle cx="600" cy="350" r="150" fill="#268cf1"/><text x="600" y="650" text-anchor="middle" font-size="60" fill="#172033">QQ Markdown Image</text></svg>')
    }
    if (url.pathname === '/test-markdown-missing.png') { response.writeHead(404); return response.end() }
    if (url.pathname === '/api/status') return json(200, currentStatus())
    if (url.pathname === '/api/accounts') return json(200, fixture.store.listAccounts())
    if (url.pathname === '/api/conversations') return json(200, fixture.store.listConversations())
    if (url.pathname === '/api/accounts/select' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      await fixture.store.selectAccount(JSON.parse(body).accountId)
      const snapshot = { accounts: fixture.store.listAccounts(), conversations: fixture.store.listConversations(), status: currentStatus() }
      broadcast('reset', snapshot)
      return json(200, snapshot)
    }
    if (url.pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      eventStreams.add(response)
      response.once('close', () => eventStreams.delete(response))
      response.write(`event: status\ndata: ${JSON.stringify(currentStatus())}\n\n`)
      return
    }
    const playback = url.pathname.endsWith('/stream')
    if (playback) streamRequests.push({ path: url.pathname, range: request.headers.range })
    if (await handleMediaDownload(request, response, url, fixture.store, async (source, _signal, options) => {
      const full = source.hostname === 'audio.example' ? source.pathname.endsWith('.wav') ? wavBytes : amrBytes : videoBytes
      const match = options?.range?.match(/^bytes=(\d*)-(\d*)$/)
      const start = match ? match[1] ? Number(match[1]) : Math.max(0, full.length - Number(match[2])) : 0
      const end = match && match[1] && match[2] ? Math.min(Number(match[2]), full.length - 1) : full.length - 1
      const bytes = full.subarray(start, end + 1)
      return Object.assign(Readable.from([bytes], { objectMode: false }), {
        statusCode: playback && failPlayback ? 403 : match ? 206 : 200,
        headers: {
          'content-type': 'application/octet-stream', 'content-length': String(bytes.length),
          ...(match ? { 'content-range': `bytes ${start}-${end}/${full.length}` } : {}),
        },
      })
    })) return
    const reference = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)\/reference$/)
    if (reference) {
      referenceRequests += 1
      if (delayReference) await new Promise((resolve) => setTimeout(resolve, 500))
      const conversationId = decodeURIComponent(reference[1])
      const target = fixture.store.getMessageReference(conversationId, decodeURIComponent(reference[2]))
      if (!target) return json(404, { error: '原消息未保存在当前会话中，无法定位' })
      return json(200, {
        ...fixture.store.listMessagesPage(conversationId, 200, url.searchParams.get('before') || undefined, target.id),
        messageId: target.id,
      })
    }
    const messages = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/)
    if (messages && request.method === 'POST') { messageSendRequests++; return json(409, { error: 'Test does not send messages' }) }
    if (messages) return json(200, fixture.store.listMessagesPage(
      decodeURIComponent(messages[1]), 200, url.searchParams.get('before') || undefined,
    ))
    if (url.pathname.endsWith('/read')) return json(200, { ok: true })
    const vendor = url.pathname === '/vendor/markdown-it.js'
    const path = vendor ? fileURLToPath(import.meta.resolve('markdown-it/browser')) : resolve(publicDirectory, url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
    if (!vendor) assert.ok(path.startsWith(`${publicDirectory}\\`) || path.startsWith(`${publicDirectory}/`))
    const body = await readFile(path)
    response.writeHead(200, { 'Content-Type': path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript' })
    response.end(body)
  } catch (error) {
    response.writeHead(500)
    response.end(String(error))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(edge) ? { executablePath: edge } : {}),
})
const errors = []
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const mockMenuImages = (target) => target.route('https://qqbot.ugcimg.cn/**', (route) => route.fulfill({
  contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#268cf1"/></svg>',
}))
await mockMenuImages(page)
await page.addInitScript(() => {
  // 验证复制内容，不修改用户的系统剪贴板。
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { window.testCopiedText = text } },
  })
})
page.on('pageerror', (error) => errors.push(String(error)))
const row = (id) => page.locator(`.message-row[data-message-id="${id}"]`)
const quote = (id) => row(id).locator('.message-quote-preview')
const expandQuote = async (id) => {
  if (await row(id).locator('details').getAttribute('open') === null) await quote(id).click()
  await row(id).locator('.message-quote-details > *').first().waitFor()
}
const locateQuote = async (id) => {
  assert.equal(await row(id).locator('details').count(), 0)
  await row(id).getByRole('button', { name: await quote(id).textContent(), exact: true }).click()
}
const selectFixture = async () => {
  const before = streamRequests.length
  await page.goto(url)
  // Each scenario starts with a fresh navigation state, including after a same-URL reload.
  await page.evaluate(() => history.replaceState(null, '', location.href))
  await page.getByRole('button', { name: 'Reference test', exact: false }).click()
  await row('message-449').waitFor()
  assert.equal(streamRequests.length, before, 'preload=none must not request playback before user interaction')
}
const openMessageData = async (id) => {
  if (page.viewportSize().width <= 760) {
    const more = row(id).getByRole('button', { name: '操作 Test sender 的消息', exact: true })
    await more.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await more.click()
  } else {
    const bubble = row(id).locator('.message-bubble')
    await bubble.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await bubble.click({ button: 'right' })
  }
  await page.locator('#context-menu').getByRole('button', { name: '查看消息数据', exact: true }).click()
  await page.getByRole('dialog', { name: '消息数据', exact: true }).waitFor()
}
const verifyMessageData = async () => {
  const dialog = page.getByRole('dialog', { name: '消息数据', exact: true })
  const json = dialog.locator('#message-data-json')
  for (const id of ['message-426', 'message-440', 'message-437', 'message-434', 'message-428']) {
    await openMessageData(id)
    const text = await json.textContent()
    assert.equal(text, JSON.stringify(fixture.store.getMessage(fixture.conversation.id, id), null, 2))
    assert.equal(Object.hasOwn(JSON.parse(text), 'reference'), false)
    assert.equal(await json.locator('img, script').count(), 0, 'JSON is displayed as text')
    await dialog.getByRole('button', { name: '复制 JSON', exact: true }).click()
    assert.equal(await page.evaluate(() => window.testCopiedText), text)
    await dialog.getByRole('status').filter({ hasText: 'JSON 已复制' }).waitFor()
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= page.viewportSize().width && bounds.y + bounds.height <= page.viewportSize().height)
    if (id === 'message-426') await page.screenshot({ path: join(outputDirectory, `message-data-${page.viewportSize().width}.png`) })
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.getElementById('message-data-json').textContent === '')
  }
  await openMessageData('message-426')
  const recalled = await fixture.store.updateMessage(fixture.conversation.id, 'message-426', { status: 'recalled' })
  broadcast('message-update', recalled)
  await page.waitForFunction(() => JSON.parse(document.getElementById('message-data-json').textContent).status === 'recalled')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  const restored = await fixture.store.updateMessage(fixture.conversation.id, 'message-426', { status: 'received' })
  broadcast('message-update', restored)
  await row('message-426').locator('h1').waitFor()

  // A modal makes the rest of the page inert: the fallback textarea must be inside it.
  await openMessageData('message-426')
  const text = await json.textContent()
  await page.evaluate(() => {
    window.savedDataClipboard = navigator.clipboard
    window.savedDataExecCommand = document.execCommand
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    document.execCommand = (command) => {
      window.testCopiedText = document.activeElement.value
      window.copyBufferInDialog = document.activeElement.closest('dialog')?.id === 'message-data-dialog'
      return command === 'copy'
    }
  })
  await dialog.getByRole('button', { name: '复制 JSON', exact: true }).click()
  assert.equal(await page.evaluate(() => window.testCopiedText), text)
  assert.equal(await page.evaluate(() => window.copyBufferInDialog), true)
  assert.equal(await page.locator('.clipboard-copy-buffer').count(), 0)
  await page.evaluate(() => { document.execCommand = () => false })
  await dialog.getByRole('button', { name: '复制 JSON', exact: true }).click()
  await dialog.getByRole('status').filter({ hasText: '复制失败，请检查浏览器剪贴板权限' }).waitFor()
  assert.equal(await page.locator('.clipboard-copy-buffer').count(), 0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: window.savedDataClipboard })
    document.execCommand = window.savedDataExecCommand
  })
  broadcast('reset', { accounts: fixture.store.listAccounts(), conversations: fixture.store.listConversations(), status: currentStatus() })
  await dialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.getElementById('message-data-json').textContent === '')
}
try {
  await selectFixture()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 })
    await selectFixture()
    const incoming = row('message-429').locator('.message-markdown')
    const outgoing = row('message-428').locator('.message-markdown')
    assert.equal(await incoming.locator('h1').textContent(), 'Markdown 消息')
    assert.equal(await incoming.locator('strong').textContent(), '粗体')
    assert.equal(await incoming.locator('table tbody tr').count(), 1)
    assert.equal(await incoming.locator('.message-mention').textContent(), '@test-user')
    assert.equal(await incoming.locator('img[onerror], script').count(), 0)
    assert.equal(await page.evaluate(() => window.markdownUnsafe), undefined)
    assert.equal(await row('message-427').locator('.message-bubble').textContent(), '**普通文本**')
    assert.equal(await row('message-427').locator('strong').count(), 0)
    const image = incoming.locator('img')
    await image.first().scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('[data-message-id="message-429"] .message-media-fallback'))
    assert.equal(await image.count(), 1)
    assert.equal(await image.getAttribute('width'), '1200')
    assert.equal(await image.getAttribute('height'), '800')
    assert.equal(await image.getAttribute('src'), '/test-markdown-image.svg')
    const imageBounds = await image.boundingBox()
    const bubbleBounds = await row('message-429').locator('.message-bubble').boundingBox()
    assert.ok(imageBounds.width <= bubbleBounds.width)
    await incoming.locator('h1').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(outputDirectory, `markdown-incoming-${width}.png`) })
    await outgoing.scrollIntoViewIfNeeded()
    const code = outgoing.locator('pre')
    assert.ok(await code.evaluate((element) => element.scrollWidth > element.clientWidth), 'long code scrolls within the bubble')
    const bounds = await row('message-428').locator('.message-bubble').boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
    await page.screenshot({ path: join(outputDirectory, `markdown-outgoing-${width}.png`) })
    const menu = row('message-426').locator('.message-markdown')
    assert.equal(await menu.locator('h1').textContent(), '# 🍹伊蕾娜菜单(*´∀`)~♥'.slice(2))
    assert.equal(await menu.locator('blockquote .message-mention').textContent(), '@测试成员')
    assert.equal(await menu.getByRole('button').count(), 7)
    assert.equal(await menu.locator('hr').count(), 1)
    assert.equal(await menu.locator('a[href^="mqqapi:"]').count(), 0)
    assert.equal(await menu.locator('img[width="20"][height="20"][alt="伊蕾娜"]').count(), 2)
    await menu.locator('img').first().scrollIntoViewIfNeeded()
    const iconBounds = await menu.locator('img').first().boundingBox()
    assert.equal(iconBounds.width, 20)
    assert.equal(iconBounds.height, 20)
    assert.equal(await row('message-424').locator('h1').textContent(), '历史文本也能渲染')
    const face = row('message-422').locator('.message-face')
    const faceText = row('message-422').locator('.message-markdown').first()
    assert.ok(Math.abs((await face.boundingBox()).y - (await faceText.boundingBox()).y) < 20, 'text and QQ faces stay on the same line')
    const input = page.locator('#message-input')
    await input.fill('前后')
    await input.evaluate((element) => element.setSelectionRange(1, 1))
    const beforeUrl = page.url()
    const beforePages = page.context().pages().length
    await menu.getByRole('button', { name: '娱乐菜单', exact: true }).click()
    assert.equal(await input.inputValue(), '前娱乐菜单后')
    assert.equal(await input.evaluate((element) => element.selectionStart), 5)
    assert.equal(page.url(), beforeUrl)
    assert.equal(page.context().pages().length, beforePages)
    assert.equal(messageSendRequests, 0, 'menu clicks never send messages')
    await page.getByRole('button', { name: '通过 URL 发送视频', exact: true }).click()
    await menu.getByRole('button', { name: '小游戏', exact: true }).click()
    assert.equal(await input.isVisible(), true)
    assert.equal(await input.inputValue(), '前娱乐菜单小游戏后')
    assert.equal(messageSendRequests, 0)
    await input.fill('x'.repeat(1999))
    await menu.getByRole('button', { name: '娱乐菜单', exact: true }).click()
    assert.equal(await input.inputValue(), 'x'.repeat(1999))
    await page.getByRole('status').filter({ hasText: '输入内容已达到长度限制' }).waitFor()
    await input.fill('')
    await menu.locator('h1').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(outputDirectory, `qq-menu-${width}.png`) })
    await verifyMessageData()
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await selectFixture()
  await row('message-429').locator('h1').scrollIntoViewIfNeeded()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await row('message-429').locator('h1').click({ button: 'right' })
  await page.locator('#context-menu').getByRole('button', { name: '复制整条消息', exact: true }).click()
  assert.equal(await page.evaluate(() => window.testCopiedText), markdownSource)
  await selectFixture()
  assert.equal(await page.locator('.message-row').count(), 200)
  assert.equal(await row('message-030').count(), 0)
  assert.equal(await quote('message-440').textContent(), 'Test sender：Message 30')
  assert.equal(await row('message-440').locator('details').count(), 0)
  await row('message-440').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(outputDirectory, 'reference-preview-desktop.png') })
  await locateQuote('message-440')
  await row('message-030').and(page.locator('.message-highlighted')).waitFor()
  assert.equal(await page.locator('.message-row').count(), 440)
  assert.equal(referenceRequests, 1)
  assert.equal(await page.locator('.message-row').first().getAttribute('data-message-id'), 'message-010')
  await page.screenshot({ path: join(outputDirectory, 'reference-desktop.png') })
  await locateQuote('message-445')
  await row('message-430').and(page.locator('.message-highlighted')).waitFor()
  assert.equal(referenceRequests, 1)
  await quote('message-442').focus()
  await page.keyboard.press('Enter')
  await row('message-032').and(page.locator('.message-highlighted')).waitFor()
  assert.equal(await quote('message-444').textContent(), 'Test sender：[消息已撤回]')
  await locateQuote('message-444')
  await row('message-040').and(page.locator('.message-highlighted')).waitFor()
  assert.equal(await row('message-040').locator('.message-bubble').textContent(), '[消息已撤回]')
  await expandQuote('message-443')
  assert.equal(await row('message-443').getByRole('button', { name: '定位原消息' }).count(), 0)
  assert.equal(await row('message-443').locator('.message-quote-content').textContent(), '原消息未保存在当前会话中')

  const verifyNested = async () => {
    assert.equal(await row('message-437').locator('.message-bubble').textContent(), '4')
    assert.equal(await quote('message-437').textContent(), '引用消息')
    assert.equal(await row('message-437').locator('details').getAttribute('open'), null)
    await expandQuote('message-437')
    assert.deepEqual((await row('message-437').locator('.message-quote-content').allTextContents()).map((text) => text.trim()), ['3', '2', '1'])
    assert.equal(await row('message-437').getByRole('button', { name: '定位原消息' }).count(), 0)
    assert.equal(await row('message-437').textContent().then((text) => text.includes('TMP-')), false)
    await row('message-437').scrollIntoViewIfNeeded()
    await quote('message-437').click()
    assert.equal(await row('message-437').locator('details').getAttribute('open'), null)
    await expandQuote('message-437')
  }
  await verifyNested()
  await page.screenshot({ path: join(outputDirectory, 'nested-reference-desktop.png') })
  await expandQuote('message-438')
  assert.deepEqual(await row('message-438').locator('.message-quote-content').allTextContents(), ['1'])
  assert.equal(await row('message-438').getByRole('button', { name: '定位原消息' }).count(), 0)
  assert.equal(await quote('message-439').textContent(), 'Test sender：4')
  await locateQuote('message-439')
  await row('message-437').and(page.locator('.message-highlighted')).waitFor()
  assert.deepEqual((await row('message-437').locator('.message-quote-content').allTextContents()).map((text) => text.trim()), ['3', '2', '1'])
  await expandQuote('message-434')
  assert.equal(await row('message-434').locator('.message-quote-details img').count(), 0)
  assert.equal(await row('message-434').locator('.message-quote-content').textContent(), '<img src=x onerror="unsafe()">')

  const verifyVideoDownloads = async () => {
    const videoLink = row('message-435').getByRole('link', { name: `下载${videoName}`, exact: true })
    assert.match(await videoLink.getAttribute('href'), /^\/api\/conversations\/group%3Afixture\/messages\/message-435\/videos\/0\/download\?accountId=/)
    await videoLink.scrollIntoViewIfNeeded()
    const linkBounds = await videoLink.boundingBox()
    assert.ok(linkBounds && linkBounds.x >= 0 && linkBounds.x + linkBounds.width <= page.viewportSize().width)
    await page.screenshot({ path: join(outputDirectory, page.viewportSize().width <= 760 ? 'video-download-mobile.png' : 'video-download-desktop.png') })
    const downloadEvent = page.waitForEvent('download')
    await videoLink.click()
    const download = await downloadEvent
    assert.equal(download.suggestedFilename(), videoName)
    assert.equal(await download.failure(), null)
    assert.deepEqual(await readFile(await download.path()), videoBytes)
    const forwardedVideos = row('message-433').locator('.forward-attachment a[href*="/videos/"]')
    assert.equal(await forwardedVideos.count(), 2)
    assert.match(await forwardedVideos.nth(0).getAttribute('href'), /\/videos\/1\/download/)
    assert.match(await forwardedVideos.nth(1).getAttribute('href'), /\/videos\/2\/download/)
    const unicodeEvent = page.waitForEvent('download')
    await forwardedVideos.nth(1).click()
    const unicodeDownload = await unicodeEvent
    assert.equal(unicodeDownload.suggestedFilename(), '中文视频.mp4')
    assert.equal(await unicodeDownload.failure(), null)
    const unnamedEvent = page.waitForEvent('download')
    await forwardedVideos.nth(0).click()
    const unnamedDownload = await unnamedEvent
    assert.ok(unnamedDownload.suggestedFilename().endsWith('.mp4'))
    assert.equal(await unnamedDownload.failure(), null)
    assert.match(await row('message-433').getByRole('link', { name: '下载音频', exact: true }).getAttribute('href'), /\/audios\/3\/download/)
  }
  const verifyAudioDownloads = async () => {
    const original = row('message-432').getByRole('link', { name: `下载${audioName}`, exact: true })
    const wav = row('message-432').getByRole('link', { name: '下载 WAV', exact: true })
    assert.match(await original.getAttribute('href'), /\/audios\/0\/download\?accountId=/)
    assert.match(await wav.getAttribute('href'), /\/audios\/0\/download\?accountId=.*&format=wav$/)
    for (const [link, name, bytes] of [[original, audioName, amrBytes], [wav, audioName.replace(/\.amr$/, '.wav'), wavBytes]]) {
      const event = page.waitForEvent('download')
      await link.click()
      const download = await event
      assert.equal(download.suggestedFilename(), name)
      assert.equal(await download.failure(), null)
      assert.deepEqual(await readFile(await download.path()), bytes)
    }
    assert.equal(await row('message-431').getByRole('link', { name: '下载 WAV', exact: true }).count(), 0)
    assert.equal(await row('message-431').getByRole('link', { name: '打开普通文件.amr', exact: true }).getAttribute('href'), 'https://audio.example/file')
    assert.match(await row('message-433').getByRole('link', { name: '下载转发语音.amr', exact: true }).getAttribute('href'), /\/audios\/1\/download/)
    assert.match(await row('message-433').getByRole('link', { name: '下载嵌套语音.amr', exact: true }).getAttribute('href'), /\/audios\/2\/download/)
    const nested = row('message-433').getByRole('link', { name: '下载 WAV', exact: true })
    const event = page.waitForEvent('download')
    await nested.click()
    const download = await event
    assert.equal(download.suggestedFilename(), '嵌套语音.wav')
    assert.equal(await download.failure(), null)
    assert.deepEqual(await readFile(await download.path()), wavBytes)
    assert.equal(await page.locator('audio').count(), 2)
    assert.equal(await row('message-431').locator('audio').count(), 0)
    await original.scrollIntoViewIfNeeded()
    const bounds = await original.boundingBox()
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width)
    await page.screenshot({ path: join(outputDirectory, page.viewportSize().width <= 760 ? 'audio-download-mobile.png' : 'audio-download-desktop.png') })
  }
  const verifyAudioPlayback = async () => {
    const audio = () => row('message-432').locator('audio')
    const openSidebar = async () => {
      if (page.viewportSize().width <= 760) await page.getByRole('button', { name: '返回会话列表', exact: true }).click()
    }
    const start = async (locator) => {
      await locator.evaluate(async (element) => { element.muted = true; await element.play() })
      await page.waitForFunction(() => [...document.querySelectorAll('audio')].some((element) => !element.paused && element.currentTime > 0))
    }
    assert.equal(await audio().getAttribute('preload'), 'none')
    assert.equal(await audio().getAttribute('autoplay'), null)
    assert.match(await audio().getAttribute('src'), /\/audios\/0\/stream\?accountId=.*&format=wav$/)
    await start(audio())
    assert.ok(Math.abs(await audio().evaluate((element) => element.duration) - 8) < .01)
    await audio().evaluate((element) => element.pause())
    const pausedAt = await audio().evaluate((element) => element.currentTime)
    assert.equal(await audio().evaluate((element) => element.paused), true)
    await start(audio())
    assert.ok(await audio().evaluate((element) => element.currentTime) >= pausedAt)
    await audio().evaluate((element) => { element.currentTime = 2 })
    await page.waitForFunction(() => document.querySelector('.message-row[data-message-id="message-432"] audio')?.currentTime >= 2)
    const original = await audio().elementHandle()
    broadcast('message-update', { ...fixture.store.getMessage(fixture.conversation.id, 'message-430'), content: 'Refresh while playing' })
    await row('message-430').getByText('Refresh while playing', { exact: true }).waitFor()
    assert.equal(await original.evaluate((element) => element === document.querySelector('.message-row[data-message-id="message-432"] audio')), true)
    assert.equal(await audio().evaluate((element) => element.paused), false)

    const nested = row('message-433').locator('audio')
    await start(nested)
    assert.equal(await audio().evaluate((element) => element.paused && element.currentTime === 0), true)
    await row('message-433').getByRole('button', { name: '停止语音', exact: true }).click()
    assert.equal(await nested.evaluate((element) => element.paused && element.currentTime === 0), true)
    await start(audio())
    await row('message-432').scrollIntoViewIfNeeded()
    const bounds = await audio().boundingBox()
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width)
    await page.screenshot({ path: join(outputDirectory, page.viewportSize().width <= 760 ? 'audio-playback-mobile.png' : 'audio-playback-desktop.png') })

    await openSidebar()
    await page.getByRole('button', { name: 'Other conversation', exact: false }).click()
    await row('foreign-original').waitFor()
    assert.equal(await original.evaluate((element) => element.paused && !element.getAttribute('src')), true)
    await selectFixture()
    await start(audio())
    const recalled = await audio().elementHandle()
    const updated = await fixture.store.updateMessage(fixture.conversation.id, 'message-432', { status: 'recalled' })
    broadcast('message-update', updated)
    await row('message-432').getByText('[消息已撤回]', { exact: true }).waitFor()
    assert.equal(await row('message-432').locator('audio').count(), 0)
    assert.equal(await recalled.evaluate((element) => element.paused && !element.getAttribute('src')), true)
    await fixture.store.updateMessage(fixture.conversation.id, 'message-432', { status: 'received' })

    await selectFixture()
    await start(audio())
    const switched = await audio().elementHandle()
    await openSidebar()
    await page.locator('#account-select').selectOption(otherAccount.id)
    await page.waitForFunction((id) => document.querySelector('#account-select')?.value === id && !document.querySelector('#account-select').disabled, otherAccount.id)
    assert.equal(await switched.evaluate((element) => element.paused && !element.getAttribute('src')), true)
    assert.equal(await page.locator('audio').count(), 0)
    await page.locator('#account-select').selectOption(primaryAccountId)
    await page.waitForFunction((id) => document.querySelector('#account-select')?.value === id && !document.querySelector('#account-select').disabled, primaryAccountId)
    await selectFixture()

    failPlayback = true
    await audio().evaluate(async (element) => { element.muted = true; try { await element.play() } catch {} })
    await row('message-432').getByText('语音播放失败，可重试或下载 WAV', { exact: true }).waitFor()
    assert.equal(await row('message-432').getByRole('link', { name: '下载 WAV', exact: true }).count(), 1)
    failPlayback = false
    await row('message-432').getByRole('button', { name: '重试播放', exact: true }).click()
    await page.waitForFunction(() => { const element = document.querySelector('.message-row[data-message-id="message-432"] audio'); return element && !element.paused && element.currentTime > 0 })
    await row('message-432').getByRole('button', { name: '停止语音', exact: true }).click()
    assert.equal(await audio().evaluate((element) => element.paused && element.currentTime === 0), true)
  }
  await verifyVideoDownloads()
  await verifyAudioDownloads()
  await verifyAudioPlayback()
  // Playback scenarios reload the latest page; restore the older recalled message used by copy checks.
  await locateQuote('message-444')
  await row('message-040').and(page.locator('.message-highlighted')).waitFor()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  const menu = page.locator('#context-menu')
  const copySelected = menu.getByRole('button', { name: '复制选中', exact: true })
  const copyWhole = menu.getByRole('button', { name: '复制整条消息', exact: true })
  const textBubble = row('message-449').locator('.message-bubble')
  const openCopyMenu = async (bubble) => {
    await bubble.scrollIntoViewIfNeeded()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await bubble.click({ button: 'right' })
  }
  await openCopyMenu(textBubble)
  assert.equal(await copySelected.isDisabled(), true)
  await copyWhole.click()
  assert.equal(await page.evaluate(() => window.testCopiedText), 'Message 449')
  await textBubble.evaluate((bubble) => {
    const range = document.createRange()
    range.setStart(bubble.firstChild, 3)
    range.setEnd(bubble.firstChild, 11)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  const selectionBounds = await page.evaluate(() => {
    const rect = window.getSelection().getRangeAt(0).getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  await page.mouse.click(selectionBounds.x, selectionBounds.y, { button: 'right' })
  assert.equal(await copySelected.isEnabled(), true)
  await copySelected.click()
  assert.equal(await page.evaluate(() => window.testCopiedText), 'sage 449')
  await openCopyMenu(row('message-040').locator('.message-bubble'))
  await copyWhole.click()
  assert.equal(await page.evaluate(() => window.testCopiedText), '[消息已撤回]')
  await page.locator('#chat-title').evaluate((title) => {
    const range = document.createRange()
    range.selectNodeContents(title)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await textBubble.dispatchEvent('contextmenu', { clientX: 700, clientY: 300 })
  assert.equal(await copySelected.isDisabled(), true)
  await page.keyboard.press('Escape')
  await fixture.store.updateMessage(fixture.conversation.id, 'message-449', { content: 'First line\nSecond line [图片]' })
  await selectFixture()
  await openCopyMenu(textBubble)
  await copyWhole.click()
  assert.equal(await page.evaluate(() => window.testCopiedText), 'First line\nSecond line [图片]')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    document.execCommand = (command) => {
      if (command !== 'copy') return false
      window.testCopiedText = document.activeElement.value
      return true
    }
  })
  await openCopyMenu(textBubble)
  await copyWhole.click()
  assert.equal(await page.evaluate(() => window.testCopiedText), 'First line\nSecond line [图片]')
  assert.equal(await page.locator('.clipboard-copy-buffer').count(), 0)
  await page.evaluate(() => { document.execCommand = () => false })
  await openCopyMenu(textBubble)
  await copyWhole.click()
  await page.getByRole('status').filter({ hasText: '复制失败，请检查浏览器剪贴板权限' }).waitFor()
  assert.equal(await page.locator('.clipboard-copy-buffer').count(), 0)

  await page.setViewportSize({ width: 390, height: 844 })
  await selectFixture()
  await verifyVideoDownloads()
  await verifyAudioDownloads()
  await verifyAudioPlayback()
  const mobileContextPrevented = await row('message-449').locator('.message-bubble').evaluate((bubble) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    bubble.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(mobileContextPrevented, false)
  assert.equal(await menu.isVisible(), false)
  await verifyNested()
  assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: join(outputDirectory, 'nested-reference-mobile.png') })
  assert.equal(await quote('message-440').textContent(), 'Test sender：Message 30')
  await row('message-440').scrollIntoViewIfNeeded()
  assert.ok((await quote('message-440').boundingBox()).height >= 44)
  await page.screenshot({ path: join(outputDirectory, 'reference-preview-mobile.png') })
  await locateQuote('message-440')
  await row('message-030').and(page.locator('.message-highlighted')).waitFor()
  const bounds = await row('message-030').boundingBox()
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844)
  assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: join(outputDirectory, 'reference-mobile.png') })
  await row('message-030').getByRole('button', { name: '操作 Test sender 的消息' }).click()
  await copyWhole.click()
  assert.equal(await page.evaluate(() => window.testCopiedText), 'Message 30')

  const touchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await mockMenuImages(touchPage)
  touchPage.on('pageerror', (error) => errors.push(String(error)))
  await touchPage.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.testCopiedText = text } },
    })
  })
  await touchPage.goto(url)
  await touchPage.getByRole('button', { name: 'Reference test', exact: false }).tap()
  const touchRow = touchPage.locator('.message-row[data-message-id="message-449"]')
  const touchBubble = touchRow.locator('.message-bubble')
  const touchMore = touchRow.locator('.message-more-button')
  await touchRow.waitFor()
  const touchVideoEvent = touchPage.waitForEvent('download')
  await touchPage.locator('.message-row[data-message-id="message-435"]').getByRole('link', { name: `下载${videoName}`, exact: true }).tap()
  const touchVideoDownload = await touchVideoEvent
  assert.equal(touchVideoDownload.suggestedFilename(), videoName)
  assert.equal(await touchVideoDownload.failure(), null)
  const touchAudioEvent = touchPage.waitForEvent('download')
  await touchPage.locator('.message-row[data-message-id="message-432"]').getByRole('link', { name: '下载 WAV', exact: true }).tap()
  const touchAudioDownload = await touchAudioEvent
  assert.equal(touchAudioDownload.suggestedFilename(), audioName.replace(/\.amr$/, '.wav'))
  assert.equal(await touchAudioDownload.failure(), null)
  assert.deepEqual(await readFile(await touchAudioDownload.path()), wavBytes)
  const touchAudio = touchPage.locator('.message-row[data-message-id="message-432"] audio')
  await touchAudio.evaluate(async (element) => { element.muted = true; await element.play() })
  await touchPage.waitForFunction(() => { const audio = document.querySelector('.message-row[data-message-id="message-432"] audio'); return audio && !audio.paused && audio.currentTime > 0 })
  await touchPage.locator('.message-row[data-message-id="message-432"]').getByRole('button', { name: '停止语音', exact: true }).tap()
  assert.equal(await touchAudio.evaluate((element) => element.paused && element.currentTime === 0), true)
  const touchQuote = touchPage.locator('.message-row[data-message-id="message-440"] .message-quote-linked')
  assert.equal(await touchQuote.textContent(), 'Test sender：Message 30')
  await touchQuote.tap()
  await touchPage.locator('.message-row[data-message-id="message-030"].message-highlighted').waitFor()
  const longPressPrevented = await touchBubble.evaluate((bubble) => {
    const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' })
    bubble.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(longPressPrevented, false)
  assert.equal(await touchPage.locator('#context-menu').isVisible(), false)
  const touchAvatar = touchPage.locator('.message-row[data-message-id="message-448"] .message-avatar')
  const avatarLongPressPrevented = await touchAvatar.evaluate((avatar) => {
    const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' })
    avatar.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(avatarLongPressPrevented, false)
  assert.equal(await touchPage.locator('#context-menu').isVisible(), false)
  await touchMore.scrollIntoViewIfNeeded()
  await touchPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await touchBubble.evaluate((bubble) => {
    const range = document.createRange()
    range.setStart(bubble.firstChild, 0)
    range.setEnd(bubble.firstChild, 5)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  // 模拟触摸默认行为在点击前清空选区，验证 pointerdown 时已保存文本。
  await touchMore.evaluate((button) => button.addEventListener('pointerdown', () => window.getSelection().removeAllRanges(), { once: true }))
  await touchMore.tap()
  const touchMenu = touchPage.locator('#context-menu')
  const touchCopySelected = touchMenu.getByRole('button', { name: '复制选中', exact: true })
  const touchCopyWhole = touchMenu.getByRole('button', { name: '复制整条消息', exact: true })
  assert.equal(await touchCopySelected.isEnabled(), true)
  assert.equal(await touchPage.evaluate(() => window.getSelection().toString()), '')
  const menuBounds = await touchMenu.boundingBox()
  assert.ok(menuBounds && menuBounds.x >= 0 && menuBounds.y >= 0 && menuBounds.x + menuBounds.width <= 390 && menuBounds.y + menuBounds.height <= 844)
  assert.ok((await touchCopySelected.boundingBox()).height >= 44)
  await touchPage.screenshot({ path: join(outputDirectory, 'copy-touch-menu.png') })
  await touchCopySelected.tap()
  assert.equal(await touchPage.evaluate(() => window.testCopiedText), 'First')
  await touchMore.tap()
  assert.equal(await touchCopySelected.isDisabled(), true)
  await touchCopyWhole.tap()
  assert.equal(await touchPage.evaluate(() => window.testCopiedText), 'First line\nSecond line [图片]')
  await touchMore.tap()
  await touchMenu.getByRole('button', { name: '查看消息数据', exact: true }).tap()
  const touchData = touchPage.getByRole('dialog', { name: '消息数据', exact: true })
  await touchData.waitFor()
  const touchJson = await touchData.locator('#message-data-json').textContent()
  assert.equal(JSON.parse(touchJson).id, 'message-449')
  assert.equal(await touchData.getByRole('button', { name: '复制 JSON', exact: true }).evaluate((button) => button.getBoundingClientRect().height >= 44), true)
  await touchData.getByRole('button', { name: '复制 JSON', exact: true }).tap()
  assert.equal(await touchPage.evaluate(() => window.testCopiedText), touchJson)
  await touchData.getByRole('button', { name: '关闭', exact: true }).tap()
  await touchPage.setViewportSize({ width: 1024, height: 768 })
  await touchMore.scrollIntoViewIfNeeded()
  assert.equal(await touchMore.isVisible(), true)
  await touchMore.tap()
  assert.ok((await touchCopyWhole.boundingBox()).height >= 44)
  await touchCopyWhole.tap()
  await touchPage.close()

  await page.setViewportSize({ width: 1440, height: 900 })
  await selectFixture()
  delayReference = true
  await locateQuote('message-440')
  await page.getByRole('button', { name: 'Other conversation', exact: false }).click()
  await row('foreign-original').waitFor()
  await page.waitForTimeout(650)
  assert.equal(await page.locator('.message-row').count(), 2)
  assert.equal(await page.locator('.message-highlighted').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Browser checks passed: Markdown formatting/QQ images/mentions/safety/layout/source copy; WAV playback/seek/single audio/refresh/recall/account switch/retry; audio/video downloads; desktop/mobile/touch; references and copy regression.')
  console.log(`Screenshots: ${outputDirectory}`)
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  assert.ok(resolve(fixture.directory).startsWith(resolve(tmpdir()) + '\\web-qq-reference-'))
  await rm(fixture.directory, { recursive: true, force: true })
}
