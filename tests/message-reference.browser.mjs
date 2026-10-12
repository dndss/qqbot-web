import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createReferenceFixture } from './reference-fixture.ts'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
  : 'playwright')
const fixture = await createReferenceFixture()
const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public')
const outputDirectory = process.env.TEST_OUTPUT_DIR || resolve(publicDirectory, '../data/test-results/reference')
await mkdir(outputDirectory, { recursive: true })
let referenceRequests = 0
let delayReference = false
const status = { state: 'disconnected', error: '', selfId: null, account: null }
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    const json = (code, value) => {
      response.writeHead(code, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (url.pathname === '/api/status') return json(200, status)
    if (url.pathname === '/api/accounts') return json(200, [])
    if (url.pathname === '/api/conversations') return json(200, fixture.store.listConversations())
    if (url.pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`)
      return
    }
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
    if (messages) return json(200, fixture.store.listMessagesPage(
      decodeURIComponent(messages[1]), 200, url.searchParams.get('before') || undefined,
    ))
    if (url.pathname.endsWith('/read')) return json(200, { ok: true })
    const path = resolve(publicDirectory, url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
    assert.ok(path.startsWith(`${publicDirectory}\\`) || path.startsWith(`${publicDirectory}/`))
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
const selectFixture = async () => {
  await page.goto(url)
  await page.getByRole('button', { name: 'Reference test', exact: false }).click()
  await row('message-449').waitFor()
}
try {
  await selectFixture()
  assert.equal(await page.locator('.message-row').count(), 200)
  assert.equal(await quote('message-440').textContent(), 'Test sender：Message 30')
  await quote('message-440').click()
  await row('message-030').and(page.locator('.message-highlighted')).waitFor()
  assert.equal(await page.locator('.message-row').count(), 440)
  assert.equal(referenceRequests, 1)
  assert.equal(await page.locator('.message-row').first().getAttribute('data-message-id'), 'message-010')
  await page.screenshot({ path: join(outputDirectory, 'reference-desktop.png') })
  await quote('message-445').click()
  await row('message-430').and(page.locator('.message-highlighted')).waitFor()
  assert.equal(referenceRequests, 1)
  await quote('message-442').focus()
  await page.keyboard.press('Enter')
  await row('message-032').and(page.locator('.message-highlighted')).waitFor()
  await quote('message-444').click()
  await row('message-040').and(page.locator('.message-highlighted')).waitFor()
  assert.equal(await row('message-040').locator('.message-bubble').textContent(), '[消息已撤回]')
  await quote('message-443').click()
  await page.getByRole('status').filter({ hasText: '原消息未保存在当前会话中' }).waitFor()
  assert.equal(await quote('message-443').isEnabled(), true)

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
  const mobileContextPrevented = await row('message-449').locator('.message-bubble').evaluate((bubble) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    bubble.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(mobileContextPrevented, false)
  assert.equal(await menu.isVisible(), false)
  await quote('message-440').click()
  await row('message-030').and(page.locator('.message-highlighted')).waitFor()
  const bounds = await row('message-030').boundingBox()
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844)
  assert.equal(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: join(outputDirectory, 'reference-mobile.png') })
  await row('message-030').getByRole('button', { name: '操作 Test sender 的消息' }).click()
  await copyWhole.click()
  assert.equal(await page.evaluate(() => window.testCopiedText), 'Message 30')

  const touchPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
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
  await quote('message-440').click()
  await page.getByRole('button', { name: 'Other conversation', exact: false }).click()
  await row('foreign-original').waitFor()
  await page.waitForTimeout(650)
  assert.equal(await page.locator('.message-row').count(), 2)
  assert.equal(await page.locator('.message-highlighted').count(), 0)
  assert.deepEqual(errors, [])
  console.log('Browser checks passed: reference navigation; copy content/fallback/failure; touch selection snapshot; native long-press not prevented; phone/tablet menus; navigation race.')
  console.log(`Screenshots: ${outputDirectory}`)
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  assert.ok(resolve(fixture.directory).startsWith(resolve(tmpdir()) + '\\web-qq-reference-'))
  await rm(fixture.directory, { recursive: true, force: true })
}
