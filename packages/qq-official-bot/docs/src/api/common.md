---
layout: doc
---

# 公共 API

机器人的基础 API 接口，包括机器人信息获取、文件上传、操作响应等通用功能。

## 🤖 机器人信息

### 获取机器人信息

获取当前机器人的基本信息。

**方法名**: `bot.botService.getSelfInfo()` / `bot.getSelfInfo()`

**返回类型**: `Promise<ApiResponse<Bot.Info>>`

```typescript
// 使用服务模块（推荐）
const result = await bot.botService.getSelfInfo()
if (result.success) {
    console.log('机器人信息:', result.data)
}

// 使用传统方法（向后兼容）
const botInfo = await bot.getSelfInfo()
```

**返回数据结构**:
```typescript
interface Bot.Info {
    id: string              // 机器人 ID
    username: string        // 机器人用户名
    avatar: string          // 机器人头像 URL
    union_openid?: string   // 联合身份标识
    union_user_account?: string // 联合用户账号
}
```

## 📁 文件上传

### 上传富媒体文件

上传图片、音频、视频等富媒体文件。

**方法名**: `bot.uploadMedia(targetId, targetType, fileData)`

**参数**:
| 参数名 | 类型 | 必填 | 描述 |
|-------|------|------|------|
| `targetId` | `string` | ✅ | 目标 ID（用户 ID 或群组 ID） |
| `targetType` | `'user' \| 'group'` | ✅ | 目标类型 |
| `fileData` | `string \| Buffer` | ✅ | 文件数据 |

**文件数据格式**:
- **本地文件**: `file://path/to/file.jpg`
- **网络 URL**: `https://example.com/image.jpg`
- **Base64**: `data:image/jpeg;base64,/9j/4AAQ...`
- **Buffer**: 直接传入 Buffer 对象

```typescript
// 上传本地文件
const result1 = await bot.uploadMedia(user_id, 'user', 'file:///path/to/image.jpg')

// 上传网络文件
const result2 = await bot.uploadMedia(user_id, 'user', 'https://example.com/image.jpg')

// 上传 Base64 数据
const result3 = await bot.uploadMedia(user_id, 'user', 'data:image/jpeg;base64,/9j/4AAQ...')

// 上传 Buffer
const buffer = fs.readFileSync('image.jpg')
const result4 = await bot.uploadMedia(user_id, 'user', buffer)
```

**返回数据结构**:
```typescript
interface UploadResult {
    file_uuid: string       // 文件唯一标识
    file_info: string       // 文件信息
    ttl: number            // 文件有效期（秒）
}
```

## 🎯 操作响应

### 响应操作事件

响应用户的交互操作（如按钮点击、表单提交等）。

**方法名**: `bot.botService.replyAction(actionId, code?)` / `bot.replyAction(actionId, code?)`

**参数**:
| 参数名 | 类型 | 必填 | 描述 |
|-------|------|------|------|
| `actionId` | `string` | ✅ | 操作 ID |
| `code` | `ActionNoticeEvent.ReplyCode` | ❌ | 响应码，默认为 0 |

**响应码说明**:
```typescript
enum ReplyCode {
    SUCCESS = 0,           // 操作成功
    FAILED = 1,            // 操作失败
    INVALID = 2,           // 无效操作
    FORBIDDEN = 3,         // 操作被禁止
    TIMEOUT = 4            // 操作超时
}
```

```typescript
// 响应成功
await bot.botService.replyAction(action_id, 0)

// 响应失败
await bot.botService.replyAction(action_id, 1)

// 使用枚举
import { ActionNoticeEvent } from 'qq-official-bot'
await bot.botService.replyAction(action_id, ActionNoticeEvent.ReplyCode.SUCCESS)
```

## 🔗 机器人生命周期

### 启动机器人

启动机器人并建立与 QQ 服务器的连接。

**方法名**: `bot.start()`

```typescript
await bot.start()
console.log('机器人启动成功')

// 监听启动事件
bot.on('ready', () => {
    console.log(`机器人 ${bot.nickname} 已上线`)
})
```

`start()` 会等待机器人连接就绪。访问令牌获取失败（例如 `appid` 或 `secret`
无效）时，返回的 Promise 会直接 reject，调用方应捕获错误，避免阻塞自身的
初始化流程：

```typescript
try {
    await bot.start()
} catch (error) {
    console.error('机器人启动失败', error)
}
```

### 停止机器人

停止机器人并断开与 QQ 服务器的连接。

**方法名**: `bot.stop()`

```typescript
await bot.stop()
console.log('机器人已停止')

// 监听停止事件
bot.on('offline', () => {
    console.log('机器人已下线')
})
```

## 🔧 工具方法

### 配置定义

使用类型安全的配置定义。

**方法名**: `defineConfig(config)`

```typescript
import { defineConfig, ReceiverMode } from 'qq-official-bot'

const config = defineConfig({
    appid: 'your_app_id',
    secret: 'your_app_secret',
    mode: ReceiverMode.WEBSOCKET,
    intents: ['GUILD_MESSAGES'],
    sandbox: false,
    logLevel: 'info',
})

const bot = new Bot(config)
```

### 创建机器人实例

快速创建机器人实例的工厂方法。

**方法名**: `createBot(config)`

```typescript
import { createBot, ReceiverMode } from 'qq-official-bot'

const bot = createBot({
    appid: 'your_app_id',
    secret: 'your_app_secret',
    mode: ReceiverMode.WEBSOCKET,
    intents: ['GUILD_MESSAGES'],
})

await bot.start()
```

## 📊 状态信息

### 获取连接状态

获取机器人的当前连接状态。

```typescript
// 获取机器人 ID
console.log('机器人 ID:', bot.self_id)

// 获取机器人昵称
console.log('机器人昵称:', bot.nickname)

// 获取连接状态
console.log('连接状态:', bot.status)

// 检查是否在线
const isOnline = bot.status === 1
```

### 日志管理

机器人内置了完整的日志系统。

```typescript
// 设置日志级别
bot.logger.level = 'debug'

// 输出不同级别的日志
bot.logger.trace('追踪信息')
bot.logger.debug('调试信息')
bot.logger.info('一般信息')
bot.logger.warn('警告信息')
bot.logger.error('错误信息')
```

## ⚠️ 注意事项

1. **异步操作**: 所有 API 方法都是异步的，请使用 `await` 或 `.then()` 处理
2. **错误处理**: 建议使用服务模块的方法，它们提供统一的错误处理
3. **文件限制**: 文件上传有大小限制，请查阅官方文档了解具体限制
4. **生命周期**: 确保在适当的时机调用 `start()` 和 `stop()` 方法
