/**
 * 消息服务类 - 负责所有消息相关的API操作
 */
import { AxiosInstance } from 'axios'
import { Bot } from '@/bot'
import { GuildMessageEvent, PrivateMessageEvent } from '@/events'
import { Sendable, Quotable } from '@/elements'
import { MessageBuilder, BuildResult, ChunkedUploader } from '@/message'
import { Message } from '@/message/parser'
import { MessageAuditEvent } from '@/events'
import { DMS, EmojiType } from '@/types'

export interface SendOptions {
    quote?: boolean;
    timeout?: number;
    retries?: number;
}

export interface SendResult {
    id: string;
    timestamp: number;
    ext_info?: {
        ref_idx?: string;
        [key: string]: unknown;
    };
    [key: string]: any;
}

export class MessageService {

    constructor(private request: AxiosInstance, private appid: string) {
    }

    /**
     * 获取子频道消息
     */
    async getGuildMessage(channelId: string, messageId: string): Promise<GuildMessageEvent> {
        const { data: result } = await this.request.get(`/channels/${channelId}/messages/${messageId}`)
        return result
    }

    /**
     * 发送频道消息
     */
    async sendGuildMessage(channelId: string, message: Sendable, source?: Quotable, options: SendOptions = {}): Promise<SendResult> {
        return await this.sendMessage(`/channels/${channelId}`, message, source, options);
    }

    /**
     * 撤回频道消息
     */
    async recallGuildMessage(channelId: string, messageId: string, hideWarning?: boolean): Promise<boolean> {
        const result = await this.request.delete(`/channels/${channelId}/messages/${messageId}?hidetip=${!!hideWarning}`)
        return result.status === 200
    }

    /**
     * 创建频道私信会话
     */
    async createDirectSession(guildId: string, userId: string): Promise<DMS> {
        const { data: result } = await this.request.post(`/users/@me/dms`, {
            recipient_id: userId,
            source_guild_id: guildId
        })
        return result
    }

    /**
     * 发送频道私信
     */
    async sendDirectMessage(guildId: string, message: Sendable, source?: Quotable, options: SendOptions = {}): Promise<SendResult> {
        return await this.sendMessage(`/dms/${guildId}`, message, source, options);
    }

    /**
     * 获取频道私信消息
     */
    async getDirectMessage(guildId: string, messageId: string): Promise<PrivateMessageEvent> {
        const { data: result } = await this.request.get(`/dms/${guildId}/messages/${messageId}`)
        return result
    }

    /**
     * 撤回频道私信
     */
    async recallDirectMessage(guildId: string, messageId: string, hidetip?: boolean): Promise<boolean> {
        const result = await this.request.delete(`/dms/${guildId}/messages/${messageId}?hidetip=${!!hidetip}`)
        return result.status === 200
    }

    /**
     * 发送私聊消息
     */
    async sendPrivateMessage(userId: string, message: Sendable, source?: Quotable, options: SendOptions = {}): Promise<SendResult> {
        return await this.sendMessage(`/v2/users/${userId}`, message, source, options);
    }

    /**
     * 撤回私聊消息
     */
    async recallPrivateMessage(userId: string, messageId: string): Promise<boolean> {
        const result = await this.request.delete(`/v2/users/${userId}/messages/${messageId}`)
        return result.status === 200
    }

    /**
     * 发送群消息
     */
    async sendGroupMessage(groupId: string, message: Sendable, source?: Quotable, options: SendOptions = {}): Promise<SendResult> {
        return await this.sendMessage(`/v2/groups/${groupId}`, message, source, options);
    }

    /**
     * 撤回群消息
     */
    async recallGroupMessage(groupId: string, messageId: string): Promise<boolean> {
        const result = await this.request.delete(`/v2/groups/${groupId}/messages/${messageId}`)
        return result.status === 200
    }

    /**
     * 核心发送消息方法
     */
    private async sendMessage(endpointPath: string, message: Sendable, source?: Quotable, options: SendOptions = {}): Promise<SendResult> {
        // 构建消息
        const messageBuilder = new MessageBuilder(this.appid, !endpointPath.startsWith('/v2'), source);
        const buildResult = await messageBuilder.build(message);
        
        // 处理文件发送
        if (buildResult.isFile) {
            const uploaded = await this.uploadFile(endpointPath, buildResult);
            buildResult.messagePayload.media = { file_info: uploaded.file_info };
        }

        // 发送普通消息
        return await this.sendRegularMessage(endpointPath, buildResult, options);

    }
    /**
     * 上传文件
     */
    private async uploadFile(endpointPath: string, buildResult: BuildResult): Promise<Message.FileInfo> {
        const { local_path, ...payload } = buildResult.filePayload
        if (local_path) {
            if (!payload.file_type) throw new Error('Missing file_type for chunked upload')
            const uploader = new ChunkedUploader(this.request)
            return uploader.upload(endpointPath, local_path, payload.file_type, {
                fileName: payload.file_name
            })
        }

        const { data: result } = await this.request.post<Message.FileInfo>(
            endpointPath + '/files',
            {
                ...payload,
                srv_send_msg: false
            }
        );
        return result;
    }

    /**
     * 发送普通消息
     */
    private async sendRegularMessage(endpointPath: string, buildResult: BuildResult, options: SendOptions): Promise<SendResult> {
        const { data: result } = await this.request.post<Message.MessageRet | Message.Audit>(
            endpointPath + '/messages',
            buildResult.messagePayload,
            {
                headers: {
                    'Content-Type': buildResult.contentType
                },
                timeout: options.timeout || 10000
            }
        );
        if (this.isAuditResult(result)) {
            // 如果是审核结果，返回审核信息
            return {
                id: result.message_audit.audit_id,
                timestamp: Date.now() / 1000,
                audit_status: 'pending',
                reason: '',
                brief: buildResult.brief,
            };
        }
        return {
            id: result.id,
            timestamp: Date.now() / 1000,
            brief: buildResult.brief,
            ...(result.ext_info && { ext_info: result.ext_info }),
        };
    }

    /**
     * 检查是否为审核结果
     */
    private isAuditResult(result: any): result is Message.Audit {
        return result && typeof result === 'object' && 'message_audit' in result;
    }

    /**
     * 批量发送消息
     */
    async sendBatch(endpointPath: string, messages: Sendable[], options: SendOptions = {}): Promise<SendResult[]> {
        const results = [];

        for (const message of messages) {
            const result = await this.sendMessage(endpointPath, message, undefined, options);
            results.push(result);

            // 添加发送间隔以避免频率限制
            await this.delay(100);
        }

        return results;
    }

    /**
     * 工具方法：延迟
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
