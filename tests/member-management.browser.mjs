import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { JsonStore } from '../src/store.ts'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const directory = await mkdtemp(join(tmpdir(), 'web-qq-member-browser-'))
const store = new JsonStore(directory)
await store.initialize()
const account = await store.saveAccount({ appid: 'test', secret: 'test', name: '测试机器人', sandbox: true })
const group = { id: 'group:g', type: 'group', targetId: 'g', title: '测试群', subtitle: '群聊', unread: 0, updatedAt: Date.now(), lastMessage: '' }
const contact = { ...group, id: 'private:u', type: 'private', targetId: 'u', title: '旧昵称', subtitle: '私聊' }
const message = { id: 'm', conversationId: group.id, direction: 'incoming', senderId: 'member', senderOpenid: 'member', senderName: '群名片', content: '测试群消息', timestamp: Date.now(), status: 'received' }
await store.addMessage(group, message)
await store.addMessage(group, { ...message, id: 'admin', senderName: '管理员', roles: ['admin'] })
await store.addMessage(contact, { ...message, id: 'p', conversationId: contact.id, senderName: '旧昵称', content: '私聊消息' })
const source = await readFile(new URL('../src/server.ts', import.meta.url), 'utf8')
const operations = source.slice(source.indexOf('function requireCurrentBot('), source.indexOf('function errorMessage('))
const routes = source.slice(source.indexOf('async function handleApi('), source.indexOf('const mimeTypes:'))
const streams = new Set()
let profileCalls = 0
let removalCalls = 0
let releaseRemoval
const removalGate = new Promise((resolve) => { releaseRemoval = resolve })
const context = {
  store, botAccountId: account.id, connectionState: 'connected', connectionOperation: 1, shuttingDown: false,
  bot: {
    getUserInfo: async () => { profileCalls++; return { username: '资料昵称', avatar: 'https://avatar.example/profile.png', allow_proactive_msg: false } },
    batchRemoveGroupMembers: async (groupId, members) => {
      assert.equal(groupId, 'g'); assert.deepEqual([...members], ['member'])
      removalCalls++; await removalGate
      return { remove_members_result: 'success' }
    },
  },
  userProfileRequests: new Map(), memberRemovalRequests: new Set(), userProfileCallTimes: new WeakMap(), memberRemovalCallTimes: new WeakMap(),
  handleMediaRequest: async () => false, errorMessage: (error) => error.message,
  readJson: async (request) => { let body = ''; for await (const chunk of request) body += chunk; return body ? JSON.parse(body) : {} },
  sendJson: (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) },
  sseClients: streams,
  statusPayload: () => ({ state: 'connected', error: '', selfId: 'bot', account: { id: account.id, name: account.name, appid: 'test' } }),
  publish: (event, data) => { for (const response of streams) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) },
  prepareConversationMessages: async (id, limit, before) => store.listMessagesPage(id, limit, before),
}
const handleApi = runInNewContext(stripTypeScriptTypes(`${operations}\n${routes}\nhandleApi`), context)
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname.startsWith('/api/')) {
      if (!(await handleApi(request, response, url))) context.sendJson(response, 404, { error: 'Not found' })
      return
    }
    const path = url.pathname === '/vendor/markdown-it.js' ? fileURLToPath(import.meta.resolve('markdown-it/browser'))
      : fileURLToPath(new URL(`../public/${url.pathname === '/' ? 'index.html' : url.pathname.slice(1)}`, import.meta.url))
    response.writeHead(200, { 'Content-Type': path.endsWith('.html') ? 'text/html' : path.endsWith('.css') ? 'text/css' : 'text/javascript' })
    response.end(await readFile(path))
  } catch (error) { context.sendJson(response, 400, { error: error.message }) }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) })
const screenshots = fileURLToPath(new URL('../data/test-results/members/', import.meta.url))
await mkdir(screenshots, { recursive: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.emulateMedia({ reducedMotion: 'reduce' })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('https://avatar.example/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#4c88df"/></svg>' }))
const select = async (title) => page.getByRole('button', { name: new RegExp(title) }).first().click()
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await select('旧昵称')
  await page.locator('#refresh-bot-state').getByText('获取资料', { exact: true }).waitFor()
  assert.equal(profileCalls, 0)
  await page.locator('#refresh-bot-state').click()
  await page.locator('#detail-title').getByText('资料昵称', { exact: true }).waitFor()
  assert.match(await page.locator('#detail-list').innerText(), /允许主动消息\s+否/)
  assert.equal(profileCalls, 1)
  await page.screenshot({ path: join(screenshots, 'desktop-profile.png'), fullPage: true })
  await select('测试群')
  const row = page.locator('.message-row[data-message-id="m"]')
  await row.locator('.message-avatar').click({ button: 'right' })
  assert.equal(await page.locator('#context-menu').getByText('移出群聊…', { exact: true }).count(), 1)
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.locator('#context-menu').getByText('移出群聊…', { exact: true }).click()
  assert.equal(removalCalls, 0)
  await row.locator('.message-avatar').click({ button: 'right' })
  page.once('dialog', async (dialog) => { assert.match(dialog.message(), /群名片.*测试群/); await dialog.accept() })
  await page.locator('#context-menu').getByText('移出群聊…', { exact: true }).click()
  await page.waitForFunction(() => document.querySelector('#context-menu').classList.contains('hidden'))
  await row.locator('.message-avatar').click({ button: 'right' })
  assert.equal(await page.locator('#context-menu').getByText('移出群聊…', { exact: true }).isDisabled(), true)
  releaseRemoval()
  await page.getByText('成员已移出群聊，聊天记录已保留', { exact: true }).waitFor()
  assert.equal(removalCalls, 1)
  assert.equal(await row.count(), 1)
  await page.keyboard.press('Escape')
  await page.locator('.message-row[data-message-id="admin"] .message-avatar').click({ button: 'right' })
  assert.equal(await page.locator('#context-menu').getByText('移出群聊…', { exact: true }).count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await select('资料昵称')
  await page.locator('#chat-type').click()
  await page.locator('#refresh-bot-state').getByText('刷新资料', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: join(screenshots, 'mobile-profile.png'), fullPage: true })
  await page.locator('#mobile-detail-back').click()
  await page.locator('#mobile-back-button').click()
  await select('测试群')
  await page.locator('.message-row[data-message-id="m"] .message-more-button').click()
  assert.equal(await page.locator('#context-menu').getByText('移出群聊…', { exact: true }).count(), 1)
  await page.locator('#context-menu').getByText('移出群聊…', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(screenshots, 'mobile-member-menu.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('Member browser checks passed: desktop/mobile profile details, cancel/confirm removal, duplicate protection, protected roles and retained history.')
} finally {
  releaseRemoval()
  await browser.close()
  for (const response of streams) response.end()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
