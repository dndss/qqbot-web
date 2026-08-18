const state = {
  accounts: [],
  conversations: [],
  selectedId: null,
  messages: [],
  status: { state: 'disconnected', error: '', selfId: null },
  query: '',
  replyTarget: null,
  mentions: [],
}

const elements = Object.fromEntries(
  [...document.querySelectorAll('[id]')].map((element) => [element.id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), element]),
)

const typeLabels = {
  private: 'C2C 私聊',
  group: '群聊',
}

const botRoleLabels = {
  member: '普通成员',
  admin: '管理员',
  owner: '群主',
}

const receiveSettingLabels = {
  all: '全部消息',
  only_mention: '仅 @ 机器人',
  mention_and_context: '@ 机器人及上下文',
}

const messageBadgeLabels = {
  bot: 'BOT',
  owner: '群主',
  admin: '管理员',
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...options.headers } : options.headers,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`)
  return data
}

function formatTime(timestamp) {
  const date = new Date(timestamp)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function avatarText(title) {
  return [...(title || 'Q')][0]?.toUpperCase() || 'Q'
}

function renderAvatar(element, title, avatarUrl) {
  element.replaceChildren()
  if (!avatarUrl) {
    element.textContent = avatarText(title)
    return
  }
  const image = document.createElement('img')
  image.src = avatarUrl
  image.alt = `${title || '用户'}头像`
  image.referrerPolicy = 'no-referrer'
  image.addEventListener('error', () => {
    element.replaceChildren()
    element.textContent = avatarText(title)
  }, { once: true })
  element.append(image)
}

function safeMediaUrl(value) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value, window.location.href)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function mediaFallback(label) {
  const fallback = document.createElement('span')
  fallback.className = 'message-media-fallback'
  fallback.textContent = label
  return fallback
}

function renderForwardAttachment(container, attachment) {
  const item = document.createElement('div')
  item.className = 'forward-attachment'
  if (attachment.kind === 'image' && attachment.url) {
    renderMessagePart(item, {
      type: 'image',
      url: attachment.url,
      localUrl: attachment.localUrl,
      name: attachment.name,
    })
  } else {
    renderMessagePart(item, {
      type: attachment.kind,
      url: attachment.url,
      name: attachment.name || attachment.rawType,
    })
  }
  const details = [
    attachment.animated ? '动图' : attachment.rawType,
    attachment.width && attachment.height ? `${attachment.width}×${attachment.height}` : '',
    attachment.sizeText || '',
  ].filter(Boolean).join(' · ')
  if (details) {
    const meta = document.createElement('span')
    meta.className = 'forward-attachment-meta'
    meta.textContent = details
    item.append(meta)
  }
  container.append(item)
}

function renderForwardNode(container, node, depth = 0) {
  const item = document.createElement('div')
  item.className = `forward-node ${depth ? 'nested' : ''}`
  const sender = document.createElement('strong')
  sender.className = 'forward-sender'
  sender.textContent = node.senderName || '未知发送者'
  item.append(sender)
  if (node.content) {
    const content = document.createElement('div')
    content.className = 'forward-content'
    content.textContent = node.content
    item.append(content)
  }
  if (node.attachments?.length) {
    const attachments = document.createElement('div')
    attachments.className = 'forward-attachments'
    for (const attachment of node.attachments) renderForwardAttachment(attachments, attachment)
    item.append(attachments)
  }
  if (node.children?.length) {
    const children = document.createElement('div')
    children.className = 'forward-children'
    for (const child of node.children) renderForwardNode(children, child, depth + 1)
    item.append(children)
  }
  container.append(item)
}

function renderForwardMessage(container, part) {
  const card = document.createElement('section')
  card.className = 'forward-card'
  const title = document.createElement('header')
  title.className = 'forward-title'
  title.textContent = part.title || '合并消息'
  card.append(title)
  const nodes = document.createElement('div')
  nodes.className = 'forward-nodes'
  for (const node of part.nodes || []) renderForwardNode(nodes, node)
  card.append(nodes)
  container.append(card)
}

function renderMessagePart(container, part) {
  if (!part || typeof part !== 'object') return
  switch (part.type) {
    case 'text':
      container.append(document.createTextNode(String(part.text || '')))
      break
    case 'image': {
      const localUrl = safeMediaUrl(part.localUrl)
      const remoteUrl = safeMediaUrl(part.url)
      const initialUrl = localUrl || remoteUrl
      if (!initialUrl) {
        container.append(mediaFallback('[图片地址无效]'))
        break
      }
      const link = document.createElement('a')
      link.className = 'message-image-link'
      link.href = initialUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      const image = document.createElement('img')
      image.className = 'message-image'
      image.src = initialUrl
      image.alt = part.name || '消息图片'
      image.loading = 'lazy'
      image.decoding = 'async'
      image.referrerPolicy = 'no-referrer'
      let triedRemote = !localUrl || localUrl === remoteUrl
      image.addEventListener('error', () => {
        if (!triedRemote && remoteUrl) {
          triedRemote = true
          image.src = remoteUrl
          link.href = remoteUrl
          return
        }
        link.replaceWith(mediaFallback('[图片加载失败]'))
      })
      link.append(image)
      container.append(link)
      break
    }
    case 'face': {
      const face = document.createElement('span')
      face.className = 'message-face'
      face.textContent = part.text || `[表情${part.id ? ` ${part.id}` : ''}]`
      container.append(face)
      break
    }
    case 'at': {
      const mention = document.createElement('span')
      mention.className = 'message-mention'
      mention.textContent = `@${part.name || (part.userId === 'all' ? '所有人' : part.userId || '用户')}`
      container.append(mention)
      break
    }
    case 'reply': {
      const reply = document.createElement('span')
      reply.className = 'message-reference'
      reply.textContent = part.messageId ? `回复消息 ${part.messageId}` : '回复消息'
      container.append(reply)
      break
    }
    case 'video':
    case 'audio':
    case 'file': {
      const labels = { video: '视频', audio: '音频', file: '文件' }
      const label = part.name || labels[part.type]
      const url = safeMediaUrl(part.url)
      if (!url) {
        container.append(mediaFallback(`[${label}]`))
        break
      }
      const link = document.createElement('a')
      link.className = 'message-attachment'
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.referrerPolicy = 'no-referrer'
      link.textContent = `打开${label}`
      container.append(link)
      break
    }
    case 'forward':
      renderForwardMessage(container, part)
      break
    case 'unsupported':
      container.append(mediaFallback(part.label || '[暂不支持的消息]'))
      break
  }
}

function renderMessageContent(container, message) {
  if (message.status === 'recalled') {
    container.classList.add('recalled')
    container.textContent = '[消息已撤回]'
    return
  }
  if (!Array.isArray(message.parts) || message.parts.length === 0) {
    container.textContent = message.content
    return
  }
  container.classList.add('has-rich-content')
  for (const part of message.parts) {
    if (part.type === 'reply' && message.refMsgIdx) continue
    renderMessagePart(container, part)
  }
}

function closeContextMenu() {
  elements.contextMenu.classList.add('hidden')
  elements.contextMenu.replaceChildren()
}

function showContextMenu(event, actions) {
  event.preventDefault()
  event.stopPropagation()
  elements.contextMenu.replaceChildren()
  for (const action of actions) {
    if (!action) {
      const separator = document.createElement('div')
      separator.className = 'context-menu-separator'
      elements.contextMenu.append(separator)
      continue
    }
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = action.label
    if (action.danger) button.classList.add('danger')
    button.addEventListener('click', async () => {
      closeContextMenu()
      try {
        await action.run()
      } catch (error) {
        showToast(error.message, true)
      }
    })
    elements.contextMenu.append(button)
  }
  elements.contextMenu.classList.remove('hidden')
  const rect = elements.contextMenu.getBoundingClientRect()
  elements.contextMenu.style.left = `${Math.max(6, Math.min(event.clientX, window.innerWidth - rect.width - 6))}px`
  elements.contextMenu.style.top = `${Math.max(6, Math.min(event.clientY, window.innerHeight - rect.height - 6))}px`
  elements.contextMenu.querySelector('button')?.focus()
}

function renderReplyPreview() {
  const target = state.replyTarget
  elements.replyPreview.classList.toggle('hidden', !target)
  if (!target) return
  elements.replyPreviewLabel.textContent = target.quote
    ? `引用回复 ${target.senderName}`
    : `不引用回复 ${target.senderName}`
  elements.replyPreviewContent.textContent = target.content
}

function resetComposer(clearText = false) {
  state.replyTarget = null
  state.mentions = []
  if (clearText) {
    elements.messageInput.value = ''
    elements.messageInput.style.height = 'auto'
  }
  renderReplyPreview()
}

function selectReplyTarget(message, quote) {
  if (message.status === 'recalled') throw new Error('已撤回的消息不能回复')
  if (quote && !message.msgIdx) throw new Error('该消息没有 msg_idx/ref_idx，无法引用回复')
  state.replyTarget = {
    messageId: message.id,
    quote,
    senderName: message.senderName,
    content: message.content,
  }
  renderReplyPreview()
  elements.messageInput.focus()
}

function insertMention(message) {
  const conversation = state.conversations.find((item) => item.id === state.selectedId)
  if (conversation?.type !== 'group' || message.direction !== 'incoming' || !message.senderOpenid) {
    throw new Error('该消息没有可用的群成员 OpenID')
  }
  const token = `@${message.senderName}`
  const input = elements.messageInput
  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? start
  const before = input.value.slice(0, start)
  const after = input.value.slice(end)
  const prefix = before && !/\s$/.test(before) ? ' ' : ''
  const suffix = after && /^\s/.test(after) ? '' : ' '
  const inserted = `${prefix}${token}${suffix}`
  if (before.length + inserted.length + after.length > input.maxLength) throw new Error('输入内容已达到长度限制')
  input.value = `${before}${inserted}${after}`
  state.mentions.push({ messageId: message.id, token })
  const cursor = before.length + inserted.length
  input.focus()
  input.setSelectionRange(cursor, cursor)
  input.dispatchEvent(new Event('input'))
}

async function recallFromMenu(message) {
  if (!state.selectedId) return
  if (!window.confirm('确定撤回这条消息？')) return
  const updated = await api(`/api/conversations/${encodeURIComponent(state.selectedId)}/messages/${encodeURIComponent(message.id)}`, {
    method: 'DELETE',
  })
  const index = state.messages.findIndex((item) => item.id === updated.id)
  if (index >= 0) state.messages[index] = updated
  await loadConversations()
  renderMessages()
  showToast('消息已撤回')
}

async function muteFromMenu(message, durationMinutes) {
  if (!state.selectedId) return
  const result = await api(`/api/conversations/${encodeURIComponent(state.selectedId)}/members/${encodeURIComponent(message.id)}/mute`, {
    method: 'POST',
    body: JSON.stringify({ durationMinutes }),
  })
  showToast(result.mutedUntil ? `已禁言至 ${formatDateTime(result.mutedUntil)}` : '已解除禁言')
}

function openMessageMenu(event, message) {
  const actions = []
  const conversation = state.conversations.find((item) => item.id === message.conversationId)
  const targetIsManager = (message.roles || []).some((role) => role === 'owner' || role === 'admin')
  const botCanManage = ['owner', 'admin'].includes(conversation?.botState?.memberRole)
  const canRecall = message.direction === 'outgoing'
    || (conversation?.type === 'group' && !targetIsManager && botCanManage)
  if (canRecall && message.status !== 'recalled') {
    actions.push({ label: '撤回', danger: true, run: () => recallFromMenu(message) }, null)
  }
  if (message.status !== 'recalled') {
    actions.push(
      { label: '引用回复', run: () => selectReplyTarget(message, true) },
      { label: '不引用回复', run: () => selectReplyTarget(message, false) },
    )
  }
  if (actions.length) showContextMenu(event, actions)
}

function openAvatarMenu(event, message) {
  const conversation = state.conversations.find((item) => item.id === state.selectedId)
  if (conversation?.type !== 'group' || message.direction !== 'incoming' || !message.senderOpenid) return
  showContextMenu(event, [
    { label: `@${message.senderName}`, run: () => insertMention(message) },
    null,
    { label: '禁言 10 分钟', run: () => muteFromMenu(message, 10) },
    { label: '禁言 1 小时', run: () => muteFromMenu(message, 60) },
    { label: '禁言 1 天', run: () => muteFromMenu(message, 1440) },
    {
      label: '自定义禁言…',
      run: () => {
        const value = window.prompt('请输入禁言分钟数（1-43200）', '10')
        if (value === null) return
        const minutes = Number(value)
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43_200) throw new Error('请输入 1 到 43200 之间的整数')
        return muteFromMenu(message, minutes)
      },
    },
    { label: '解除禁言', run: () => muteFromMenu(message, 0) },
  ])
}

function renderStatus() {
  const statusMap = {
    disconnected: ['未连接', '请配置或连接机器人'],
    connecting: ['连接中', '正在连接 QQ 官方网关…'],
    connected: ['已连接', state.status.account?.name || (state.status.selfId ? `Bot ${state.status.selfId}` : '网关连接正常')],
    error: ['连接失败', state.status.error || '请检查配置'],
  }
  const [label, detail] = statusMap[state.status.state]
  elements.statusLabel.textContent = label
  elements.statusDetail.textContent = detail
  elements.statusDot.className = `status-dot ${state.status.state}`
  elements.connectionButton.textContent = state.status.state === 'connected' ? '断开' : '连接'
  elements.connectionButton.disabled = state.status.state === 'connecting'
  elements.sendButton.disabled = state.status.state !== 'connected'
  elements.refreshBotState.disabled = state.status.state !== 'connected'
}

function renderAccounts() {
  const selected = state.accounts.find((account) => account.selected)
  elements.accountSelect.replaceChildren()
  if (state.accounts.length === 0) {
    const option = document.createElement('option')
    option.value = ''
    option.textContent = '暂无 Bot，请添加'
    elements.accountSelect.append(option)
    elements.accountSelect.disabled = true
    return
  }
  elements.accountSelect.disabled = state.status.state === 'connecting'
  for (const account of state.accounts) {
    const option = document.createElement('option')
    option.value = account.id
    option.textContent = account.name || `Bot ${account.appid}`
    option.selected = account.id === selected?.id
    elements.accountSelect.append(option)
  }
}

function applyAccountSnapshot(snapshot) {
  state.accounts = snapshot.accounts || []
  state.conversations = snapshot.conversations || []
  state.status = snapshot.status || state.status
  state.selectedId = null
  state.messages = []
  resetComposer(true)
  closeContextMenu()
  renderAccounts()
  renderStatus()
  renderConversations()
  renderSelectedConversation()
}

function renderConversations() {
  const query = state.query.toLocaleLowerCase('zh-CN')
  const filtered = state.conversations.filter((conversation) =>
    `${conversation.title} ${conversation.subtitle} ${conversation.lastMessage}`.toLocaleLowerCase('zh-CN').includes(query),
  )
  elements.conversationList.replaceChildren()
  if (filtered.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'list-empty'
    empty.textContent = state.query ? '没有匹配的会话' : '暂无会话\n收到消息后会自动出现'
    elements.conversationList.append(empty)
    return
  }
  for (const conversation of filtered) {
    const button = document.createElement('button')
    button.className = `conversation-item ${conversation.id === state.selectedId ? 'active' : ''}`
    button.addEventListener('click', () => selectConversation(conversation.id))

    const avatar = document.createElement('span')
    avatar.className = `conversation-avatar ${conversation.type}`
    renderAvatar(avatar, conversation.title, conversation.avatarUrl)
    const content = document.createElement('span')
    content.className = 'conversation-content'
    const top = document.createElement('span')
    top.className = 'conversation-top'
    const title = document.createElement('strong')
    title.textContent = conversation.title
    const time = document.createElement('time')
    time.textContent = formatTime(conversation.updatedAt)
    top.append(title, time)
    const preview = document.createElement('span')
    preview.className = 'conversation-preview'
    preview.textContent = conversation.lastMessage
    content.append(top, preview)
    button.append(avatar, content)
    if (conversation.unread > 0) {
      const unread = document.createElement('span')
      unread.className = 'unread-badge'
      unread.textContent = conversation.unread > 99 ? '99+' : String(conversation.unread)
      button.append(unread)
    }
    elements.conversationList.append(button)
  }
}

function renderMessages() {
  elements.messageList.replaceChildren()
  let lastDate = ''
  for (const message of state.messages) {
    const dateLabel = new Date(message.timestamp).toLocaleDateString('zh-CN')
    if (dateLabel !== lastDate) {
      const divider = document.createElement('div')
      divider.className = 'date-divider'
      divider.textContent = dateLabel
      elements.messageList.append(divider)
      lastDate = dateLabel
    }
    const row = document.createElement('div')
    row.className = `message-row ${message.direction}`
    const avatar = document.createElement('span')
    avatar.className = 'message-avatar'
    renderAvatar(avatar, message.direction === 'outgoing' ? 'Q' : message.senderName, message.direction === 'incoming' ? message.avatarUrl : undefined)
    avatar.addEventListener('contextmenu', (event) => openAvatarMenu(event, message))
    const stack = document.createElement('div')
    stack.className = 'message-stack'
    const meta = document.createElement('div')
    meta.className = 'message-meta'
    const sender = document.createElement('span')
    sender.className = 'message-sender'
    sender.textContent = message.senderName
    meta.append(sender)
    for (const badgeName of getMessageBadges(message)) {
      const badge = document.createElement('span')
      badge.className = `sender-badge ${badgeName}`
      badge.textContent = messageBadgeLabels[badgeName]
      meta.append(badge)
    }
    const time = document.createElement('time')
    time.textContent = formatTime(message.timestamp)
    meta.append(time)
    const bubble = document.createElement('div')
    bubble.className = 'message-bubble'
    renderMessageContent(bubble, message)
    bubble.addEventListener('contextmenu', (event) => openMessageMenu(event, message))
    stack.append(meta)
    if (message.refMsgIdx) {
      const quoted = state.messages.find((item) => item.msgIdx === message.refMsgIdx)
      const preview = document.createElement('div')
      preview.className = 'message-quote-preview'
      preview.textContent = quoted
        ? `${quoted.senderName}：${quoted.content}`
        : `引用消息索引：${message.refMsgIdx}`
      stack.append(preview)
    }
    stack.append(bubble)
    row.append(avatar, stack)
    elements.messageList.append(row)
  }
  requestAnimationFrame(() => {
    elements.messageList.scrollTop = elements.messageList.scrollHeight
  })
}

function getMessageBadges(message) {
  const badges = new Set()
  const conversation = state.conversations.find((item) => item.id === message.conversationId)
  if (message.direction === 'outgoing') {
    badges.add('bot')
    if (conversation?.type === 'group' && ['owner', 'admin'].includes(conversation.botState?.memberRole)) {
      badges.add(conversation.botState.memberRole)
    }
  } else {
    for (const role of message.roles || []) {
      if (role === 'owner' || role === 'admin') badges.add(role)
    }
  }
  return [...badges]
}

function renderSelectedConversation() {
  const conversation = state.conversations.find((item) => item.id === state.selectedId)
  const hasConversation = Boolean(conversation)
  elements.emptyState.classList.toggle('hidden', hasConversation)
  elements.chatView.classList.toggle('hidden', !hasConversation)
  if (!conversation) return

  elements.chatTitle.textContent = conversation.title
  elements.chatSubtitle.textContent = conversation.subtitle
  elements.chatType.textContent = typeLabels[conversation.type]
  elements.detailAvatar.className = `detail-avatar ${conversation.type}`
  renderAvatar(elements.detailAvatar, conversation.title, conversation.avatarUrl)
  elements.detailTitle.textContent = conversation.title
  elements.detailSubtitle.textContent = conversation.subtitle
  elements.refreshBotState.classList.toggle('hidden', conversation.type !== 'group')
  elements.detailList.replaceChildren()
  const details = [['会话类型', typeLabels[conversation.type]], ['目标 OpenID', conversation.targetId]]
  if (conversation.type === 'group') {
    if (conversation.groupMemberCount !== undefined) details.push(['群成员数', String(conversation.groupMemberCount)])
    if (conversation.category) details.push(['群分类', conversation.category])
    if (conversation.description) details.push(['群简介', conversation.description])
    if (conversation.tags?.length) details.push(['群标签', conversation.tags.join('、')])
    if (conversation.botState) {
      details.push(['机器人群内身份', botRoleLabels[conversation.botState.memberRole] || conversation.botState.memberRole])
      details.push(['机器人群内 OpenID', conversation.botState.memberOpenid])
      details.push(['机器人入群时间', formatDateTime(conversation.botState.joinedAt)])
      details.push(['允许主动消息', conversation.botState.allowProactiveMsg ? '是' : '否'])
      details.push(['接收消息设置', receiveSettingLabels[conversation.botState.recvMsgSetting] || conversation.botState.recvMsgSetting])
      details.push(['状态更新时间', formatDateTime(conversation.botState.updatedAt)])
    } else {
      details.push(['机器人群内状态', '尚未获取，可点击刷新状态'])
    }
  }
  for (const [label, value] of details) {
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = value
    elements.detailList.append(dt, dd)
  }
  renderMessages()
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleString('zh-CN', { hour12: false })
}

async function loadConversations() {
  state.conversations = await api('/api/conversations')
  if (state.selectedId && !state.conversations.some((item) => item.id === state.selectedId)) state.selectedId = null
  renderConversations()
  renderSelectedConversation()
}

async function selectConversation(id) {
  if (state.selectedId !== id) resetComposer(true)
  closeContextMenu()
  state.selectedId = id
  state.messages = await api(`/api/conversations/${encodeURIComponent(id)}/messages`)
  await api(`/api/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' })
  const conversation = state.conversations.find((item) => item.id === id)
  if (conversation) conversation.unread = 0
  renderConversations()
  renderSelectedConversation()
  if (window.innerWidth < 760) document.body.classList.add('mobile-chat-open')
}

