---
layout: doc
---

# 链接消息段

链接消息段用于发送可点击的链接，支持频道跳转和外部链接。

## 类型定义

```typescript
interface LinkElement {
  type: 'link'
  channel_id: string
}
```

## 参数说明

| 参数名 | 类型 | 必选 | 说明 |
|--------|------|------|------|
| type | string | ✅ | 消息段类型，固定为 `link` |
| channel_id | string | ✅ | 目标频道 ID |

::: tip 功能说明
链接消息段主要用于频道内跳转，通过 `channel_id` 指定跳转的目标频道。
:::

## 使用方法

### 频道跳转链接

```typescript
import { segment } from 'qq-official-bot'

// 创建频道跳转链接
const channelLink = segment.link('目标频道ID')

// 发送带跳转链接的消息
await bot.sendMessage(channelId, [
  { type: 'text', text: '请访问 ' },
  { type: 'link', channel_id: '目标频道ID' },
  { type: 'text', text: ' 了解更多信息' }
])
  title: '官方文档',
  description: '详细的使用说明和API文档'
})
```

### 频道链接

用于在频道内跳转到其他子频道。

```typescript
import { segment } from 'qq-official-bot'

// 频道跳转链接
const channelLink = segment.link({
  channel_id: 'target_channel_id',
  text: '前往讨论区'
})

// 带描述的频道链接
const richChannelLink = segment.link({
  channel_id: 'announcements_channel_id',
  text: '查看公告',
  title: '公告频道',
  description: '查看最新的频道公告和更新'
})
```

## 使用示例

### 发送单个链接

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 发送外部链接
await bot.client.sendMessage(channelId, [
  segment.link({
    url: 'https://github.com/example/project',
    text: '查看源码'
  })
])

// 发送频道链接
await bot.client.sendMessage(channelId, [
  segment.link({
    channel_id: 'help_channel_id',
    text: '获取帮助'
  })
])
```

### 链接与文字组合

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 文字 + 链接
await bot.client.sendMessage(channelId, [
  segment.text('更多信息请查看：'),
  segment.link({
    url: 'https://docs.example.com',
    text: '官方文档'
  })
])

// 多个链接
await bot.client.sendMessage(channelId, [
  segment.text('相关资源：\n'),
  segment.link({
    url: 'https://github.com/example',
    text: 'GitHub'
  }),
  segment.text(' | '),
  segment.link({
    url: 'https://docs.example.com',
    text: '文档'
  }),
  segment.text(' | '),
  segment.link({
    channel_id: 'support_channel_id',
    text: '技术支持'
  })
])
```

### 链接列表

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 发送链接列表
const links = [
  { url: 'https://example.com/news', text: '最新资讯' },
  { url: 'https://example.com/tutorial', text: '教程指南' },
  { url: 'https://example.com/api', text: 'API 文档' }
]

const elements = [segment.text('📋 资源导航：\n')]

links.forEach((link, index) => {
  elements.push(
    segment.text(`${index + 1}. `),
    segment.link(link),
    segment.text('\n')
  )
})

await bot.client.sendMessage(channelId, elements)
```

## 在不同服务中使用

### 频道服务

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 频道导航
await bot.guildService.sendChannelMessage(channelId, [
  segment.text('频道导航：\n'),
  segment.link({
    channel_id: 'general_channel_id',
    text: '🏠 大厅'
  }),
  segment.text(' | '),
  segment.link({
    channel_id: 'announcement_channel_id',
    text: '📢 公告'
  }),
  segment.text(' | '),
  segment.link({
    channel_id: 'help_channel_id',
    text: '❓ 帮助'
  })
])
```

