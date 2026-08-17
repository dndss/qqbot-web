export type ConversationType = 'private' | 'group'
export type SenderRole = 'owner' | 'admin'

export interface GroupBotState {
  memberOpenid: string
  joinedAt: string
  allowProactiveMsg: boolean
  recvMsgSetting: 'all' | 'only_mention' | 'mention_and_context'
  memberRole: 'member' | 'owner' | 'admin'
  updatedAt: number
}

export interface BotConfig {
  appid: string
  secret: string
  sandbox: boolean
}

export interface BotAccount extends BotConfig {
  id: string
  name: string
}

export interface PublicBotAccount {
  id: string
  appid: string
  name: string
  sandbox: boolean
  secretConfigured: boolean
  selected: boolean
}

export interface AccountRegistry {
  selectedAccountId: string | null
  accounts: BotAccount[]
}

export interface Conversation {
  id: string
  type: ConversationType
  targetId: string
  title: string
  subtitle: string
  updatedAt: number
  unread: number
  lastMessage: string
  avatarUrl?: string
  groupMemberCount?: number
  description?: string
  category?: string
  tags?: string[]
  botState?: GroupBotState
}

export interface StoredMessage {
  id: string
  conversationId: string
  direction: 'incoming' | 'outgoing'
  senderId: string
  senderName: string
  avatarUrl?: string
  roles?: SenderRole[]
  content: string
  timestamp: number
  status: 'sent' | 'received' | 'pending' | 'failed'
}

export interface Database {
  conversations: Conversation[]
  messages: StoredMessage[]
}

export interface IncomingMessageLike {
  message_type: 'private' | 'group'
  sub_type?: string
  user_id?: string
  group_id?: string
  group_name?: string
  message_id?: string
  id?: string
  raw_message?: string
  timestamp?: number
  member_role?: 'member' | 'owner' | 'admin'
  author?: {
    member_role?: 'member' | 'owner' | 'admin'
  }
  sender?: {
    user_id?: string
    user_name?: string
    user_openid?: string
    permissions?: Array<string | number>
    member_role?: 'member' | 'owner' | 'admin'
  }
}
