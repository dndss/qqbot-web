/**
 * 日程服务类 - 负责所有日程相关的API操作
 */
import { AxiosInstance } from 'axios'
import { ScheduleInfo, RemindType } from '@/types'

export class ScheduleService {
    constructor(private request: AxiosInstance) {}

    /**
     * 获取频道日程列表
     */
    async getChannelSchedules(channelId: string, since?: number): Promise<ScheduleInfo[]> {
        const { data } = await this.request.get(`/channels/${channelId}/schedules`, {
            params: since ? { since } : {}
        })
        return data
    }

    /**
     * 获取频道日程详情
     */
    async getChannelSchedule(channelId: string, scheduleId: string): Promise<ScheduleInfo> {
        const { data } = await this.request.get(`/channels/${channelId}/schedules/${scheduleId}`)
        return data
    }

    /**
     * 创建频道日程
     */
    async createChannelSchedule(
        channelId: string,
        name: string,
        description: string,
        startTimestamp: number,
        endTimestamp: number,
        jumpChannelId?: string,
        remindType: RemindType = 0
    ): Promise<ScheduleInfo> {
        const { data } = await this.request.post(`/channels/${channelId}/schedules`, {
            schedule: {
                name,
                description,
                start_timestamp: `${startTimestamp}`,
                end_timestamp: `${endTimestamp}`,
                jump_channel_id: jumpChannelId,
                remind_type: `${remindType}`
            }
        })
        return data
    }

    /**
     * 修改频道日程
     */
    async updateChannelSchedule(
        channelId: string,
        scheduleId: string,
        name: string,
        description: string,
        startTimestamp: number,
        endTimestamp: number,
        jumpChannelId?: string,
        remindType: RemindType = 0
    ): Promise<ScheduleInfo> {
        const { data } = await this.request.patch(`/channels/${channelId}/schedules/${scheduleId}`, {
            schedule: {
                name,
                description,
                start_timestamp: `${startTimestamp}`,
                end_timestamp: `${endTimestamp}`,
                jump_channel_id: jumpChannelId,
                remind_type: `${remindType}`
            }
        })
        return data
    }

    /**
     * 删除日程
     */
    async deleteChannelSchedule(channelId: string, scheduleId: string): Promise<any> {
        const { data } = await this.request.delete(`/channels/${channelId}/schedules/${scheduleId}`)
        return data
    }
}