function showToast(message, isError = false) {
  elements.toast.textContent = message
  elements.toast.className = `toast visible ${isError ? 'error' : ''}`
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => { elements.toast.className = 'toast' }, 2800)
}

async function openSettings(mode = 'edit') {
  try {
    const config = mode === 'new'
      ? { accountId: null, name: '', appid: '', sandbox: false, secretConfigured: false }
      : await api('/api/config')
    if (mode === 'edit' && !config.accountId) return openSettings('new')
    elements.settingsTitle.textContent = mode === 'new' ? '添加 Bot 账号' : '编辑 Bot 账号'
    elements.accountIdInput.value = config.accountId || ''
    elements.accountNameInput.value = config.name || ''
    elements.appidInput.value = config.appid
    elements.secretInput.value = ''
    elements.sandboxInput.checked = config.sandbox
    elements.secretInput.required = !config.secretConfigured
    elements.secretHint.textContent = config.secretConfigured ? '已保存 Secret；留空可保持不变。' : '尚未配置 Secret。'
    elements.deleteAccount.classList.toggle('hidden', mode === 'new')
    elements.settingsError.textContent = ''
    elements.settingsDialog.showModal()
  } catch (error) {
    showToast(error.message, true)
  }
}

elements.settingsButton.addEventListener('click', () => openSettings('edit'))
elements.emptySettingsButton.addEventListener('click', () => openSettings('edit'))
elements.addAccountButton.addEventListener('click', () => openSettings('new'))
elements.closeSettings.addEventListener('click', () => elements.settingsDialog.close())
elements.cancelSettings.addEventListener('click', () => elements.settingsDialog.close())
elements.settingsDialog.addEventListener('click', (event) => {
  if (event.target === elements.settingsDialog) elements.settingsDialog.close()
})

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  elements.settingsError.textContent = ''
  try {
    await api('/api/config', {
      method: 'PUT',
      body: JSON.stringify({
        accountId: elements.accountIdInput.value || undefined,
        name: elements.accountNameInput.value,
        appid: elements.appidInput.value,
        secret: elements.secretInput.value,
        sandbox: elements.sandboxInput.checked,
      }),
    })
    elements.settingsDialog.close()
    state.accounts = await api('/api/accounts')
    renderAccounts()
    await connect()
    await loadConversations()
    showToast('配置已保存，机器人已连接')
  } catch (error) {
    elements.settingsError.textContent = error.message
  }
})

