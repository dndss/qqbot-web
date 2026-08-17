# 群聊 API

群聊消息相关的 API 操作，包括群消息发送、消息管理、群成员操作等功能。

::: tip 权限要求
需要机器人拥有群聊权限和相应的 Intent 配置
:::

## 📱 群消息管理

### 获取群基本信息

通过群 OpenID 获取群名称、简介、分类、标签及成员人数。

**方法名**: `bot.groupService.getInfo(groupOpenid)` / `bot.getGroupInfo(groupOpenid)`

```typescript
const info = await bot.getGroupInfo(group_openid)
console.log(info.group_name, info.group_member_num)
```

返回值保留 QQ OpenAPI 的原始字段：`group_openid`、`group_name`、
`group_finger_memo`、`group_class_text`、`group_tags` 和 `group_member_num`。

### 获取机器人群内状态

获取机器人在指定群中的 OpenID、入群时间、主动消息开关、接收消息设置和群成员角色。

**方法名**: `bot.groupService.getBotState(groupOpenid)` / `bot.getGroupBotState(groupOpenid)`

```typescript
const state = await bot.getGroupBotState(group_openid)
console.log(state.member_openid)
console.log(state.joined_at)
console.log(state.allow_proactive_msg)
console.log(state.recv_msg_setting)
console.log(state.member_role) // member、admin 或 owner
```

返回值完整保留 QQ OpenAPI 字段：`member_openid`、`joined_at`、
`allow_proactive_msg`、`recv_msg_setting` 和 `member_role`。

### 发送群消息

向指定群聊发送消息。

**方法名**: `bot.messageService.sendGroupMessage(groupId, message, source?)` / `bot.sendGroupMessage(groupId, message, source?)`

**参数**:
| 参数名 | 类型 | 必填 | 描述 |
|-------|------|------|------|
| `groupId` | `string` | ✅ | 群 ID |
| `message` | `Sendable` | ✅ | 消息内容 |
| `source` | `Quotable` | ❌ | 引用消息 |

```typescript
// 使用服务模块（推荐）
const result = await bot.messageService.sendGroupMessage(group_id, 'Hello Group!')
console.log('群消息发送成功:', result.id)
console.log('可用于关联后续引用事件的索引:', result.ext_info?.ref_idx)

// 使用传统方法（向后兼容）
await bot.sendGroupMessage(group_id, 'Hello, World!')

// 发送富媒体消息
import { segment } from 'qq-official-bot'
await bot.messageService.sendGroupMessage(group_id, [
    segment.text('大家看看这张图片:'),
    segment.image('https://example.com/image.jpg')
])

// 回复群消息
await bot.messageService.sendGroupMessage(group_id, '这是回复', {
    message_id: original_message_id
})

// @群成员
await bot.messageService.sendGroupMessage(group_id, [
    segment.at(user_id),
    segment.text(' 你好!')
])
```

成功响应中的 `ext_info.ref_idx` 会原样保留。后续群消息事件引用这条 Bot
消息时，`message_scene.ext` 中的 `ref_msg_idx` 与该值对应。

### 撤回群消息

撤回指定的群消息。

**方法名**: `bot.messageService.recallGroupMessage(groupId, messageId)` / `bot.recallGroupMessage(groupId, messageId)`

**参数**:
| 参数名 | 类型 | 必填 | 描述 |
|-------|------|------|------|
| `groupId` | `string` | ✅ | 群 ID |
| `messageId` | `string` | ✅ | 消息 ID |

```typescript
// 使用服务模块（推荐）
const result = await bot.messageService.recallGroupMessage(group_id, message_id)
if (result.success) {
    console.log('群消息撤回成功')
}

// 使用传统方法（向后兼容）
const success = await bot.recallGroupMessage(group_id, message_id)
```

## 👥 群成员管理

### 查询群禁言状态

查询群聊的全员禁言规则和当前处于禁言状态的成员。

**方法名**: `bot.groupService.getRestrictChatSetting(groupOpenid)` / `bot.getGroupRestrictChatSetting(groupOpenid)`

```typescript
const setting = await bot.getGroupRestrictChatSetting(group_openid)
console.log(setting.global_rule.mode, setting.members)
```

### 设置群成员禁言

机器人需要拥有群管理员身份，单次最多操作 10 个成员。`mute_expire_at`
使用 RFC3339 格式；解除禁言时可传空字符串。

**方法名**: `bot.groupService.setMemberMuteState(groupOpenid, members)` / `bot.setGroupMemberMuteState(groupOpenid, members)`

```typescript
// 禁言或更新禁言到期时间
await bot.setGroupMemberMuteState(group_openid, [{
    op: 'add', // 已处于禁言状态时使用 update
    member_openid,
    mute_expire_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
}])

// 解除禁言
await bot.setGroupMemberMuteState(group_openid, [{
    op: 'del',
    member_openid,
    mute_expire_at: ''
}])
```

### 获取群成员列表

获取指定群的成员列表。

**方法名**: `bot.getGroupMemberList(groupId)`

**参数**:
| 参数名 | 类型 | 必填 | 描述 |
|-------|------|------|------|
| `groupId` | `string` | ✅ | 群 ID |

```typescript
// 注意：此方法在当前实现中可能不支持，请查看具体错误信息
try {
    const members = await bot.getGroupMemberList(group_id)
    console.log('群成员列表:', members)
} catch (error) {
    console.log('获取群成员列表失败:', error.message)
}
```

## 🎯 群消息类型

### 文本消息

