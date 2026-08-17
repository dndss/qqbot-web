/**
 * 音频服务类 - 负责所有音频相关的API操作
 */
import { AxiosInstance } from 'axios'
import { AudioControl } from '@/types'

export class AudioService {
    constructor(private request: AxiosInstance) {}

    /**
     * 音频控制
     */
    async controlChannelAudio(channelId: string, audioControl: AudioControl): Promise<boolean> {
        const result = await this.request.post(`/channels/${channelId}/audio`, audioControl)
        return result.status === 200
    }

    /**
     * 上麦
     */
    async setOnlineMic(channelId: string): Promise<boolean> {
        const result = await this.request.put(`/channels/${channelId}/mic`)
        return result.status === 200
    }

    /**
     * 下麦
     */
    async setOfflineMic(channelId: string): Promise<boolean> {
        const result = await this.request.delete(`/channels/${channelId}/mic`)
        return result.status === 204
    }
}