elements.deleteAccount.addEventListener('click', async () => {
  const accountId = elements.accountIdInput.value
  if (!accountId) return
  if (!window.confirm('删除此 Bot 账号配置？聊天记录文件会保留。')) return
  elements.deleteAccount.disabled = true
  try {
    const snapshot = await api(`/api/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' })
    elements.settingsDialog.close()
    applyAccountSnapshot(snapshot)
    showToast('Bot 账号配置已删除，聊天记录文件已保留')
  } catch (error) {
    elements.settingsError.textContent = error.message
  } finally {
    elements.deleteAccount.disabled = false
  }
})

async function connect() {
  state.status.state = 'connecting'
  renderStatus()
  try {
    state.status = await api('/api/connect', { method: 'POST' })
  } catch (error) {
    state.status = { state: 'error', error: error.message, selfId: null }
    throw error
  } finally {
    renderStatus()
  }
}

elements.connectionButton.addEventListener('click', async () => {
  try {
    if (state.status.state === 'connected') {
      state.status = await api('/api/disconnect', { method: 'POST' })
    } else {
      const config = await api('/api/config')
      if (!config.appid || !config.secretConfigured) return openSettings(config.accountId ? 'edit' : 'new')
      await connect()
    }
    renderStatus()
  } catch (error) {
    showToast(error.message, true)
  }
})

elements.accountSelect.addEventListener('change', async () => {
  const accountId = elements.accountSelect.value
  if (!accountId) return
  elements.accountSelect.disabled = true
  state.status = { ...state.status, state: 'connecting', error: '' }
  renderStatus()
  try {
    const snapshot = await api('/api/accounts/select', {
      method: 'POST',
      body: JSON.stringify({ accountId, connect: true }),
    })
    applyAccountSnapshot(snapshot)
    if (snapshot.status.state === 'error') showToast(snapshot.status.error || 'Bot 连接失败', true)
    else showToast(`已切换到 ${snapshot.status.account?.name || 'Bot'}`)
  } catch (error) {
    showToast(error.message, true)
    state.accounts = await api('/api/accounts')
    state.status = await api('/api/status')
    renderAccounts()
    renderStatus()
  }
})

elements.refreshBotState.addEventListener('click', async () => {
  const conversation = state.conversations.find((item) => item.id === state.selectedId)
  if (!conversation || conversation.type !== 'group') return
  elements.refreshBotState.disabled = true
  elements.refreshBotState.textContent = '刷新中…'
  try {
    const updated = await api(`/api/conversations/${encodeURIComponent(conversation.id)}/bot-state`, { method: 'POST' })
    const index = state.conversations.findIndex((item) => item.id === updated.id)
    if (index >= 0) state.conversations[index] = updated
    renderConversations()
    renderSelectedConversation()
    showToast('机器人群内状态已刷新')
  } catch (error) {
    showToast(error.message, true)
  } finally {
    elements.refreshBotState.textContent = '刷新状态'
    elements.refreshBotState.disabled = state.status.state !== 'connected'
  }
})

elements.searchInput.addEventListener('input', () => {
  state.query = elements.searchInput.value
  renderConversations()
})

elements.messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    elements.composer.requestSubmit()
  }
})

elements.messageInput.addEventListener('input', () => {
  elements.messageInput.style.height = 'auto'
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 140)}px`
})

elements.cancelReply.addEventListener('click', () => {
  state.replyTarget = null
  renderReplyPreview()
  elements.messageInput.focus()
})

document.addEventListener('pointerdown', (event) => {
  if (!elements.contextMenu.contains(event.target)) closeContextMenu()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeContextMenu()
})
window.addEventListener('resize', closeContextMenu)
elements.messageList.addEventListener('scroll', closeContextMenu, { passive: true })

elements.composer.addEventListener('submit', async (event) => {
  event.preventDefault()
  const content = elements.messageInput.value.trim()
  if (!content || !state.selectedId) return
  elements.sendButton.disabled = true
  try {
    const message = await api(`/api/conversations/${encodeURIComponent(state.selectedId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        ...(state.replyTarget ? {
          reply: { messageId: state.replyTarget.messageId, quote: state.replyTarget.quote },
        } : {}),
        mentions: state.mentions.filter((mention) => content.includes(mention.token)),
      }),
    })
    resetComposer(true)
    if (!state.messages.some((item) => item.id === message.id)) state.messages.push(message)
    await loadConversations()
    renderMessages()
  } catch (error) {
    showToast(error.message, true)
  } finally {
    elements.sendButton.disabled = state.status.state !== 'connected'
  }
})

const eventSource = new EventSource('/api/events')
eventSource.addEventListener('status', (event) => {
  state.status = JSON.parse(event.data)
  renderStatus()
})
eventSource.addEventListener('message', async (event) => {
  const payload = JSON.parse(event.data)
  if (payload.message.conversationId === state.selectedId && !state.messages.some((item) => item.id === payload.message.id)) {
    state.messages.push(payload.message)
  }
  await loadConversations()
  if (payload.message.conversationId === state.selectedId) {
    await api(`/api/conversations/${encodeURIComponent(state.selectedId)}/read`, { method: 'POST' })
    renderMessages()
  }
})
eventSource.addEventListener('message-update', async (event) => {
  const updated = JSON.parse(event.data)
  if (updated.conversationId === state.selectedId) {
    const index = state.messages.findIndex((item) => item.id === updated.id)
    if (index >= 0) state.messages[index] = updated
    else state.messages.push(updated)
    renderMessages()
  }
  await loadConversations()
})
eventSource.addEventListener('conversation', (event) => {
  const updated = JSON.parse(event.data)
  const index = state.conversations.findIndex((item) => item.id === updated.id)
  if (index >= 0) state.conversations[index] = updated
  else state.conversations.push(updated)
  renderConversations()
  renderSelectedConversation()
})
eventSource.addEventListener('reset', (event) => {
  applyAccountSnapshot(JSON.parse(event.data))
})

Promise.all([api('/api/status'), api('/api/accounts'), api('/api/conversations')])
  .then(([status, accounts, conversations]) => {
    state.status = status
    state.accounts = accounts
    state.conversations = conversations
    renderStatus()
    renderAccounts()
    renderConversations()
    renderSelectedConversation()
  })
  .catch((error) => showToast(error.message, true))
