/**
 * 连接管理器 - 负责管理与QQ API的连接
 * 从SessionManager中提取连接相关功能
 */

import { EventEmitter } from "events";
import { Client } from "@/client";
import { OpCode, SessionEvents, WebsocketCloseReason } from "@/constants";

export interface ConnectionConfig {
  maxRetry?: number;
  heartbeatInterval?: number;
  reconnectDelay?: number;
}

export interface ConnectionState {
  sessionID: string;
  seq: number;
  retry: number;
  alive: boolean;
  isReconnect: boolean;
  userClose: boolean;
}

export interface HeartbeatData {
  op: OpCode;
  d: any;
}

/**
 * 连接管理器
 * 专门负责维护与QQ服务器的连接状态
 */
export class Connection extends EventEmitter {
  private bot: Client;
  private config: ConnectionConfig;
  private state: ConnectionState;
  private heartbeatParam: HeartbeatData;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(bot: Client, config: ConnectionConfig = {}) {
    super();
    this.bot = bot;
    this.config = {
      maxRetry: 10,
      heartbeatInterval: 30000,
      reconnectDelay: 5000,
      ...config
    };

    this.state = {
      sessionID: "",
      seq: 0,
      retry: 0,
      alive: false,
      isReconnect: false,
      userClose: false
    };

    this.heartbeatParam = {
      op: OpCode.HEARTBEAT,
      d: null
    };

    this.setupEventHandlers();
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    this.on(SessionEvents.EVENT_WS, this.handleSessionEvent.bind(this));
    this.on(SessionEvents.ERROR, this.handleError.bind(this));
  }

  /**
   * 处理会话事件
   */
  private async handleSessionEvent(data: any): Promise<void> {
    switch (data.eventType) {
      case SessionEvents.RECONNECT:
        this.bot.logger.mark("[CONNECTION] 等待断线重连中...");
        await this.handleReconnect();
        break;

      case SessionEvents.DISCONNECT:
        await this.handleDisconnect(data);
        break;

      case SessionEvents.READY:
        this.handleReady();
        break;

      default:
        this.bot.logger.warn(`[CONNECTION] 未知事件类型: ${data.eventType}`);
    }
  }

  /**
   * 处理重连
   */
  private async handleReconnect(): Promise<void> {
    if (this.state.userClose) {
      return;
    }

    this.state.isReconnect = true;
    await this.delay(this.config.reconnectDelay!);
    await this.connect();
  }

  /**
   * 处理断开连接
   */
  private async handleDisconnect(data: any): Promise<void> {
    if (this.state.userClose || [4914, 4915].includes(data.code)) {
      return;
    }

    if (this.state.retry < this.config.maxRetry!) {
      this.bot.logger.mark(`[CONNECTION] 重新连接中，尝试次数：${this.state.retry + 1}`);

      // 检查是否需要恢复会话
      const closeReason = WebsocketCloseReason.find(v => v.code === data.code);
      if (closeReason?.resume) {
        this.updateSessionRecord(data.eventMsg);
      }

      this.state.isReconnect = data.code === 4009;
      this.state.retry += 1;

      await this.disconnect();
      await this.connect();
    } else {
      this.bot.logger.mark("[CONNECTION] 超过重试次数，连接终止");
      this.emit(SessionEvents.DEAD, {
        eventType: SessionEvents.ERROR,
        msg: "连接已死亡，请检查网络或重启"
      });
    }
  }

  /**
   * 处理连接就绪
   */
  private handleReady(): void {
    this.bot.logger.mark("[CONNECTION] 连接成功");
    this.state.retry = 0;
    this.state.alive = true;
    this.startHeartbeat();
  }

  /**
   * 处理错误
   */
  private handleError(code: number, message: string): void {
    this.bot.logger.error(`[CONNECTION] 发生错误：${code} ${message}`);
    this.state.alive = false;
    this.stopHeartbeat();
  }

  /**
   * 开始连接
   */
  async connect(): Promise<void> {
    try {
      this.state.userClose = false;
      this.emit('connecting');

      // 这里会调用具体的接收器连接逻辑
      this.emit('connect');

      this.bot.logger.debug("[CONNECTION] 连接请求已发送");
    } catch (error) {
      this.bot.logger.error("[CONNECTION] 连接失败:", error);
      this.emit(SessionEvents.ERROR, -1, `连接失败: ${error}`);
    }
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    this.state.userClose = true;
    this.state.alive = false;
    this.stopHeartbeat();

    this.emit('disconnect');
    this.bot.logger.debug("[CONNECTION] 连接已断开");
  }

  /**
   * 开始心跳
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.state.alive) {
        this.sendHeartbeat();
      }
    }, this.config.heartbeatInterval);

    this.bot.logger.debug("[CONNECTION] 心跳已启动");
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      this.bot.logger.debug("[CONNECTION] 心跳已停止");
    }
  }

  /**
   * 发送心跳
   */
  private sendHeartbeat(): void {
    try {
      this.heartbeatParam.d = this.state.seq;
      this.emit('heartbeat', this.heartbeatParam);
      this.bot.logger.debug("[CONNECTION] 心跳已发送", this.heartbeatParam);
    } catch (error) {
      this.bot.logger.error("[CONNECTION] 心跳发送失败:", error);
    }
  }

  /**
   * 更新会话记录
   */
  updateSessionRecord(record: { sessionID?: string; seq?: number }): void {
    if (record.sessionID) {
      this.state.sessionID = record.sessionID;
    }
    if (record.seq !== undefined) {
      this.state.seq = record.seq;
    }

    this.bot.logger.debug("[CONNECTION] 会话记录已更新", {
      sessionID: this.state.sessionID,
      seq: this.state.seq
    });
  }

  /**
   * 获取连接状态
   */
  getConnectionState(): Readonly<ConnectionState> {
    return { ...this.state };
  }

  /**
   * 检查连接是否活跃
   */
  isAlive(): boolean {
    return this.state.alive && !this.state.userClose;
  }

  /**
   * 工具方法：延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.stopHeartbeat();
    this.state.userClose = true;
    this.state.alive = false;
    this.removeAllListeners();
    this.bot.logger.debug("[CONNECTION] 连接管理器已销毁");
  }
}
