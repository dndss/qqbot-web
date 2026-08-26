import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AccountRegistry,
  BotAccount,
  BotConfig,
  Conversation,
  Database,
  PublicBotAccount,
  MessagePage,
  StoredMessage,
} from './types.ts'

const EMPTY_DATABASE: Database = { conversations: [], messages: [] }
const EMPTY_REGISTRY: AccountRegistry = { selectedAccountId: null, accounts: [] }
const MESSAGE_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export class JsonStore {
  readonly dataDirectory: string
  readonly accountsPath: string
  readonly legacyConfigPath: string
  #registry: AccountRegistry = structuredClone(EMPTY_REGISTRY)
  #database: Database = structuredClone(EMPTY_DATABASE)
  #writeQueue: Promise<void> = Promise.resolve()

  constructor(dataDirectory: string) {
    this.dataDirectory = dataDirectory
    this.accountsPath = join(dataDirectory, 'accounts.json')
    this.legacyConfigPath = join(dataDirectory, 'config.json')
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true })
    this.#registry = await this.#readJson<AccountRegistry>(this.accountsPath, EMPTY_REGISTRY)
    this.#registry.accounts ??= []
    this.#registry.selectedAccountId ??= null

    if (this.#registry.accounts.length === 0) {
      const legacyConfig = await this.#readJson<BotConfig | null>(this.legacyConfigPath, null)
      if (legacyConfig?.appid && legacyConfig.secret) {
        const account: BotAccount = {
          id: randomUUID(),
          appid: legacyConfig.appid,
          secret: legacyConfig.secret,
          sandbox: legacyConfig.sandbox === true,
          name: `Bot ${legacyConfig.appid}`,
        }
        this.#registry.accounts.push(account)
        this.#registry.selectedAccountId = account.id
        await this.#writeJson(this.accountsPath, this.#registry)
      }
    }

    if (
      this.#registry.selectedAccountId &&
      !this.#registry.accounts.some((account) => account.id === this.#registry.selectedAccountId)
    ) {
      this.#registry.selectedAccountId = this.#registry.accounts[0]?.id ?? null
      await this.#writeJson(this.accountsPath, this.#registry)
    }
    await this.#loadActiveDatabase()
  }

  getActiveAccount(): BotAccount | null {
    const id = this.#registry.selectedAccountId
    if (!id) return null
    return this.#registry.accounts.find((account) => account.id === id) ?? null
  }

  getAccount(accountId: string): BotAccount | undefined {
    const account = this.#registry.accounts.find((item) => item.id === accountId)
    return account ? structuredClone(account) : undefined
  }

  async getConfig(): Promise<BotConfig | null> {
    const account = this.getActiveAccount()
    if (!account) return null
    return { appid: account.appid, secret: account.secret, sandbox: account.sandbox }
  }

  listAccounts(): PublicBotAccount[] {
    return this.#registry.accounts.map((account) => ({
      id: account.id,
      appid: account.appid,
      name: account.name,
      sandbox: account.sandbox,
      secretConfigured: Boolean(account.secret),
      selected: account.id === this.#registry.selectedAccountId,
    }))
  }

  async saveAccount(input: Omit<BotAccount, 'id'>, accountId?: string): Promise<BotAccount> {
    if (!input.appid || !input.secret) throw new Error('AppID 和 Secret 均为必填项')
    const duplicate = this.#registry.accounts.find(
      (account) => account.appid === input.appid && account.id !== accountId,
    )
    if (duplicate) throw new Error('该 AppID 已存在')

    const previousSelectedId = this.#registry.selectedAccountId
    let account: BotAccount
    if (accountId) {
      const index = this.#registry.accounts.findIndex((item) => item.id === accountId)
      if (index < 0) throw new Error('Bot 账号不存在')
      account = { ...this.#registry.accounts[index], ...input, id: accountId }
      this.#registry.accounts[index] = account
    } else {
      account = { ...input, id: randomUUID() }
      this.#registry.accounts.push(account)
    }
    this.#registry.selectedAccountId = account.id
    await this.#writeJson(this.accountsPath, this.#registry)
    if (previousSelectedId !== account.id) await this.#loadActiveDatabase()
    return structuredClone(account)
  }

  async selectAccount(accountId: string): Promise<BotAccount> {
    const account = this.#registry.accounts.find((item) => item.id === accountId)
    if (!account) throw new Error('Bot 账号不存在')
    if (this.#registry.selectedAccountId !== accountId) {
      await this.#writeQueue
      this.#registry.selectedAccountId = accountId
      await this.#writeJson(this.accountsPath, this.#registry)
      await this.#loadActiveDatabase()
    }
    return structuredClone(account)
  }

  async deleteAccount(accountId: string): Promise<void> {
    const index = this.#registry.accounts.findIndex((item) => item.id === accountId)
    if (index < 0) throw new Error('Bot 账号不存在')
    await this.#writeQueue
    const wasSelected = this.#registry.selectedAccountId === accountId
    this.#registry.accounts.splice(index, 1)
    if (wasSelected) this.#registry.selectedAccountId = this.#registry.accounts[0]?.id ?? null
    await this.#writeJson(this.accountsPath, this.#registry)
    if (wasSelected) await this.#loadActiveDatabase()
  }

  listConversations(): Conversation[] {
    return [...this.#database.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  getConversation(id: string): Conversation | undefined {
    return this.#database.conversations.find((item) => item.id === id)
  }

  getMessage(conversationId: string, messageId: string): StoredMessage | undefined {
    return this.#database.messages.find(
      (message) => message.conversationId === conversationId && message.id === messageId,
    )
  }

  listMessages(conversationId: string, limit = 200): StoredMessage[] {
    return this.listMessagesPage(conversationId, limit).messages
  }

  listMessagesPage(conversationId: string, limit = 200, before?: string): MessagePage {
    const messages = this.#database.messages.filter((message) => message.conversationId === conversationId)
    let end = messages.length
    if (before) {
      end = messages.findIndex((message) => message.id === before)
      if (end < 0) throw new Error('消息分页游标已失效，请重新打开会话')
    }
    const pageSize = Math.min(Math.max(Number.isInteger(limit) ? limit : 200, 1), 200)
    const start = Math.max(0, end - pageSize)
    const page = messages.slice(start, end)
    const hasMore = start > 0
    return {
      messages: page,
      hasMore,
      nextCursor: hasMore ? page[0]?.id ?? null : null,
    }
  }

  async addMessage(conversation: Conversation, message: StoredMessage): Promise<void> {
    const account = this.getActiveAccount()
    if (!account) throw new Error('尚未选择 Bot 账号')
    const existingIndex = this.#database.conversations.findIndex((item) => item.id === conversation.id)
    const existing = existingIndex >= 0 ? this.#database.conversations[existingIndex] : undefined
    const nextConversation: Conversation = {
      ...existing,
      ...conversation,
      unread: message.direction === 'incoming' ? (existing?.unread ?? 0) + 1 : (existing?.unread ?? 0),
      lastMessage: message.content,
      updatedAt: message.timestamp,
    }
    if (existingIndex >= 0) this.#database.conversations[existingIndex] = nextConversation
    else this.#database.conversations.push(nextConversation)

    const duplicate = this.#database.messages.some(
      (item) => item.id === message.id && item.conversationId === message.conversationId,
    )
    if (!duplicate) this.#database.messages.push(message)

    const conversations = structuredClone(this.#database.conversations)
    const storedMessage = structuredClone(message)
    const messagePath = this.#messagePath(account.id, message)
    await this.#enqueueWrite(async () => {
      await this.#writeJson(this.#conversationsPath(account.id), conversations)
      if (!duplicate) await this.#appendJsonLine(messagePath, storedMessage)
    })
  }

  async markRead(conversationId: string): Promise<void> {
    const conversation = this.getConversation(conversationId)
    if (!conversation || conversation.unread === 0) return
    conversation.unread = 0
    await this.#persistConversations()
  }

  async updateMessage(
    conversationId: string,
    messageId: string,
    patch: Partial<StoredMessage>,
  ): Promise<StoredMessage> {
    const account = this.getActiveAccount()
    if (!account) throw new Error('尚未选择 Bot 账号')
    const message = this.getMessage(conversationId, messageId)
    if (!message) throw new Error('消息不存在')
    Object.assign(message, patch, { id: message.id, conversationId: message.conversationId })
    const conversation = this.getConversation(conversationId)
    const latest = this.#database.messages
      .filter((item) => item.conversationId === conversationId)
      .at(-1)
    const conversationChanged = Boolean(conversation && latest?.id === message.id)
    if (conversationChanged && conversation) conversation.lastMessage = message.content

    const messagePath = this.#messagePath(account.id, message)
    const messages = this.#messagesInFile(account.id, messagePath)
    const conversations = conversationChanged ? structuredClone(this.#database.conversations) : undefined
    await this.#enqueueWrite(async () => {
      await this.#writeJsonLines(messagePath, messages)
      if (conversations) await this.#writeJson(this.#conversationsPath(account.id), conversations)
    })
    return structuredClone(message)
  }

  async updateMessages(
    conversationId: string,
    updates: Array<{ messageId: string; patch: Partial<StoredMessage> }>,
  ): Promise<StoredMessage[]> {
    const account = this.getActiveAccount()
    if (!account) throw new Error('尚未选择 Bot 账号')
    const changed: StoredMessage[] = []
    const paths = new Set<string>()
    for (const update of updates) {
      const message = this.getMessage(conversationId, update.messageId)
      if (!message) continue
      Object.assign(message, update.patch, { id: message.id, conversationId: message.conversationId })
      changed.push(structuredClone(message))
      paths.add(this.#messagePath(account.id, message))
    }
    if (changed.length) {
      const files = [...paths].map((path) => ({ path, messages: this.#messagesInFile(account.id, path) }))
      await this.#enqueueWrite(async () => {
        for (const file of files) await this.#writeJsonLines(file.path, file.messages)
      })
    }
    return changed
  }

  async updateConversation(id: string, patch: Partial<Conversation>): Promise<Conversation> {
    const conversation = this.getConversation(id)
    if (!conversation) throw new Error('会话不存在')
    Object.assign(conversation, patch, { id: conversation.id })
    await this.#persistConversations()
    return structuredClone(conversation)
  }

  async #loadActiveDatabase(): Promise<void> {
    const account = this.getActiveAccount()
    if (!account) {
      this.#database = structuredClone(EMPTY_DATABASE)
      return
    }
    const conversations = await this.#readJson<Conversation[]>(this.#conversationsPath(account.id), [])
    const messages = await this.#readMessages(account.id)
    for (const message of messages) {
      if (message.direction === 'incoming' && !message.senderOpenid && message.senderId !== 'unknown') {
        message.senderOpenid = message.senderId
      }
    }
    this.#database = { conversations, messages }
  }

  async #persistConversations(): Promise<void> {
    const account = this.getActiveAccount()
    if (!account) throw new Error('尚未选择 Bot 账号')
    const conversations = structuredClone(this.#database.conversations)
    await this.#enqueueWrite(() => this.#writeJson(this.#conversationsPath(account.id), conversations))
  }

  async #enqueueWrite(task: () => Promise<void>): Promise<void> {
    const write = this.#writeQueue.then(task)
    this.#writeQueue = write.catch(() => undefined)
    await write
  }

  #conversationsPath(accountId: string): string {
    return join(this.dataDirectory, 'bots', accountId, 'conversations.json')
  }

  #messagePath(accountId: string, message: StoredMessage): string {
    const conversation = this.getConversation(message.conversationId)
    if (!conversation) throw new Error(`消息所属会话不存在：${message.conversationId}`)
    const category = conversation.type === 'group' ? 'groups' : 'users'
    const targetDirectory = `id_${encodeURIComponent(conversation.targetId)}`
    return join(
      this.dataDirectory,
      'bots',
      accountId,
      'messages',
      category,
      targetDirectory,
      `${this.#messageDate(message.timestamp)}.jsonl`,
    )
  }

  #messageDate(timestamp: number): string {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) throw new Error(`消息时间无效：${timestamp}`)
    const parts = Object.fromEntries(
      MESSAGE_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
    )
    return `${parts.year}-${parts.month}-${parts.day}`
  }

  #messagesInFile(accountId: string, path: string): StoredMessage[] {
    return this.#database.messages
      .filter((message) => this.#messagePath(accountId, message) === path)
      .map((message) => structuredClone(message))
  }

  async #readMessages(accountId: string): Promise<StoredMessage[]> {
    const root = join(this.dataDirectory, 'bots', accountId, 'messages')
    const messages: StoredMessage[] = []
    for (const category of ['groups', 'users']) {
      const categoryPath = join(root, category)
      for (const target of await this.#readDirectory(categoryPath)) {
        if (!target.isDirectory()) continue
        const targetPath = join(categoryPath, target.name)
        for (const file of await this.#readDirectory(targetPath)) {
          if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
          const path = join(targetPath, file.name)
          const lines = (await readFile(path, 'utf8')).split(/\r?\n/)
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index].trim()
            if (!line) continue
            try {
              messages.push(JSON.parse(line) as StoredMessage)
            } catch (error) {
              throw new Error(`聊天记录解析失败：${path}:${index + 1}`, { cause: error })
            }
          }
        }
      }
    }
    return messages.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
  }

  async #readDirectory(path: string) {
    try {
      return await readdir(path, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async #readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(fallback)
      throw error
    }
  }

  async #appendJsonLine(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  async #writeJsonLines(path: string, messages: StoredMessage[]): Promise<void> {
    const body = messages.map((message) => JSON.stringify(message)).join('\n')
    await this.#writeText(path, body ? `${body}\n` : '')
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    await this.#writeText(path, `${JSON.stringify(value, null, 2)}\n`)
  }

  async #writeText(path: string, value: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.tmp`
    await writeFile(temporaryPath, value, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
  }
}