### 私聊服务（频道私信）

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 在频道私信中发送链接
await bot.directService.sendMessage(guildId, userId, [
  segment.text('私人资源：'),
  segment.link({
    url: 'https://private.example.com',
    text: '专属链接',
    title: '会员专区',
    description: '仅限会员访问的特殊内容'
  })
])
```

## 智能链接生成

### URL 检测和转换

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 检测消息中的URL并转换为链接
function convertUrlsToLinks(text: string): any[] {
  const urlRegex = /https?:\/\/[^\s]+/g
  const urls = text.match(urlRegex) || []
  
  if (urls.length === 0) {
    return [segment.text(text)]
  }
  
  const elements: any[] = []
  let lastIndex = 0
  
  urls.forEach(url => {
    const index = text.indexOf(url, lastIndex)
    
    // 添加URL前的文字
    if (index > lastIndex) {
      elements.push(segment.text(text.substring(lastIndex, index)))
    }
    
    // 添加链接
    elements.push(segment.link({
      url: url,
      text: url
    }))
    
    lastIndex = index + url.length
  })
  
  // 添加剩余文字
  if (lastIndex < text.length) {
    elements.push(segment.text(text.substring(lastIndex)))
  }
  
  return elements
}

// 使用示例
bot.on('message.guild', async (event) => {
  if (event.content?.includes('http')) {
    const elements = convertUrlsToLinks(event.content)
    
    await bot.guildService.sendChannelMessage(event.channel_id, [
      segment.text('检测到链接，为您自动转换：\n'),
      ...elements
    ])
  }
})
```

### 链接预览生成

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 生成带预览信息的链接
async function createRichLink(url: string): Promise<any> {
  try {
    // 这里可以调用第三方服务获取页面信息
    const pageInfo = await fetchPageInfo(url)
    
    return segment.link({
      url: url,
      text: pageInfo.title || url,
      title: pageInfo.title,
      description: pageInfo.description
    })
  } catch (error) {
    // 获取失败时返回基础链接
    return segment.link({
      url: url,
      text: url
    })
  }
}

async function fetchPageInfo(url: string): Promise<{title?: string, description?: string}> {
  // 实际实现需要抓取页面meta信息
  return {
    title: '页面标题',
    description: '页面描述'
  }
}
```

### 链接安全检查

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 安全链接检查
const trustedDomains = [
  'github.com',
  'docs.qq.com',
  'developer.qq.com',
  'example.com'
]

function isUrlSafe(url: string): boolean {
  try {
    const urlObj = new URL(url)
    return trustedDomains.some(domain => 
      urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain)
    )
  } catch {
    return false
  }
}

function createSafeLink(url: string, text?: string): any {
  if (isUrlSafe(url)) {
    return segment.link({ url, text: text || url })
  } else {
    return segment.text(`⚠️ 不安全链接: ${url}`)
  }
}

// 使用示例
await bot.client.sendMessage(channelId, [
  segment.text('推荐资源：'),
  createSafeLink('https://github.com/example/repo', 'GitHub仓库'),
  segment.text(' | '),
  createSafeLink('https://suspicious-site.com', '可疑网站') // 会显示警告
])
```

## 链接管理和统计

### 链接点击统计

```typescript
class LinkClickTracker {
  private clicks = new Map<string, number>()
  private clickDetails = new Map<string, Array<{userId: string, timestamp: number}>>()
  
  trackClick(url: string, userId: string) {
    // 统计总点击数
    const count = this.clicks.get(url) || 0
    this.clicks.set(url, count + 1)
    
    // 记录详细点击信息
    const details = this.clickDetails.get(url) || []
    details.push({ userId, timestamp: Date.now() })
    this.clickDetails.set(url, details)
  }
  
  getPopularLinks(limit: number = 5): Array<{url: string, clicks: number}> {
    return Array.from(this.clicks.entries())
      .map(([url, clicks]) => ({ url, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, limit)
  }
  
  getClickReport(url: string): string {
    const clicks = this.clicks.get(url) || 0
    const details = this.clickDetails.get(url) || []
    const uniqueUsers = new Set(details.map(d => d.userId)).size
    
    return `链接: ${url}\n总点击: ${clicks}次\n独立用户: ${uniqueUsers}人`
  }
}

const linkTracker = new LinkClickTracker()

// 监听链接点击（需要自定义实现）
bot.on('link.click', (event) => {
  linkTracker.trackClick(event.url, event.user_id)
})
```

### 动态链接生成

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 根据用户生成个性化链接
function generatePersonalizedLink(userId: string, baseUrl: string): any {
  const personalUrl = `${baseUrl}?user=${userId}&token=${generateToken(userId)}`
  
  return segment.link({
    url: personalUrl,
    text: '专属链接',
    title: '个人中心',
    description: '访问你的专属页面'
  })
}

