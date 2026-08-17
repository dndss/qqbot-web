/**
 * 权限服务类 - 负责所有权限相关的API操作
 */
import { AxiosInstance } from 'axios'
import { 
    ChannelMemberPermissions, 
    ChannelRolePermissions, 
    UpdatePermissionParams,
    Announce
} from '@/types'

export class PermissionService {
    constructor(private request: AxiosInstance) {}

    /**
     * 获取频道角色权限信息
     */
    async getChannelRolePermission(channelId: string, roleId: string): Promise<ChannelRolePermissions> {
        const { data: result } = await this.request.get<ChannelRolePermissions>(
            `/channels/${channelId}/roles/${roleId}/permissions`
        )
        return result
    }

    /**
     * 更新频道角色权限
     */
    async updateChannelRolePermission(
        channelId: string, 
        roleId: string, 
        permission: UpdatePermissionParams
    ): Promise<boolean> {
        const result = await this.request.put(
            `/channels/${channelId}/roles/${roleId}/permissions`, 
            permission
        )
        return result.status === 204
    }

    /**
     * 获取频道用户权限
     */
    async getChannelMemberPermission(channelId: string, memberId: string): Promise<ChannelMemberPermissions> {
        const { data: result } = await this.request.get<ChannelMemberPermissions>(
            `/channels/${channelId}/members/${memberId}/permissions`
        )
        return result
    }

    /**
     * 更新频道用户权限
     */
    async updateChannelMemberPermission(
        channelId: string, 
        memberId: string, 
        permission: UpdatePermissionParams
    ): Promise<boolean> {
        const result = await this.request.put(
            `/channels/${channelId}/members/${memberId}/permissions`, 
            permission
        )
        return result.status === 204
    }

    /**
     * 设置频道公告
     */
    async setChannelAnnounce(guildId: string, channelId: string, messageId: string): Promise<Announce> {
        const { data: result } = await this.request.post<Announce>(
            `/guilds/${guildId}/announces`, 
            {
                channel_id: channelId,
                message_id: messageId
            }
        )
        return result
    }
}
