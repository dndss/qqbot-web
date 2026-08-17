import { IncomingMessage, ServerResponse } from 'http';
import { BaseReceiver, BaseReceiverConfig, ReceiverMode } from "./base";
import { Session } from "@/core/session";
import { OpCode } from "@/constants";
import { DataPacket } from "@/types";
import { Ed25519 } from "@/ed25519";

/**
 * 应用平台类型
 */
export type ApplicationPlatform = 'koa' | 'express';

/**
 * Koa上下文类型
 */
export type KoaContext = {
    request: Record<string, any>;
    response: Record<string, any>;
    req: IncomingMessage;
    res: ServerResponse;
};

/**
 * 中间件类型定义
 */
export type Middleware<T extends ApplicationPlatform> = T extends 'koa'
    ? KoaMiddleware
    : ExpressMiddleware;

export type KoaMiddleware = (ctx: KoaContext, next?: () => Promise<any>) => Promise<any>;
export type ExpressMiddleware = (req: IncomingMessage, res: ServerResponse) => Promise<any>;

/**
 * Middleware接收器配置
 */
export class MiddlewareReceiverConfig extends BaseReceiverConfig {
    public readonly platform: ApplicationPlatform;
    public readonly timeout: number;

    constructor(options: {
        platform: ApplicationPlatform;
        timeout?: number;
    }) {
        super(ReceiverMode.MIDDLEWARE);
        this.platform = options.platform;
        this.timeout = options.timeout || 30000;
    }

    public validate(): boolean {
        return ['koa', 'express'].includes(this.platform) && this.timeout > 0;
    }

    public toJson(): Record<string, any> {
        return {
            mode: this.mode,
            platform: this.platform,
            timeout: this.timeout
        };
    }
}

/**
 * Middleware接收器处理器
 */
interface MiddlewareHandler<T extends ApplicationPlatform> {
    middleware: () => Middleware<T>;
    ed25519?: Ed25519;
}

/**
 * Middleware接收器实现
 */
export class MiddlewareReceiver<T extends ApplicationPlatform> extends BaseReceiver<MiddlewareHandler<T>> {
    private config: MiddlewareReceiverConfig;
    private session: Session<ReceiverMode.MIDDLEWARE> | null = null;

    constructor(config: MiddlewareReceiverConfig) {
        const middleware = MiddlewareReceiver.createMiddleware<T>(config.platform);
        super({
            middleware: () => middleware
        });
        this.config = config;
        this.setupMiddlewareEventHandlers();
    }

