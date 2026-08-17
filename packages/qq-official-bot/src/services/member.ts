/**
 * 成员服务类 - 负责所有成员相关的API操作
 */
import { AxiosInstance } from 'axios'
import { GuildMember } from '@/entries/guildMember'

export class MemberService {
    constructor(private request: AxiosInstance) {}

    /**
     * 获取频道成员列表
     */
    async getGuildMemberList(guildId: string): Promise<GuildMember.ApiInfo[]> {
        return await this._getGuildMemberList(guildId)
    }

    /**
     * 获取频道成员信息
     */
    async getGuildMemberInfo(guildId: string, memberId: string): Promise<GuildMember.ApiInfo> {
        const { data: { user: { id: member_id, ...member }, roles, joined_at, nick } } =
            await this.request.get(`/guilds/${guildId}/members/${memberId}`)

        return {
            member_id,
            card: nick,
            roles,
            ...member,
            join_time: new Date(joined_at).getTime() / 1000,
        }
    }

    /**
     * 批量禁言频道成员
     */
    async muteMembers(
        guildId: string, 
        memberIds: string[], 
        seconds: number, 
        endTime?: number
    ): Promise<boolean> {
        const result = await this.request.put(`/guilds/${guildId}/mute`, {
            mute_seconds: `${seconds}`,
            mute_end_timestamp: `${endTime}`,
            user_ids: memberIds
        })
        return result.status === 200
    }

    /**
     * 批量取消频道成员禁言
     */
    async unmuteMembers(guildId: string, memberIds: string[]): Promise<boolean> {
        return await this.muteMembers(guildId, memberIds, 0, 0)
    }

    /**
     * 添加频道成员角色
     */
    async addMemberRole(
        guildId: string, 
        channelId: string, 
        memberId: string, 
        roleId: string
    ): Promise<boolean> {
        const result = await this.request.put(
            `/guilds/${guildId}/members/${memberId}/roles/${roleId}`, 
            { id: channelId }
        )
        return result.status === 204
    }

    /**
     * 移除频道成员角色
     */
    async removeMemberRole(
        guildId: string, 
        channelId: string, 
        memberId: string, 
        roleId: string
    ): Promise<boolean> {
        const result = await this.request.delete(
            `/guilds/${guildId}/members/${memberId}/roles/${roleId}`, 
            { data: { id: channelId } }
        )
        return result.status === 204
    }

    /**
     * 踢出频道成员
     */
    async kickMember(
        guildId: string, 
        memberId: string, 
        clean: -1 | 0 | 3 | 7 | 15 | 30 = 0, 
        blacklist?: boolean
    ): Promise<boolean> {
        const result = await this.request.delete(`/guilds/${guildId}/members/${memberId}`, {
            data: {
                add_blacklist: blacklist,
                delete_message_days: clean
            }
        })
        return result.status === 204
    }

    /**
     * 私有方法：获取频道成员列表的实现
     */
    private async _getGuildMemberList(guildId: string, after?: string): Promise<GuildMember.ApiInfo[]> {
        const res = await this.request.get(`/guilds/${guildId}/members`, {
            params: {
                after,
                limit: 100
            }
        }).catch(() => ({ data: [] })) // 公域没有权限，做个兼容

        if (!res.data?.length) return []

        const result = (res.data || []).map(m => {
            const { user: { id: member_id, ...member }, roles, joined_at, nick } = m
            return {
                member_id,
                card: nick,
                roles,
                ...member,
                join_time: new Date(joined_at).getTime() / 1000,
            }
        })

        const last = result[result.length - 1]
        if (result.length < 100) return result
        return [...result, ...await this._getGuildMemberList(guildId, last.member_id)]
    }
}
