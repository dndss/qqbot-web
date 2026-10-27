import { createRequire } from 'node:module'
import type { MessagePart } from '../src/types.ts'

const { MessageEvent } = createRequire(import.meta.url)('qq-official-bot')

// Reproduce the received menu's wire format without real member identities or account data.
export function officialMenuEvent() {
  return MessageEvent.parse.call({ removeAt() {}, logger: { info() {} } }, 'message.group', {
    id: 'markdown-menu-event', message_type: 0, group_id: 'fixture',
    timestamp: '2026-10-24T22:09:55+08:00', author: { id: 'test-bot', username: '菜单机器人' },
    mentions: [{ id: 'test-member', username: '测试成员', scope: 'single' }],
    content: [
      '# 🍹伊蕾娜菜单(*´∀`)~♥',
      ' > ℹ️<@test-member>蓝字都是可以点的~',
      '',
      ' ![伊蕾娜 #20px #20px](https://qqbot.ugcimg.cn/102134274/1e5bc453927bc24ca45ac9c050ea7331f8cd0103/f11292df8cd35c3138842d5294d2e1fb) [娱乐菜单](mqqapi://aio/inlinecmd?command=%E5%A8%B1%E4%B9%90%E8%8F%9C%E5%8D%95&enter=false&reply=false) | ![伊蕾娜 #20px #20px](https://qqbot.ugcimg.cn/102134274/bc62e2e39c419b6ec7ee5f59902cdd0ef55cb021/dde2fd12b13610e50c2b6918adf48db5) [小游戏](mqqapi://aio/inlinecmd?command=%E5%B0%8F%E6%B8%B8%E6%88%8F&enter=false&reply=false)',
      '[✍️ 我要留下自己的足迹](mqqapi://aio/inlinecmd?command=%E9%95%8C%E5%88%BB%E4%B9%8B%E5%A2%99&enter=false&reply=false)',
      '[✨免@授权](mqqapi://aio/inlinecmd?command=%E5%85%A8%E9%87%8F%E7%94%B3%E8%AF%B7&enter=false&reply=false) | [👗QQ秀共享](mqqapi://aio/inlinecmd?command=QQ%E7%A7%80&enter=false&reply=false)',
      '***',
      '[🤝友情链接](mqqapi://aio/inlinecmd?command=%E5%8F%8B%E6%83%85%E9%93%BE%E6%8E%A5&enter=false&reply=false) | [💝致谢名单](mqqapi://aio/inlinecmd?command=%E8%87%B4%E8%B0%A2%E5%90%8D%E5%8D%95&enter=false&reply=false)',
      '[📜点击查看实时更新日志](https://docs.qq.com/aio/p/sc0r7otwi70kp02?p=k6nOKARGOK4jD0z5A4LGjo)',
      '>[🔗🍀聊天群](https://qm.qq.com/q/CifrRUWsVO)',
    ].join('\n'),
  })
}

export function officialMenuParts(): MessagePart[] {
  return officialMenuEvent().message.map(({ type, data }) => type === 'at'
    ? { type: 'at', userId: data.user_id, name: data.username }
    : { type: 'text', text: data.text })
}
