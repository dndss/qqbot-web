/**
 * 帖子服务类 - 负责所有帖子相关的API操作
 */
import { AxiosInstance } from 'axios'
import { Thread, ThreadInfo } from '@/types'

export class ThreadService {
    constructor(private request: AxiosInstance) {}

    /**
     * 获取频道帖子列表
     */
    async getChannelThreads(channelId: string): Promise<Thread[]> {
        const { data } = await this.request.get(`/channels/${channelId}/threads`)
        return data
    }

    /**
     * 获取频道帖子详情
     */
    async getChannelThreadInfo(channelId: string, threadId: string): Promise<ThreadInfo> {
        const { data } = await this.request.get(`/channels/${channelId}/threads/${threadId}`)
        return data
    }

    /**
     * 创建频道帖子
     */
    async publishThread(
        channelId: string,
        title: string,
        content: string,
        format: 1 | 2 | 3 | 4 = 3
    ): Promise<ThreadInfo> {
        const { data } = await this.request.post(`/channels/${channelId}/threads`, {
            title,
            content,
            format
        })
        return data
    }

    /**
     * 删除频道帖子
     */
    async deleteThread(channelId: string, threadId: string): Promise<boolean> {
        const result = await this.request.delete(`/channels/${channelId}/threads/${threadId}`)
        return result.status === 204
    }
}