```typescript
// 纯文本
await bot.messageService.sendGroupMessage(group_id, 'Hello Group!')

// 带格式文本
await bot.messageService.sendGroupMessage(group_id, '**重要通知** 群聊规则更新')

// @成员消息
import { segment } from 'qq-official-bot'
await bot.messageService.sendGroupMessage(group_id, [
    segment.at(user_id),
    segment.text(' 请注意查看群公告')
])

// @全体成员
await bot.messageService.sendGroupMessage(group_id, [
    segment.at('all'),
    segment.text(' 大家好!')
])
```

### 富媒体消息

```typescript
import { segment } from 'qq-official-bot'

// 图片消息
await bot.messageService.sendGroupMessage(group_id, 
    segment.image('https://example.com/image.jpg')
)

// 语音消息
await bot.messageService.sendGroupMessage(group_id,
    segment.record('https://example.com/audio.mp3')
)

// 视频消息
await bot.messageService.sendGroupMessage(group_id,
    segment.video('https://example.com/video.mp4')
)

// 混合消息
await bot.messageService.sendGroupMessage(group_id, [
    segment.text('群活动通知:'),
    segment.image('https://example.com/activity.jpg'),
    segment.text('\n参与方式请查看图片说明')
])
```

### 卡片消息

```typescript
// Ark 消息（JSON 卡片）
await bot.messageService.sendGroupMessage(group_id, {
    ark: {
        template_id: 23,
        kv: [
            { key: 'title', value: '群活动' },
            { key: 'desc', value: '本周群活动安排' },
            { key: 'img', value: 'https://example.com/activity.jpg' }
        ]
    }
})

// Embed 消息
await bot.messageService.sendGroupMessage(group_id, {
    embed: {
        title: '群公告',
        description: '群聊规则更新通知',
        color: 0x00FF00,
        fields: [
            { name: '更新内容', value: '新增发言规则' },
            { name: '生效时间', value: '即日起' }
        ]
    }
})
```

## 🔗 事件处理

### 监听群消息事件

```typescript
// 监听群消息
bot.on('message.group', async (event) => {
    console.log('收到群消息:', event.raw_message)
    console.log('群 ID:', event.group_id)
    console.log('发送者:', event.sender.user_name)
    
    // 自动回复
    await event.reply('收到群消息了!')
})

// 监听群消息中的@机器人
bot.on('message.group', async (event) => {
    if (event.raw_message.includes(`@${bot.self_id}`)) {
        await event.reply('有人@我了!')
    }
})
```

### 监听群成员变更事件

当群内有成员加入或退出时，会触发 `notice.group.member` 事件（对应官方 `GROUP_MEMBER_ADD` / `GROUP_MEMBER_REMOVE`）。需在 `intents` 中订阅 `GROUP_MEMBER`（`1 << 24`）。

```typescript
const bot = new Bot({
    intents: ['GROUP_AND_C2C_EVENT', 'GROUP_MEMBER'],
    // ...
})
```

```typescript
// 成员加入 / 退出（汇总）
bot.on('notice.group.member', (event) => {
    console.log(`群 ${event.group_id} 成员 ${event.user_id} ${event.actionText}`)
})

// 仅成员加入
bot.on('notice.group.member.increase', (event) => {
    console.log(`新成员 ${event.user_id} 加入群 ${event.group_id}`)
})

// 仅成员退出
bot.on('notice.group.member.decrease', (event) => {
    console.log(`成员 ${event.user_id} 退出群 ${event.group_id}`)
})
```

> 注意：`notice.group.increase` / `notice.group.decrease` 表示**机器人被加入/移出群聊**（`GROUP_ADD_ROBOT` / `GROUP_DEL_ROBOT`），与群成员进退事件不同。

### 群消息过滤

```typescript
// 只处理特定群的消息
bot.on('message.group', async (event) => {
    if (event.group_id === target_group_id) {
        await event.reply('这是来自指定群的消息')
    }
})

// 过滤机器人消息
bot.on('message.group', async (event) => {
    if (event.sender.user_id === bot.self_id) return // 忽略自己的消息
    
    await event.reply('只回复其他成员的消息')
})

// 管理员命令处理
bot.on('message.group', async (event) => {
    if (event.sender.permissions.includes('admin') && event.raw_message.startsWith('/')) {
        // 处理管理员命令
        const command = event.raw_message.slice(1)
        await handleAdminCommand(event, command)
    }
})
```

## 📊 TypeScript 接口

```typescript
// 群消息事件接口
interface GroupMessageEvent extends Message {
    message_type: 'group'
    group_id: string
    group_name?: string
    sender: {
        user_id: string
        user_name: string
        permissions: string[]
    }
    
    // 方法
    reply(message: Sendable): Promise<any>
}

// 群成员信息接口
interface GroupMember {
    user_id: string
    user_name: string
    nickname?: string
    role: 'owner' | 'admin' | 'member'
    join_time?: number
    last_sent_time?: number
}

// 服务方法返回类型
interface ApiResponse<T> {
    success: boolean
    data?: T
    error?: {
        code: number
        message: string
    }
}
```

## ⚠️ 注意事项

1. **权限要求**: 发送群消息需要相应的 Intent 权限配置
2. **频率限制**: 群消息有发送频率限制，请合理控制发送速度
3. **@功能**: 使用@功能时需要确保机器人有@权限
4. **消息类型**: 不同群可能对消息类型有不同限制
5. **群管理**: 群成员操作可能需要管理员权限
6. **机器人限制**: 某些群可能禁止机器人发言或限制功能
7. **API 支持**: 部分群管理 API 可能在某些版本中不支持

## 📚 相关链接

- [QQ 机器人群聊 API 文档](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/group/)
- [消息格式参考](../interface/index.md#消息类型)
- [权限配置指南](../config.md#intent-配置)
