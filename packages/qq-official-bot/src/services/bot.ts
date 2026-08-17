/**
 * 机器人服务类 - 负责机器人基础信息和操作相关的API
 */
import { AxiosInstance } from 'axios'
import { Bot } from '@/bot'
import { ActionNoticeEvent } from '@/events/notice'

export class BotService {
    constructor(private request: AxiosInstance) {}

    /**
     * 获取机器人信息
     */
    async getSelfInfo(): Promise<Bot.Info> {
        const { data: result } = await this.request.get<Bot.Info>('/users/@me')
        return result
    }

    /**
     * 回应操作
     */
    async replyAction(actionId: string, code: ActionNoticeEvent.ReplyCode = 0): Promise<boolean> {
        const result = await this.request.put(`/interactions/${actionId}`, { code })
        return result.status === 200
    }
}
