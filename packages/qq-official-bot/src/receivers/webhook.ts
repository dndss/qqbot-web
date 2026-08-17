import { Server, createServer, IncomingMessage, ServerResponse } from 'http';
import { BaseReceiver, BaseReceiverConfig, ReceiverMode } from "./base";
import { Session } from "@/core/session";
import { OpCode } from "@/constants";
import { DataPacket } from "@/types";
import { Ed25519 } from "@/ed25519";

/**
 * Webhook接收器配置
 */
export class WebhookReceiverConfig extends BaseReceiverConfig {
    public readonly port: number;
    public readonly path: string;
    public readonly timeout: number;

    constructor(options: {
        port: number;
        path: string;
        timeout?: number;
    }) {
        super(ReceiverMode.WEBHOOK);
        this.port = options.port;
        this.path = options.path;
        this.timeout = options.timeout || 30000;
    }

    public validate(): boolean {
        return this.port > 0 && this.port < 65536 &&
               this.path.startsWith('/') &&
               this.timeout > 0;
    }

    public toJson(): Record<string, any> {
        return {
            mode: this.mode,
            port: this.port,
            path: this.path,
            timeout: this.timeout
        };
    }
}

/**
 * Webhook接收器处理器
 */
interface WebhookHandler {
    server: Server;
    ed25519?: Ed25519;
}

/**
 * Webhook接收器实现
 */
export class WebhookReceiver extends BaseReceiver<WebhookHandler> {
    private config: WebhookReceiverConfig;
    private session: Session<ReceiverMode.WEBHOOK> | null = null;

    constructor(config: WebhookReceiverConfig) {
        const server = createServer();
        super({ server });
        this.config = config;
        this.setupWebhookEventHandlers();
        this.setupServerHandlers();
    }

    /**
     * 设置Webhook特定的事件处理器
     */
    private setupWebhookEventHandlers(): void {
        this.on('start', this.handleStart.bind(this));
        this.on('stop', this.handleStop.bind(this));
    }

