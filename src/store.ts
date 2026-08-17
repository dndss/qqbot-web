import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AccountRegistry,
  BotAccount,
  BotConfig,
  Conversation,
  Database,
  PublicBotAccount,
  StoredMessage,
} from './types.ts'

const EMPTY_DATABASE: Database = { conversations: [], messages: [] }
const EMPTY_REGISTRY: AccountRegistry = { selectedAccountId: null, accounts: [] }

export class JsonStore {
  readonly dataDirectory: string
  readonly accountsPath: string
  readonly legacyConfigPath: string
  readonly legacyDatabasePath: string
  #registry: AccountRegistry = structuredClone(EMPTY_REGISTRY)
  #database: Database = structuredClone(EMPTY_DATABASE)
  #writeQueue: Promise<void> = Promise.resolve()

  constructor(dataDirectory: string) {
    this.dataDirectory = dataDirectory
    this.accountsPath = join(dataDirectory, 'accounts.json')
    this.legacyConfigPath = join(dataDirectory, 'config.json')
    this.legacyDatabasePath = join(dataDirectory, 'messages.json')
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true })
    this.#registry = await this.#readJson<AccountRegistry>(this.accountsPath, EMPTY_REGISTRY)
    this.#registry.accounts ??= []
    this.#registry.selectedAccountId ??= null

    let legacyDatabase: Database | undefined
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
        legacyDatabase = await this.#readJson<Database>(this.legacyDatabasePath, EMPTY_DATABASE)
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
    await this.#loadActiveDatabase(legacyDatabase)
  }

  getActiveAccount(): BotAccount | null {
    const id = this.#registry.selectedAccountId
    if (!id) return null
    return this.#registry.accounts.find((account) => account.id === id) ?? null
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

  listMessages(conversationId: string, limit = 200): StoredMessage[] {
    return this.#database.messages
      .filter((message) => message.conversationId === conversationId)
      .slice(-Math.min(Math.max(limit, 1), 500))
  }

  async addMessage(conversation: Conversation, message: StoredMessage): Promise<void> {
    if (!this.getActiveAccount()) throw new Error('尚未选择 Bot 账号')
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
    if (this.#database.messages.length > 20_000) this.#database.messages = this.#database.messages.slice(-20_000)
    await this.#persist()
  }

  async markRead(conversationId: string): Promise<void> {
    const conversation = this.getConversation(conversationId)
    if (!conversation || conversation.unread === 0) return
    conversation.unread = 0
    await this.#persist()
  }

  async updateConversation(id: string, patch: Partial<Conversation>): Promise<Conversation> {
    const conversation = this.getConversation(id)
    if (!conversation) throw new Error('会话不存在')
    Object.assign(conversation, patch, { id: conversation.id })
    await this.#persist()
    return structuredClone(conversation)
  }

  async #loadActiveDatabase(legacyFallback?: Database): Promise<void> {
    const account = this.getActiveAccount()
    if (!account) {
      this.#database = structuredClone(EMPTY_DATABASE)
      return
    }
    const path = this.#databasePath(account.id)
    this.#database = await this.#readJson<Database>(path, legacyFallback ?? EMPTY_DATABASE)
    this.#database.conversations ??= []
    this.#database.messages ??= []
    if (legacyFallback) await this.#writeJson(path, this.#database)
  }

  async #persist(): Promise<void> {
    const account = this.getActiveAccount()
    if (!account) throw new Error('尚未选择 Bot 账号')
    const path = this.#databasePath(account.id)
    const snapshot = structuredClone(this.#database)
    this.#writeQueue = this.#writeQueue.then(() => this.#writeJson(path, snapshot))
    await this.#writeQueue
  }

  #databasePath(accountId: string): string {
    return join(this.dataDirectory, 'bots', accountId, 'messages.json')
  }

  async #readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(fallback)
      throw error
    }
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = `${path}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
  }
}
