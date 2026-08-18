# QQ Bot 消息工作台

基于仓库内置 `qq-official-bot` SDK 的轻量 Web 消息工作台。它使用 QQ 官方机器人协议，不登录个人 QQ。

## 功能

- WebSocket 连接 QQ 官方网关
- 接收群聊和 C2C 私聊消息
- 类 QQ 的会话列表与聊天界面
- 向已有会话发送 Raw Markdown 消息
- 右键消息可撤回 Bot 消息、引用回复或不引用回复；被动回复使用顺序 `msg_seq`
- 右键群成员头像可将 @ 填入输入框，发送时转换为 `<qqbot-at-user id="openid" />`
- 右键群成员头像可按预设或自定义时长禁言，也可解除禁言
- 结构化渲染文本、图片、QQ 表情说明、@、回复及媒体文件链接
- 将普通图片和图片形式的表情包缓存到每个 Bot 的本地媒体目录，官方链接失效后仍可查看
- 首次收到群消息时通过 `/v2/groups/{group_openid}/info` 获取并缓存群名称、人数、简介、分类和标签
- 首次收到群消息时缓存机器人群内身份、入群时间、主动消息权限和接收设置，并可在群详情手动刷新
- 消息发送者名字旁显示 `BOT`、`管理员`、`群主`徽标；用户角色从新收到的 SDK 事件权限中保存
- 保存多个 Bot 账号并在 Web 中切换；同一时间只连接一个 Bot，每个账号使用独立聊天记录文件
- 使用 `thirdqq.qlogo.cn/qqapp/{appid}/{openid}/100` 显示 C2C 联系人和群消息发送者头像
- 使用 SSE 将新消息实时推送到浏览器
- 本地持久化最近 20,000 条消息
- Secret 仅保存在服务端，配置读取接口不会返回 Secret

## 环境要求

- Node.js 22.18 或更高版本（使用 Node 原生 TypeScript 类型擦除）
- 可访问 QQ 官方机器人 API 和网关
- 已在 QQ 开放平台创建机器人并取得 AppID、App Secret 和所需事件权限

## 启动

```powershell
pnpm install
pnpm start
```

浏览器打开 <http://127.0.0.1:3210>，在设置中填写 AppID 和 App Secret，然后连接。

开发模式：

```powershell
pnpm dev
```

## 内置 SDK

SDK 源码位于 `packages/qq-official-bot`，Web 项目通过本地文件依赖直接使用其编译产物。SDK 的上游仓库及同步说明见该目录下的 `README.md`。

监听地址在 `server.config.json` 中配置：

```json
{
  "host": "127.0.0.1",
  "port": 3210
}
```

修改配置后运行 `pnpm start` 即可生效。也可以临时使用环境变量覆盖配置文件：

```powershell
$env:WEB_QQ_HOST = '127.0.0.1'
$env:WEB_QQ_PORT = '3210'
pnpm start
```

## 数据与安全

- 多账号配置保存在 `data/accounts.json`，每个账号的消息保存在 `data/bots/{accountId}/messages.json`。
- 图片缓存保存在 `data/bots/{accountId}/media/`，支持 JPEG、PNG、GIF 和 WebP；单文件最大 10 MB，每个 Bot 最大 1 GB，超限后自动删除最旧的缓存。
- 图片缓存下载超时为 15 秒；缓存失败时 Web 端会回退到 QQ 官方远程地址。视频、音频和普通文件只显示链接，不保存到本地。
- QQ 系统表情事件只包含表情 ID 和说明文字，因此显示文字说明；图片形式的表情包按普通图片缓存。
- 首次升级会把旧的 `data/config.json` 和 `data/messages.json` 复制到新结构，旧文件保留不删除。
- 从账号列表删除 Bot 时只移除配置入口，不删除对应的聊天记录文件。
- `data/` 已被 `.gitignore` 排除。
- 默认只监听 `127.0.0.1`。若改为局域网或公网地址，请先增加登录认证和 HTTPS，当前版本不应直接暴露到公网。
- 官方协议不会提供个人 QQ 的好友列表或既往聊天历史。会话只会在机器人收到消息后建立。
- 当前仅订阅 `GROUP_AND_C2C_EVENT`，不申请频道、子频道或频道私信权限。
- 主动消息、频率和消息类型由 QQ 官方机器人权限与平台规则决定。
- Bot 可撤回自己发送的消息；在群内拥有群主或管理员身份时，也可撤回普通群成员消息。群成员消息使用事件 `d.id` 调用撤回接口，不能撤回群主或管理员消息。
- 群成员禁言需要机器人拥有群管理员权限。
