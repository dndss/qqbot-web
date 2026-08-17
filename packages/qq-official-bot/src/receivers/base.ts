import { EventEmitter } from "events";
import { Session } from "@/core/session";
import { DataPacket } from "@/types";

/**
 * 基础接收器抽象类
 * 定义了所有接收器的通用接口和生命周期管理
 */
export abstract class BaseReceiver<T extends object = object> extends EventEmitter {
    /**
     * 接收器处理器对象，包含具体的连接或服务器实例
     */
    public readonly handler: T;

    /**
     * 接收器状态
     */
    protected _isStarted: boolean = false;
    protected _isReady: boolean = false;
    protected _lastError: Error | null = null;

    constructor(handler: T) {
        super();
        this.handler = handler;
        this.setupBaseEventHandlers();
    }

    /**
     * 获取接收器状态
     */
    public get isStarted(): boolean {
        return this._isStarted;
    }

    public get isReady(): boolean {
        return this._isReady;
    }

    public get lastError(): Error | null {
        return this._lastError;
    }

    /**
     * 设置基础事件处理器
     */
    private setupBaseEventHandlers(): void {
        this.on('ready', () => {
            this._isReady = true;
        });

        this.on('error', (error: Error) => {
            this._lastError = error;
        });

        this.on('close', () => {
            this._isReady = false;
        });
    }

    /**
     * 启动接收器（抽象方法）
     * @param session 会话管理器实例
     */
    public abstract start(session: Session<any, any>): Promise<void>;

    /**
     * 停止接收器（抽象方法）
     * @param session 会话管理器实例
     */
    public abstract stop(session?: Session<any, any>): Promise<void>;

    /**
     * 重启接收器（默认实现）
     */
    public async restart(session: Session<any, any>): Promise<void> {
        await this.stop(session);
        await this.start(session);
    }

    /**
     * 处理接收到的数据包（抽象方法）
     * @param packet 数据包
     */
    protected abstract handlePacket(packet: DataPacket): void;

    /**
     * 发送packet事件（统一处理）
     */
    protected emitPacket(packet: DataPacket): void {
        this.emit('packet', packet);
    }

    /**
     * 发送ready事件（统一处理）
     */
    protected emitReady(): void {
        this.emit('ready');
    }

    /**
     * 发送error事件（统一处理）
     */
    protected emitError(error: Error): void {
        this.emit('error', error);
    }

    /**
     * 发送close事件（统一处理）
     */
    protected emitClose(code?: number, reason?: string): void {
        this.emit('close', code, reason);
    }

    /**
     * 获取接收器类型标识（抽象方法）
     */
    public abstract getType(): string;

    /**
     * 获取接收器配置信息（抽象方法）
     */
    public abstract getConfig(): Record<string, any>;

    /**
     * 健康检查（默认实现）
     */
    public healthCheck(): { status: 'healthy' | 'unhealthy'; details: any } {
        const status = this._isStarted && this._isReady ? 'healthy' : 'unhealthy';
        return {
            status,
            details: {
                isStarted: this._isStarted,
                isReady: this._isReady,
                lastError: this._lastError?.message || null,
                type: this.getType()
            }
        };
    }
}

/**
 * 接收器接口定义
 */
export interface IReceiver {
    start(session: Session<any, any>): Promise<void>;
    stop(session?: Session<any, any>): Promise<void>;
    restart(session: Session<any, any>): Promise<void>;
    getType(): string;
    getConfig(): Record<string, any>;
    healthCheck(): { status: 'healthy' | 'unhealthy'; details: any };
}

/**
 * 接收器模式枚举
 */
export enum ReceiverMode {
    WEBSOCKET = 'websocket',
    WEBHOOK = 'webhook',
    MIDDLEWARE = 'middleware'
}

/**
 * 接收器配置基类
 */
export abstract class BaseReceiverConfig {
    public readonly mode: ReceiverMode;

    constructor(mode: ReceiverMode) {
        this.mode = mode;
    }

    public abstract validate(): boolean;
    public abstract toJson(): Record<string, any>;
}