    /**
     * 设置服务器请求处理器
     */
    private setupServerHandlers(): void {
        this.handler.server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
            await this.handleHttpRequest(req, res);
        });

        this.handler.server.on('error', (error: Error) => {
            this.handleServerError(error);
        });

        this.handler.server.on('listening', () => {
            this.handleServerListening();
        });

        this.handler.server.on('close', () => {
            this.handleServerClose();
        });
    }

    /**
     * 启动Webhook服务器
     */
    public async start(session: Session<ReceiverMode.WEBHOOK>): Promise<void> {
        this.session = session;
        this._isStarted = true;

        // 初始化Ed25519签名验证
        this.handler.ed25519 = new Ed25519(session.getBot().config.secret);

        if (this.handler.server.listening) {
            throw new Error('Webhook receiver has already started');
        }

        return new Promise<void>((resolve, reject) => {
            const onListening = () => {
                this.handler.server.removeListener('error', onError);
                resolve();
            };

            const onError = (error: Error) => {
                this.handler.server.removeListener('listening', onListening);
                reject(error);
            };

            this.handler.server.once('listening', onListening);
            this.handler.server.once('error', onError);

            this.handler.server.listen(this.config.port);
        });
    }

    /**
     * 停止Webhook服务器
     */
    public async stop(session?: Session<ReceiverMode.WEBHOOK>): Promise<void> {
        this._isStarted = false;
        this.handler.ed25519 = undefined;

        if (!this.handler.server.listening) {
            return;
        }

        return new Promise<void>((resolve, reject) => {
            this.handler.server.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * 处理启动事件
     */
    private async handleStart(session: Session<ReceiverMode.WEBHOOK>): Promise<void> {
        await this.start(session);
    }

    /**
     * 处理停止事件
     */
    private async handleStop(): Promise<void> {
        await this.stop();
    }

    /**
     * 处理HTTP请求
     */
    private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        // 检查路径是否匹配
        if (req.url !== this.config.path) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        try {
            await this.handleWebhookRequest(req, res);
        } catch (error) {
            this.handleRequestError(req, res, error as Error);
        }
    }

    /**
     * 处理Webhook请求
     */
    private async handleWebhookRequest(req: IncomingMessage, res: ServerResponse, fallbackData?: any): Promise<void> {
        if (!this.session || !this.handler.ed25519) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server not ready');
            return;
        }

        const bodyData = await this.resolveBodyData(req, JSON.stringify(fallbackData));

        // 验证签名
        const signature = req.headers['x-signature-ed25519']?.toString();
        const timestamp = req.headers['x-signature-timestamp']?.toString();

        if (!signature) {
            this.session.getBot().logger.warn('[WebhookReceiver] 缺少签名头');
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Missing signature');
            return;
        }

        if (!this.handler.ed25519.verify(signature, timestamp + bodyData)) {
            this.session.getBot().logger.warn('[WebhookReceiver] 签名验证失败');
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Invalid signature');
            return;
        }

        // 解析数据包
        let packet: DataPacket;
        try {
            packet = JSON.parse(bodyData);
        } catch (error) {
            this.session.getBot().logger.error('[WebhookReceiver] 数据包解析失败:', error);
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid JSON');
            return;
        }

        // 处理不同类型的操作
        switch (packet.op) {
            case OpCode.SIGN_VERIFY:
                await this.handleSignVerify(packet, res);
                break;
            case OpCode.DISPATCH:
                await this.handleDispatch(packet, res);
                break;
            default:
                this.session.getBot().logger.warn(`[WebhookReceiver] 未知的操作码: ${packet.op}`);
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Unknown operation');
        }
    }

    /**
     * 处理签名验证
     */
    private async handleSignVerify(packet: DataPacket, res: ServerResponse): Promise<void> {
        if (!this.session || !this.handler.ed25519) return;

        const { plain_token, event_ts } = packet.d;
        const signed = this.handler.ed25519.sign(event_ts + plain_token);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            plain_token,
            signature: signed
        }));

        this.session.getBot().logger.debug('[WebhookReceiver] 处理签名验证完成');
    }

    /**
     * 处理事件分发
     */
    private async handleDispatch(packet: DataPacket, res: ServerResponse): Promise<void> {
        if (!this.session) return;

        this.session.getBot().logger.debug('[WebhookReceiver] 收到事件:', packet.t);

        // 发送packet事件
        this.emitPacket(packet);

        // 返回成功响应
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 0, message: 'success' }));
    }

    /**
     * 解析请求体数据
     */
    private async resolveBodyData(req: IncomingMessage, fallbackData?: string): Promise<string> {
        return new Promise<string>((resolve) => {
            if (fallbackData) {
                resolve(fallbackData);
                return;
            }

            const dataArr: Buffer[] = [];
            req.on('data', (data) => {
                dataArr.push(data);
            });

            req.on('end', () => {
                resolve(Buffer.concat(dataArr).toString());
            });
        });
    }

    /**
     * 处理请求错误
     */
    private handleRequestError(req: IncomingMessage, res: ServerResponse, error: Error): void {
        if (this.session) {
            this.session.getBot().logger.error('[WebhookReceiver] 请求处理错误:', error);
        }

        this.emitError(error);

        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        }
    }

    /**
     * 处理服务器错误
     */
    private handleServerError(error: Error): void {
        if (this.session) {
            this.session.getBot().logger.error('[WebhookReceiver] 服务器错误:', error);
        }
        this.emitError(error);
    }

    /**
     * 处理服务器开始监听
     */
    private handleServerListening(): void {
        if (this.session) {
            this.session.getBot().logger.info(`[WebhookReceiver] 服务器开始监听端口: ${this.config.port}`);
        }
        this.emitReady();
    }

    /**
     * 处理服务器关闭
     */
    private handleServerClose(): void {
        if (this.session) {
            this.session.getBot().logger.info('[WebhookReceiver] 服务器已关闭');
        }
        this.emitClose();
    }

    /**
     * 处理数据包（基类抽象方法实现）
     */
    protected handlePacket(packet: DataPacket): void {
        // Webhook接收器的数据包处理在handleWebhookRequest中进行
        // 这里不需要额外处理
    }

    /**
     * 获取接收器类型
     */
    public getType(): string {
        return ReceiverMode.WEBHOOK;
    }

    /**
     * 获取接收器配置
     */
    public getConfig(): Record<string, any> {
        return this.config.toJson();
    }

    /**
     * 健康检查
     */
    public healthCheck(): { status: 'healthy' | 'unhealthy'; details: any } {
        const baseHealth = super.healthCheck();
        return {
            ...baseHealth,
            details: {
                ...baseHealth.details,
                serverListening: this.handler.server.listening,
                port: this.config.port,
                path: this.config.path,
                hasEd25519: !!this.handler.ed25519
            }
        };
    }
}

/**
 * 创建Webhook接收器的工厂函数（向后兼容）
 */
export function createWebhookReceiver(port: number, path: string): WebhookReceiver {
    const config = new WebhookReceiverConfig({ port, path });
    return new WebhookReceiver(config);
}
