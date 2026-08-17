/**
 * 表态服务类 - 负责所有表态相关的API操作
 */
import { AxiosInstance } from 'axios'
import { EmojiType } from '@/types'
import { User } from '@/entries/user'

export class ReactionService {
    constructor(private request: AxiosInstance) {}

    /**
     * 对频道消息进行表态
     */
    async addGuildMessageReaction(
        channelId: string, 
        messageId: string, 
        type: EmojiType, 
        id: `${number}`
    ): Promise<boolean> {
        const result = await this.request.put(`/channels/${channelId}/messages/${messageId}/reactions/${type}/${id}`)
        return result.status === 204
    }

    /**
     * 删除频道消息表态
     */
    async deleteGuildMessageReaction(
        channelId: string, 
        messageId: string, 
        type: EmojiType, 
        id: `${number}`
    ): Promise<boolean> {
        const result = await this.request.delete(`/channels/${channelId}/messages/${messageId}/reactions/${type}/${id}`)
        return result.status === 204
    }

    /**
     * 获取表态用户列表
     */
    async getGuildMessageReactionMembers(
        channelId: string, 
        messageId: string, 
        type: EmojiType, 
        id: `${number}`
    ): Promise<User.Info[]> {
        return await this._getGuildMessageReactionMembers(channelId, messageId, type, id)
    }

    /**
     * 私有方法：获取表态用户列表的实现
     */
    private async _getGuildMessageReactionMembers(
        channelId: string, 
        messageId: string, 
        type: EmojiType, 
        id: `${number}`,
        cookies?: string
    ): Promise<User.Info[]> {
        const formatUser = (users: any[]): User.Info[] => {
            return users.map(({ id, username, avatar, bot, public_flag }) => ({
                id,
                username,
                avatar,
                bot,
                public_flag
            }))
        }

        const {
            data: {
                users,
                cookie,
                is_end
            }
        } = await this.request.get(`/channels/${channelId}/messages/${messageId}/reactions/${type}/${id}`, {
            params: {
                cookie: cookies
            }
        })

        if (is_end) return formatUser(users)
        return [...formatUser(users), ...await this._getGuildMessageReactionMembers(channelId, messageId, type, id, cookie)]
    }
}
