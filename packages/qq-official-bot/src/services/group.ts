/**
 * 群服务类 - 负责群基本信息相关 API
 */
import { AxiosInstance } from 'axios'
import { Group } from '@/entries'

export class GroupService {
    constructor(private request: AxiosInstance) {}

    /**
     * 获取群基本信息
     */
    async getInfo(groupOpenid: string): Promise<Group.ApiInfo> {
        const { data: result } = await this.request.get<Group.ApiInfo>(
            `/v2/groups/${groupOpenid}/info`
        )
        return result
    }

    /**
     * 获取机器人群内状态
     */
    async getBotState(groupOpenid: string): Promise<Group.BotState> {
        const { data: result } = await this.request.get<Group.BotState>(
            `/v2/groups/${groupOpenid}/bot_state`
        )
        return result
    }

    /**
     * 查询群禁言状态
     */
    async getRestrictChatSetting(groupOpenid: string): Promise<Group.RestrictChatSetting> {
        const { data: result } = await this.request.get<Group.RestrictChatSetting>(
            `/v2/groups/${groupOpenid}/restrict_chat_setting`
        )
        return result
    }

    /**
     * 设置群成员禁言，单次最多操作 10 个成员
     */
    async setMemberMuteState(
        groupOpenid: string,
        members: Group.SetMemberMuteState[]
    ): Promise<boolean> {
        const result = await this.request.post(
            `/v2/groups/${groupOpenid}/restrict_chat_setting`,
            { members }
        )
        return result.status >= 200 && result.status < 300
    }
}
