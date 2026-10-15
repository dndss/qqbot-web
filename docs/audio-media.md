# 音频下载与播放接口

## 数据流与来源

SDK 在 `sdk/qq-official-bot` 中将官方附件 `content_type: "voice"` 或 `audio/*`
解析为 `audio`。`url` 和 `name` 指向原始文件；可选 `voice_wav_url` 指向官方提供的
WAV 副本。修改 SDK 后先运行 `pnpm run build`，再将生成的 `lib/` 更新到 Web
内置依赖及已安装依赖。Web 不实现 SDK 解析，也不手改 SDK 构建产物。

Web 将 `voice_wav_url` 保存为可选 `wavUrl`，与原始 `url` 分开保留。
合并消息内的音频在 SDK 提供该字段时采用同样结构。没有 WAV 地址时不推测地址，
没有旧快照时不回填历史记录。下载 WAV 时以原文件名的主名加 `.wav` 命名，
同时检查返回内容的 RIFF/WAVE 标识，不将 AMR 仅改后缀作为 WAV。

## 已实现：下载

`GET /api/conversations/{conversationId}/messages/{messageId}/audios/{index}/download`

查询参数：

| 参数 | 必填 | 含义 |
| --- | --- | --- |
| `accountId` | 是 | 必须等于当前激活的 Bot 账号，防止切换账号后下载错误附件 |
| `format` | 否 | `original`（默认）或 `wav`，明确选择原始文件或官方 WAV 副本 |

`index` 是当前消息中音频附件的零起始索引，与前端渲染顺序一致。
计数包含缺失 URL 的音频，按合并消息节点的附件、子节点顺序遍历；
音频和视频分别计数，不受另一类型的附件数量影响。响应使用
`Content-Disposition: attachment`、UTF-8 文件名、对应 MIME 和 `Cache-Control: no-store`。

视频仍使用既有 `/videos/{index}/download` 接口，两者调用同一媒体下载模块。
媒体来源只允许保存消息中的公网 HTTPS 地址；重定向逐跳验证、固定已验证 DNS 地址，
连接与无数据超时为 30 秒，单文件最多 200 MB，浏览器取消时关闭上游，不保存完整文件。

| 状态码 | 场景 |
| --- | --- |
| `400` | 非法音频格式参数或不安全的媒体来源地址 |
| `404` | 消息不存在、已撤回、附件缺失或指定的原文件/WAV 地址不存在 |
| `409` | 当前激活账号与请求账号不一致 |
| `413` | 超过文件大小限制 |
| `416` | 播放字节区间超出文件长度，返回 `Content-Range: bytes */{总长度}` |
| `422` | 无法确定下载文件的格式及后缀 |
| `502` | 上游失效、空文件、非媒体内容或 WAV 副本内容不符合格式 |

## 已实现：在线播放

播放接口：

`GET /api/conversations/{conversationId}/messages/{messageId}/audios/{index}/stream?accountId={accountId}&format=wav`

`format` 默认为 `wav`，此接口只接受官方 WAV 副本。播放器沿用同一附件索引、
账号校验、撤回检查、来源选择和错误响应规则。没有 WAV 副本时显示“暂无可播放版本”，并保留原始文件下载入口。
不自动将 AMR 交给播放器，也不增加本地转码依赖。

代码通过 `selectAudioSource(audio, format)`，以及
`streamMedia(..., { kind: 'audio', format: 'wav', mode: 'inline' })` 的响应模式。
`/stream` 与 `/download` 复用同一安全校验、来源选择和取消清理，将响应设为
`Content-Disposition: inline` 和 `Content-Type: audio/wav`，无需更改消息存储结构。

前端使用浏览器原生音频控件，`preload="none"`，不自动播放。可播放、暂停、拖动进度；
“停止”会重置进度并取消正在进行的媒体请求。开始播放另一条语音时停止上一条。
新消息和列表刷新复用原音频元素，保留当前播放进度；切换会话、账号、离开页面或
收到消息撤回更新时清理对应音频元素并取消请求。播放失败时显示重试入口，下载仍可使用。

### 进度区间

播放支持一个 `Range: bytes=...` 区间，包括闭区间、开放末尾和后缀区间；
拒绝多区间、非法数字、反向区间和其他单位（`400`）。满足区间时响应 `206`，
返回准确的 `Content-Range` 与 `Content-Length`；超出文件长度时响应 `416`。
区间语义依据 [RFC 9110 第 14 节](https://www.rfc-editor.org/rfc/rfc9110.html#section-14)。

区间播放先通过不超过 64 字节的头部区间请求验证 RIFF/WAVE 标识，再转发客户端
请求的区间；头部请求和数据请求分别进行公网来源校验。上游忽略 Range 但提供
总长度时，服务端按流跳过并裁剪所需字节，提前关闭剩余上游流，不缓存完整文件。
上游既不支持 Range 又不提供总长度时，安全回退为完整 `200` 响应和
`Accept-Ranges: none`；这种来源的拖动进度能力取决于浏览器已经加载的数据。

### 验证

`pnpm test` 覆盖完整播放、闭区间、开放区间、后缀区间、越界、非法和多区间、
上游忽略区间或未知长度、无效 WAV、账号及撤回校验，以及取消时关闭上游流。
浏览器回归覆盖实际 WAV 解码、进度跳转、单条播放、列表刷新、会话与账号切换、
消息撤回、失败重试、桌面/手机/触屏，并保留音视频下载、引用和复制回归。