function generateToken(userId: string): string {
  // 生成用户专属token
  return Buffer.from(`${userId}_${Date.now()}`).toString('base64').substring(0, 16)
}

// 使用示例
bot.on('message.guild', async (event) => {
  if (event.content === '我的链接') {
    const personalLink = generatePersonalizedLink(event.author.id, 'https://example.com/profile')
    
    await bot.guildService.sendChannelMessage(event.channel_id, [
      segment.text('这是你的专属链接：'),
      personalLink
    ])
  }
})
```

## 链接样式优化

### 链接文字优化

```typescript
// 链接文字最佳实践
const goodLinkTexts = [
  '查看详情',      // 明确的行动指示
  '下载文件',      // 具体的操作
  '访问官网',      // 清晰的目标
  '技术文档',      // 内容描述
  '用户指南'       // 功能说明
]

const badLinkTexts = [
  '点击这里',      // 太泛泛
  '链接',         // 没有描述性
  '这个',         // 指代不明
  'URL',         // 技术术语
  '网站'          // 太模糊
]

// ✅ 好的做法
segment.link({
  url: 'https://docs.example.com',
  text: '查看API文档'
})

// ❌ 避免的做法  
segment.link({
  url: 'https://docs.example.com',
  text: '点击这里'
})
```

### 链接分组显示

```typescript
import { Bot, segment } from 'qq-official-bot'

const bot = new Bot(config)

// 按类别分组显示链接
async function sendCategorizedLinks(channelId: string) {
  const linkCategories = {
    '📚 学习资源': [
      { url: 'https://tutorial.example.com', text: '新手教程' },
      { url: 'https://advanced.example.com', text: '高级指南' }
    ],
    '🔧 开发工具': [
      { url: 'https://github.com/example', text: 'GitHub' },
      { url: 'https://api.example.com', text: 'API文档' }
    ],
    '💬 社区支持': [
      { channel_id: 'help_channel_id', text: '帮助频道' },
      { channel_id: 'feedback_channel_id', text: '反馈建议' }
    ]
  }
  
  const elements = []
  
  Object.entries(linkCategories).forEach(([category, links]) => {
    elements.push(segment.text(`\n${category}:\n`))
    
    links.forEach((link, index) => {
      elements.push(
        segment.text(`  ${index + 1}. `),
        segment.link(link),
        segment.text('\n')
      )
    })
  })
  
  await bot.client.sendMessage(channelId, elements)
}
```

## 最佳实践

### 链接可访问性

```typescript
// 确保链接在不同平台都能正常访问
function createCompatibleLink(url: string, text: string): any {
  // 检查URL格式
  try {
    new URL(url)
    return segment.link({ url, text })
  } catch {
    return segment.text(`[无效链接] ${text}`)
  }
}
```

### 链接备用方案

```typescript
// 提供链接的备用访问方式
function createLinkWithFallback(url: string, text: string): any[] {
  return [
    segment.link({ url, text }),
    segment.text(` (如无法访问请复制: ${url})`)
  ]
}
```

### 错误处理

```typescript
try {
  await bot.client.sendMessage(channelId, [
    segment.link({
      url: 'https://example.com',
      text: '访问链接'
    })
  ])
} catch (error) {
  console.error('发送链接失败:', error)
  
  // 发送纯文本备用方案
  await bot.client.sendMessage(channelId, [
    segment.text('链接: https://example.com (请手动复制访问)')
  ])
}
```

## 组合规则

链接消息段可以与以下消息段组合使用：

- ✅ **文本消息段** - 最常见的组合
- ✅ **@消息段** - @用户并发送链接
- ✅ **回复消息段** - 回复时发送链接
- ✅ **表情消息段** - 链接配表情
- ✅ **其他链接消息段** - 发送多个链接
- ❌ **图片消息段** - 不建议同时使用
- ❌ **视频消息段** - 不建议同时使用
- ❌ **音频消息段** - 不建议同时使用

## 限制说明

1. **使用范围**：主要在频道和频道私信中可用
2. **URL 格式**：外部链接必须是有效的 HTTP/HTTPS URL
3. **频道权限**：频道跳转需要用户有访问目标频道的权限
4. **链接数量**：建议单条消息中链接数量不超过5个
5. **文字长度**：链接显示文字建议控制在20字以内
6. **安全限制**：某些域名可能被限制访问
