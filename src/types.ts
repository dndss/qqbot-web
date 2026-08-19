export type ConversationType = 'private' | 'group'
export type SenderRole = 'owner' | 'admin'

export interface ForwardAttachmentPart {
  index: number
  kind: 'image' | 'video' | 'audio' | 'file'
  rawType: string
  name?: string
  width?: number
  height?: number
  sizeText?: string
  url?: string
  localUrl?: string
  animated?: boolean
}

export interface ForwardNodePart {
  index: number
  senderName: string
  content: string
  attachments?: ForwardAttachmentPart[]
  children?: ForwardNodePart[]
}

export interface ForwardMessagePart {
  type: 'forward'
  title: string
  nodes: ForwardNodePart[]
}

export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; url?: string; localUrl?: string; name?: string }
  | { type: 'face'; id: string; text?: string }
  | { type: 'at'; userId: string; name?: string }
  | { type: 'reply'; messageId: string }
  | { type: 'video' | 'audio' | 'file'; url?: string; name?: string }
  | ForwardMessagePart
  | { type: 'unsupported'; label: string }

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
  senderOpenid?: string
  senderName: string
  avatarUrl?: string
  roles?: SenderRole[]
  content: string
  parts?: MessagePart[]
  /** 当前消息的引用索引；收到的消息来自 msg_idx，Bot 消息来自 ext_info.ref_idx。 */
  msgIdx?: string
  /** 当前消息所引用的另一条消息索引。 */
  refMsgIdx?: string
  timestamp: number
  status: 'sent' | 'received' | 'pending' | 'failed' | 'recalled'
  recalledAt?: number
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
  msg_idx?: string
  message_scene?: {
    ext?: unknown[]
  }
  raw_message?: string
  message?: Array<{
    type?: string
    data?: Record<string, unknown>
  }>
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