    /**
     * 创建对应平台的中间件
     */
    private static createMiddleware<T extends ApplicationPlatform>(platform: ApplicationPlatform): Middleware<T> {
        switch (platform) {
            case 'koa':
                return (async function (this: MiddlewareReceiver<T>, ctx: KoaContext, next?: () => Promise<any>) {
                    if (next) await next();
                    return this.handleWebhookRequest(
                        ctx.req,
                        ctx.res,
                        this.handler.ed25519,
                        ctx.request.body
                    );
                }) as Middleware<T>;

            case 'express':
                return (async function (this: MiddlewareReceiver<T>, req: IncomingMessage, res: ServerResponse) {
                    return this.handleWebhookRequest(
                        req,
                        res,
                        this.handler.ed25519
                    );
                }) as Middleware<T>;

            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    /**
     * 设置Middleware特定的事件处理器
     */
    private setupMiddlewareEventHandlers(): void {
        this.on('start', this.handleStart.bind(this));
        this.on('stop', this.handleStop.bind(this));
    }

    /**
     * 启动Middleware接收器
     */
    public async start(session: Session<ReceiverMode.MIDDLEWARE>): Promise<void> {
        this.session = session;
        this._isStarted = true;

        // 初始化Ed25519签名验证
        this.handler.ed25519 = new Ed25519(session.getBot().config.secret);

        // 绑定中间件的this上下文
        const originalMiddleware = this.handler.middleware;
        this.handler.middleware = () => {
            const middleware = originalMiddleware();
            return middleware.bind(this) as Middleware<T>;
        };

        this.emitReady();
    }

    /**
     * 停止Middleware接收器
     */
    public async stop(session?: Session<ReceiverMode.MIDDLEWARE>): Promise<void> {
        this._isStarted = false;
        this.handler.ed25519 = undefined;
        this.emitClose();
    }

    /**
     * 处理启动事件
     */
    private async handleStart(session: Session<ReceiverMode.MIDDLEWARE>): Promise<void> {
        await this.start(session);
    }

    /**
     * 处理停止事件
     */
    private async handleStop(): Promise<void> {
        await this.stop();
    }

    /**
     * 获取中间件函数
     */
    public getMiddleware(): Middleware<T> {
        return this.handler.middleware();
    }

    /**
     * 处理Webhook请求
     */
    private async handleWebhookRequest(
        req: IncomingMessage,
        res: ServerResponse,
        ed25519?: Ed25519,
        fallbackData?: any
    ): Promise<void> {
        if (!this.session || !ed25519) {
            this.handleError(res, 'Server not ready', 500);
            return;
        }

        try {
            const bodyData = await this.resolveBodyData(req, JSON.stringify(fallbackData));

            // 验证签名
            const signature = req.headers['x-signature-ed25519']?.toString();
            const timestamp = req.headers['x-signature-timestamp']?.toString();

            if (!signature) {
                this.session.getBot().logger.warn('[MiddlewareReceiver] 缺少签名头');
                this.handleError(res, 'Missing signature', 400);
                return;
            }

            if (!ed25519.verify(signature, timestamp + bodyData)) {
                this.session.getBot().logger.warn('[MiddlewareReceiver] 签名验证失败');
                this.handleError(res, 'Invalid signature', 401);
                return;
            }

            // 解析数据包
            let packet: DataPacket;
            try {
                packet = JSON.parse(bodyData);
            } catch (error) {
                this.session.getBot().logger.error('[MiddlewareReceiver] 数据包解析失败:', error);
                this.handleError(res, 'Invalid JSON', 400);
                return;
            }

            // 处理不同类型的操作
            switch (packet.op) {
                case OpCode.SIGN_VERIFY:
                    await this.handleSignVerify(packet, res, ed25519);
                    break;
                case OpCode.DISPATCH:
                    await this.handleDispatch(packet, res);
                    break;
                default:
                    this.session.getBot().logger.warn(`[MiddlewareReceiver] 未知的操作码: ${packet.op}`);
                    this.handleError(res, 'Unknown operation', 400);
            }
        } catch (error) {
            this.handleRequestError(res, error as Error);
        }
    }

    /**
     * 处理签名验证
     */
    private async handleSignVerify(packet: DataPacket, res: ServerResponse, ed25519: Ed25519): Promise<void> {
        if (!this.session) return;

        const { plain_token, event_ts } = packet.d;
        const signed = ed25519.sign(event_ts + plain_token);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            plain_token,
            signature: signed
        }));

        this.session.getBot().logger.debug('[MiddlewareReceiver] 处理签名验证完成');
    }

    /**
     * 处理事件分发
     */
    private async handleDispatch(packet: DataPacket, res: ServerResponse): Promise<void> {
        if (!this.session) return;

        this.session.getBot().logger.debug('[MiddlewareReceiver] 收到事件:', packet.t);

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
     * 处理错误响应
     */
    private handleError(res: ServerResponse, message: string, statusCode: number): void {
        if (!res.headersSent) {
            res.writeHead(statusCode, { 'Content-Type': 'text/plain' });
            res.end(message);
        }
    }

    /**
     * 处理请求错误
     */
    private handleRequestError(res: ServerResponse, error: Error): void {
        if (this.session) {
            this.session.getBot().logger.error('[MiddlewareReceiver] 请求处理错误:', error);
        }

        this.emitError(error);

        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        }
    }

    /**
     * 处理数据包（基类抽象方法实现）
     */
    protected handlePacket(packet: DataPacket): void {
        // Middleware接收器的数据包处理在handleWebhookRequest中进行
        // 这里不需要额外处理
    }

    /**
     * 获取接收器类型
     */
    public getType(): string {
        return ReceiverMode.MIDDLEWARE;
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
                platform: this.config.platform,
                hasEd25519: !!this.handler.ed25519,
                hasMiddleware: typeof this.handler.middleware === 'function'
            }
        };
    }
}

/**
 * 创建Middleware接收器的工厂函数（向后兼容）
 */
export function createMiddlewareReceiver<T extends ApplicationPlatform>(platform: T): MiddlewareReceiver<T> {
    const config = new MiddlewareReceiverConfig({ platform });
    return new MiddlewareReceiver<T>(config);
}
