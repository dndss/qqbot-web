# 用户资料与成员移除

## 群消息名称

新收到的群消息优先使用 SDK 的 `sender.member_nickname`，缺失时依次使用
`sender.user_name`、原有用户 ID 占位名称。私聊继续使用私聊事件提供的昵称。
名称随消息快照保存，消息、引用和头像菜单共用该名称，不回写旧消息。

## 私聊用户资料

在私聊会话详情点击“获取资料”或“刷新资料”，调用 SDK 的 `bot.getUserInfo()`。
用户必须与机器人存在好友关系；官方返回 `40184001` 时显示原因并保留已有资料。
群内身份和群名片不使用该接口查询。

保存昵称、头像、主动消息开关及本次查询时间到当前账号的会话记录。
不保存 `union_openid`，不新增独立数据库或执行历史数据迁移。
资料昵称和头像用于会话列表及详情；消息发送者仍保留消息发生时的快照。
后续消息不能覆盖已获取的资料。无自动刷新或定时失效，仅在用户点击时请求。

接口为 `POST /api/conversations/{conversationId}/user-profile`，JSON 请求体：

```json
{ "accountId": "当前 Bot 账号 ID" }
```

成功返回更新后的会话对象，新增可选字段 `userProfile`：

```json
{
  "username": "用户昵称",
  "avatar": "https://example.com/avatar.png",
  "allowProactiveMsg": false,
  "updatedAt": 1794844800000
}
```

`updatedAt` 为 Unix 毫秒。相同账号、连接和会话的并发查询合并；同一 Bot
实例两次实际查询至少间隔 100 毫秒，对应 SDK 文档的 10 QPS 限制。
查询期间切换账号或连接后，旧响应不能写入资料或推送到当前界面。

## 移出群聊

群成员头像右键菜单和消息“…”菜单提供“移出群聊…”。确认框显示群名、成员名称
和成员 OpenID，取消不会请求接口。此版本提供单人操作，不提供批量选择或拉黑。
移除成功不删除会话、消息，不推算群人数；群资料可通过已有刷新入口重新查询。

菜单与服务端均排除已知群主、管理员和机器人自身。成员身份来自已保存消息，
可能已经过时，最终能否移除由 QQ 官方接口决定。SDK 文档要求群主和机器人
管理端均开启“移除群成员”开关；`40103012`、`40103011` 分别显示相应原因。
Web 不会自动重试移除请求。网络失败时应先核实群内状态，再决定是否手动重试。

接口为 `POST /api/conversations/{conversationId}/members/{messageId}/remove`：

```json
{ "accountId": "当前 Bot 账号 ID", "confirmed": true }
```

`messageId` 是当前群会话已保存的收到的消息 ID，成员 OpenID 由服务端从消息中
读取，客户端不能直接提交其他成员列表。服务端调用
`bot.batchRemoveGroupMembers(groupOpenid, [memberOpenid])`，仅在响应的
`remove_members_result` 为 `success` 时返回 `{ "ok": true }`。
同一成员请求进行时禁止重复操作，同一 Bot 实例的实际移除请求至少间隔 2 秒，
对应 SDK 文档的 30 QPM 限制；若平台仍返回限流错误，交由用户稍后重试。
账号或连接变化后不显示旧操作成功；已发出的官方操作无法由切换账号撤销。

## 本地依赖与验证

接口依赖 SDK 的 `e992a8a`（群名片）及 `503cc89`（用户资料、移除成员）构建产物。
拉取 Web 仓库只会更新 `packages/qq-official-bot/lib`；需刷新 `node_modules`
实际安装的本地依赖并重启工作台。可用以下命令检查运行时接口：

```powershell
node --input-type=module -e 'import {Bot} from "qq-official-bot"; console.log(typeof Bot.prototype.getUserInfo, typeof Bot.prototype.batchRemoveGroupMembers)'
```

预期输出 `function function`。SDK 的唯一源码入口仍为外层 `sdk/qq-official-bot`，
Web 只使用构建产物，不在 Web 中重写或修改 SDK。

运行 `pnpm test` 验证服务端逻辑、持久化、HTTP 路由及已有功能。
浏览器回归为 `node tests/member-management.browser.mjs`，需可用的 Playwright；
可通过 `PLAYWRIGHT_MODULE` 指定模块入口，无需添加项目依赖。
测试使用临时账号和 fake Bot，不连接 QQ，不执行真实群成员移除，截图保存在
`data/test-results/members/`。
