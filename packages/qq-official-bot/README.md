# 内置 QQ 官方机器人 SDK

本目录是 Web QQ 项目内置的 `qq-official-bot` SDK，包含源码与已编译的 `lib` 产物，供上层 Web 项目通过本地文件依赖直接使用。

- SDK 上游仓库：<https://github.com/dndss/qq-official-bot>
- 当前内置版本基于上游提交 `4f5fe03`。
- 更新 SDK 时，请从上游同步源码后在本目录执行 `pnpm install` 和 `pnpm run build`，并同时提交源码及重新生成的 `lib` 产物。

以下为 SDK 原始说明。

# qq-official-bot

[![CI](https://github.com/zhinjs/qq-official-bot/actions/workflows/release.yaml/badge.svg?branch=master&event=push)](https://github.com/zhinjs/qq-official-bot/actions/workflows/release.yaml)
[![Docs](https://github.com/zhinjs/qq-official-bot/actions/workflows/docs.yaml/badge.svg?branch=master&event=push)](https://github.com/zhinjs/qq-official-bot/actions/workflows/docs.yaml)
[![npm version](https://img.shields.io/npm/v/qq-official-bot/latest.svg)](https://www.npmjs.com/package/qq-official-bot)
[![qq group](https://img.shields.io/badge/group-446290761-blue?style=flat-square&labelColor=FAFAFA&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAD4AAAA+CAMAAABEH1h2AAACB1BMVEX///8AAADoHx/6rgjnFhb/tQj9/f3/sggEAgLyICD//vztICAGBgbrHx8MDAwJCQn7rwj09PTi4uKbm5uBgYHvICAREREODg79sQgkJCT39/f/+/HExMT3q6tNTU37vTRFMQI4JwIgFgHt7e3r6+vd3d3b29u7u7uwsLDyenp4eHjxc3NZWVn//fj//PTf399vb29UVFQ8PDwuLi76uCUgICDfHh7oGhoYGBgVFRWjcgf6+vrR0dG2traYmJiUlJRqampiYmJXV1dDQ0M2Njbk5OTX19fKysr+5a70lJTyfX1zc3P90Gz+yFBGRkbsRET+vCn6tyLUHBwcHBzDGhqxFxesFxeeFRV4EBD/twjGiwa0fwaodgUbAwMJBgD++PjT09O/v7+xsbGpqamoqKj4p6eJiYloaGgxMTEnJyfv7+/96Ojm5ubq5eX84ODP1NTOzs7Nzc3/wcH4vb34urqioqKKioqCfXTvZWWeY2OMfmCgh1G8l0TdqjrqKirZHR3mHBy3GBiXFBSSExN/EREmERHmDg76sAxVCwtICgr/vQlECQnupwjupgjrpQg4CAjUlAfQkgfMjwbAhga7gwYiBQWJYASAWgR3UwRrSwNiRQMUAgISAgISDQEUDgD/9+X+9uX60dH3sbH94aP94aK/kZG+kJCMjIzzhobwbm7uXl7uWlrpLCyLIqc8AAAEYklEQVRIx62Wd1vaUBTGcxACmIBYRpG2LEFoRcVi0SJaLLV1a927rXV277333nvv/SF7b3JNi+Qm2KfvPyT35Pck57znXg6jKNblYpl/00brTDpWVBRLz1g3LpatnUwXgKSC9GTtYujlq2GBVi/PnT5SAFkqOJIjzEZBVtHcqrgKKFqVC30YqDqsTpesBUHmlC0mXsVsKbN4tbZEFV9PKlXHMMWrhZoXM0wdqeV6VcsMIKgB32ziAfhN+KpBXDWo2VcJotDLt9axGwA2CPWuI8uVKpmTr+Q3MsVFMJFCn8HWuyPbSniSk3L20yDhSeRUK0Dr1/S6mekgwWFasWOkZg0xO+YgjOroLsHtHpKaV6l3lpiBKIUSCQVqAGp24EAKiMxLFPAwzGvppvn+W4UtWCoFwgq4DST1WLdFDYJZ0W3WHpBkU7SNLnXrkM9EBr/3+ZPEyKOHDx+NJJ489/pJNwl9QFPhGhDkfzp8S69D0iMJv7eGn/rF2JpCKh4Qt8v4gxt6S16GLPobD8bFbROg+0YK7Bux6DJ4dDviI5bQnauQbPeO3tHpnBYBdep0d0a9kvEVKl1D8n+RuHc7z+nMu30v8QLnrd43uy9neDTu93m9Pv94xuLl3VT8ULx/8OaYASgyjN0c7I8fouLHjHYjF+8dGLx29/Erw1/cq8d3rw0O9MY59MAxGr3njEmj0Zg4u9Fuinf3nu8fuHDx4oWB/vO93XETWuSE8Jk9FLzZqPkjE8fZ7UYku53DnCRjszy9pZPT5CCuc4ssfsBoygU3GQ/I4sf7znJGzqSIogfO9h2Xo3c5YOz6pb7uc9pqObJaq9We6+67dH0MHLtkcCsIevll6ke1RBBVa351/myZ+vwSBFll8A4QtZf5oBXpzpZSpJXfmqcOvt+J67WX9EJHNh00SztqhYhrW2g70hzMwutBVE2xhK9c+ExxDXmoPgt3g3SaSDjtNAK37EGDVeSi464iAPkjJwSLwSFEOeFz+3iwyaZOSndFi3WllFK67ORdc3hb94jG7VzR3FL6vXTlQVnjerD5c66MQCMOVOIMDPsZqvZj0laJX9KYEUiigKNiOyBN0nEhvr3CgV6SzBxphE5O4iGglY63ojCfFHbH8oV4A8vU4lFsllX8C4zVMmzDQjwIHYXEPn4fDd/HE8sKOyCz69kJTDM4LYjS8CjgAjGYn2Cp86wjKE8HHapzbQC3ZUQ+FsEtHWAUFeIFDyinER9iVLQOD39hmakJD4zr6JzE84ivzzpNEM2r0+VN7YnXeHbe+vfqVjxnv060N5UrwvkfPWiWue/F51kk3MgKnjaGI2Y8MdxHM47nU74C3abTo3lCnzfqA+zgrDsScc86hHllNE8I6dro/LurQ3q902lxDlmGn/neANEb37NhyxBadur1Q1ff0t/e1Nbu8VRVbd5c1dXlOX3q5ImjR0+cPHXa09WF16o8nva2pnzl9MvKlyGVl5Xl5wtPop+y+TWC/jf9BuxZscgeRqlfAAAAAElFTkSuQmCC&logoColor=000000)](https://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=rYaL-gcqTjWYqwBs9TDoVSXKu-i5ircB&authKey=TO02faBOpfhmfkw3YQuUCG2HxUEwWCuFdMBf5nSt3qyWD%2FqaO453O9Dx%2BK8JwBdM&noverify=0&group_code=446290761)

基于 Node.js 的 QQ 官方机器人开发 SDK，采用现代化的模块化架构设计，提供完整的类型支持和丰富的功能。

## ✨ 特性

- 🏗️ **模块化架构** - 采用服务化设计，职责分离，易于维护和扩展
- 🔌 **多种连接方式** - 支持 WebSocket、Webhook 和中间件模式
- 🌐 **自定义网关地址** - WebSocket 模式可配置 `accessTokenUrl` 与 `gatewayUrl`，便于代理或私有部署
- 📝 **完整类型支持** - 使用 TypeScript 开发，提供完整的类型定义
- 🚀 **简单易用** - 提供直观的 API 接口和丰富的示例
- 🛠️ **功能全面** - 覆盖 QQ 官方 API 的所有功能
- 🔒 **安全可靠** - 内置请求验证和错误处理机制

## 📦 安装

```bash
npm install qq-official-bot
# 或者
yarn add qq-official-bot
# 或者
pnpm add qq-official-bot
```

## 🎯 核心架构

项目采用分层架构设计：

- **Bot 层** - 对外提供统一的 API 接口
- **Service 层** - 业务逻辑服务，负责具体功能实现
- **Client 层** - 底层客户端，处理认证和连接管理
- **Message 层** - 消息处理和构建
- **Events 层** - 事件系统和调度器
## 🚀 快速开始

### 1. WebSocket 连接模式

```typescript
import { Bot, ReceiverMode } from 'qq-official-bot'

const bot = new Bot({
    appid: 'your_app_id',           // QQ 机器人的 App ID
    secret: 'your_app_secret',      // QQ 机器人的 App Secret
    sandbox: false,                 // 是否为沙箱环境
    removeAt: true,                 // 自动移除消息中的 @机器人
    logLevel: 'info',               // 日志级别
    maxRetry: 10,                   // 最大重连次数
    intents: [
        'GROUP_AND_C2C_EVENT',     // 群聊@消息与私聊事件
        'GUILD_MESSAGES',              // 频道消息事件
        'DIRECT_MESSAGE',              // 频道私信事件
        'GUILD_MESSAGE_REACTIONS',     // 频道消息表态事件
        'GUILDS',                      // 频道变更事件
        'GUILD_MEMBERS',               // 频道成员变更事件
    ],
    mode: ReceiverMode.WEBSOCKET,   // 连接模式
})

// 启动机器人
await bot.start()
```

如需通过代理或自建服务接入官方网关，可自定义认证与 gateway 接口地址（WebSocket 地址仍由 gateway 响应中的 `url` 字段返回）：

```typescript
const bot = new Bot({
    appid: 'your_app_id',
    secret: 'your_app_secret',
    intents: ['GUILD_MESSAGES'],
    mode: ReceiverMode.WEBSOCKET,
    // 可选：自定义 token 接口（完整 URL）
    accessTokenUrl: 'https://your-proxy.example.com/app/getAppAccessToken',
    // 可选：自定义 gateway 接口（完整 URL 或相对路径）
    gatewayUrl: 'https://your-proxy.example.com/gateway/bot',
})
```

### 2. Webhook 连接模式

```typescript
import { Bot, ReceiverMode } from 'qq-official-bot'

const bot = new Bot({
    appid: 'your_app_id',
    secret: 'your_app_secret',
    // ...其他配置
    mode: ReceiverMode.WEBHOOK,
    port: 3000,                     // Webhook 监听端口
    path: '/webhook',               // Webhook 路径
})

await bot.start()
```

### 3. 中间件模式 (Express/Koa)

```typescript
import { Bot, ReceiverMode } from 'qq-official-bot'
import express from 'express'

const bot = new Bot({
    appid: 'your_app_id',
    secret: 'your_app_secret',
    // ...其他配置
    mode: ReceiverMode.MIDDLEWARE,
    application: 'express',         // 或 'koa'
})

const app = express()
app.use(bot.middleware)
app.listen(3000)

await bot.start()
```

## 📝 基本用法

### 发送消息

```typescript
// 监听消息事件
bot.on('message.guild', async (event) => {
    // 频道消息回复
    await event.reply('Hello, World!')
})

bot.on('message.group', async (event) => {
    // 群消息回复
    await event.reply('Hello, Group!')
})

bot.on('message.private', async (event) => {
    // 私聊消息回复
    await event.reply('Hello, Private!')
})

// 主动发送消息
await bot.sendMessage(channel_id, 'Hello from bot!')
await bot.sendGroupMessage(group_id, 'Hello, Group!')
await bot.sendPrivateMessage(user_id, 'Hello, User!')
```

### 使用服务模块

```typescript
// 使用频道服务
const guilds = await bot.guildService.getGuilds()
const guildInfo = await bot.guildService.getGuild(guild_id)

// 使用消息服务
await bot.messageService.sendMessage(channel_id, 'Hello!')
await bot.messageService.recallMessage(channel_id, message_id)

// 使用成员管理服务
await bot.memberService.muteGuildMember(guild_id, user_id, '600', '0')
await bot.memberService.kickGuildMember(guild_id, user_id)

// 使用权限管理服务
const permissions = await bot.permissionService.getChannelUserPermissions(channel_id, user_id)
await bot.permissionService.updateChannelUserPermissions(channel_id, user_id, 'add_permission', 'remove_permission')
```
## 🔧 服务模块架构

项目采用服务模块化设计，每个服务负责特定的功能领域：

### 核心服务

| 服务模块 | 功能描述 | 主要方法 |
|---------|---------|----------|
| **GuildService** | 频道管理 | `getGuilds()`, `getGuild()`, `getGuildMembers()` |
| **ChannelService** | 子频道管理 | `getChannel()`, `createChannel()`, `updateChannel()` |
| **MessageService** | 消息处理 | `sendMessage()`, `recallMessage()`, `sendPrivateMessage()` |
| **MemberService** | 成员管理 | `muteGuildMember()`, `kickGuildMember()`, `muteGuildMembers()` |
| **PermissionService** | 权限管理 | `getChannelUserPermissions()`, `updateChannelUserPermissions()` |
| **ReactionService** | 表态管理 | `addGuildMessageReaction()`, `removeGuildMessageReaction()` |
| **ScheduleService** | 日程管理 | `getChannelSchedules()`, `createSchedule()`, `updateSchedule()` |
| **ThreadService** | 帖子管理 | `getThreads()`, `createThread()`, `deleteThread()` |
| **AudioService** | 音频控制 | `controlMemberMic()`, `kickChannelMember()` |
| **BotService** | 机器人信息 | `getSelfInfo()`, `getSelfGuilds()`, `postActionMessage()` |

### 服务特性

- ✅ **统一响应格式** - 所有服务方法返回 `ApiResponse<T>` 格式
- ✅ **错误处理** - 内置错误捕获和处理机制
- ✅ **类型安全** - 完整的 TypeScript 类型定义
- ✅ **向后兼容** - Bot 类保持原有 API 接口不变

## 🎯 API 参考

### 基础 API

| 功能 | 方法 | 参数 | 返回值 |
|-----|------|------|--------|
| 获取机器人信息 | `getSelfInfo()` | - | `User` |
| 获取频道列表 | `getGuilds()` | - | `Guild[]` |
| 获取频道信息 | `getGuild(guild_id)` | `guild_id: string` | `Guild` |
| 获取子频道列表 | `getGuildChannels(guild_id)` | `guild_id: string` | `Channel[]` |
| 获取子频道信息 | `getChannel(channel_id)` | `channel_id: string` | `Channel` |

### 消息 API

| 功能 | 方法 | 参数 | 返回值 |
|-----|------|------|--------|
| 发送频道消息 | `sendMessage(channel_id, content)` | `channel_id: string, content: Sendable` | `any` |
| 发送私聊消息 | `sendPrivateMessage(user_id, content)` | `user_id: string, content: Sendable` | `any` |
| 发送群消息 | `sendGroupMessage(group_id, content)` | `group_id: string, content: Sendable` | `any` |
| 撤回消息 | `recallMessage(channel_id, message_id)` | `channel_id: string, message_id: string` | `any` |

### 成员管理 API

| 功能 | 方法 | 参数 | 返回值 |
|-----|------|------|--------|
| 获取频道成员 | `getGuildMembers(guild_id)` | `guild_id: string` | `GuildMember[]` |
| 禁言成员 | `muteGuildMember(guild_id, user_id, seconds)` | `guild_id: string, user_id: string, seconds: string` | `any` |
| 踢出成员 | `kickGuildMember(guild_id, user_id)` | `guild_id: string, user_id: string` | `any` |

### 权限管理 API

| 功能 | 方法 | 参数 | 返回值 |
|-----|------|------|--------|
| 获取用户权限 | `getChannelUserPermissions(channel_id, user_id)` | `channel_id: string, user_id: string` | `ChannelMemberPermissions` |
| 更新用户权限 | `updateChannelUserPermissions(channel_id, user_id, add?, remove?)` | `channel_id: string, user_id: string, add?: string, remove?: string` | `any` |

## 🔧 配置选项

### Bot 配置

```typescript
interface BotConfig {
    appid: string              // 机器人 App ID
    secret: string             // 机器人 App Secret
    sandbox?: boolean          // 是否为沙箱环境，默认 false
    removeAt?: boolean         // 是否移除消息中的 @，默认 false
    logLevel?: string          // 日志级别，默认 'info'
    maxRetry?: number          // 最大重连次数，默认 10
    intents: Intent[]          // 订阅的事件类型
    mode: ReceiverMode         // 连接模式
    
    // WebSocket 模式特有配置
    accessTokenUrl?: string    // 获取 access token 的完整 URL
    gatewayUrl?: string        // 获取网关信息的 URL 或路径，响应 url 为 WebSocket 地址
    heartbeatInterval?: number // 心跳间隔(ms)
    maxRetries?: number        // 连接重试次数
    reconnectDelay?: number    // 重连延迟(ms)
    
    // Webhook 模式特有配置
    port?: number              // 监听端口
    path?: string              // Webhook 路径
    
    // 中间件模式特有配置
    application?: 'express' | 'koa'  // 使用的框架
}
```

### 事件类型 (Intents)

```typescript
type Intent = 
    // 频道事件
    | 'GUILDS'
    // 频道成员事件
    | 'GUILD_MEMBERS'
    // 频道消息事件
    | 'GUILD_MESSAGES'
    // 频道消息表态事件
    | 'GUILD_MESSAGE_REACTIONS'
    // 频道私信事件
    | 'DIRECT_MESSAGE'
    // 群成员变更事件
    | 'GROUP_MEMBER'
    // 私聊与群聊消息事件
    | 'GROUP_AND_C2C_EVENT'
    // 互动事件
    | 'INTERACTION'
    // 消息审核事件
    | 'MESSAGE_AUDIT'
    // 论坛事件(仅私域)
    | 'FORUMS_EVENT'
    // 音频操作事件
    | 'AUDIO_ACTION'
    // 公域机器人消息事件
    | 'PUBLIC_GUILD_MESSAGES'
```

## 🎨 消息构建

### 基础消息

```typescript
// 文本消息
await bot.sendMessage(channel_id, 'Hello, World!')

// 富文本消息
await bot.sendMessage(channel_id, [
    '这是一条包含 ',
    { type: 'mention', user_id: 'user123' },
    ' 的消息'
])
```

### 高级消息

```typescript
import { MessageBuilder } from 'qq-official-bot'

// 使用消息构建器
const message = bot.messageBuilder
    .text('Hello ')
    .mention(user_id)
    .text('!')
    .build()

await bot.sendMessage(channel_id, message)
```

