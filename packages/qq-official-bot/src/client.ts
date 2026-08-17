import { EventEmitter } from "events";
import axios, { type AxiosInstance } from "axios";
import { WebSocket } from "ws";
import { FormData } from 'formdata-node';
import * as log4js from 'log4js';
import { Session } from "./core/session";
import type { Dict, LogLevel, DataPacket } from "@/types";
import { EventMap, EventParserMap, QQEvent } from "./events";
import { Intent } from "./constants";
import type { ApplicationPlatform } from "@/receivers/middleware";
import {ReceiverMode,ReceiveModeConfig} from "@/receivers";

export class Client<T extends ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> extends EventEmitter {
    readonly request: AxiosInstance;
    readonly sessionManager: Session<T, M>;
    readonly logger: log4js.Logger;

    self_id!: string;
    nickname!: string;
    status!: number;
    ws!: WebSocket;

    get receiver(): import("./receivers").ResolveReceiver<T, M> {
        return this.sessionManager.receiver;
    }

    constructor(public readonly config: Client.Config<T, M>) {
        super();
        this.request = axios.create({
            baseURL: config.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com',
            timeout: config.timeout ?? 5000,
            headers: {
                'User-Agent': 'BotNodeSDK/0.0.1'
            }
        });
        this.logger = log4js.getLogger(`[QQBot:${config.appid}]`);
        this.sessionManager = new Session(this);
        this.logger.level = config.logLevel ?? 'info';


        this.setupInterceptors();
    }

    removeAt(payload: Dict): void {
        if (this.config.removeAt === false) return;

        if (typeof payload.content !== 'string' || !Array.isArray(payload.mentions)) return;

        const mention = payload.mentions.find((item: Dict) =>
            item?.is_you === true && item?.scope === 'single'
        );
        const id = mention?.id || mention?.member_openid || mention?.user_openid;
        if (!id) return;

        const escapedId = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        payload.content = payload.content
            .replace(new RegExp(`<@!?${escapedId}>\\s*`), '')
            .trimStart();
    }

    private completeGroupAtMention(event: string, payload: Dict): void {
        if (event !== 'GROUP_AT_MESSAGE_CREATE' || !this.self_id) return;

        const mentions = Array.isArray(payload.mentions) ? payload.mentions : [];
        const hasSelfMention = mentions.some((mention: Dict) =>
            mention?.is_you === true && mention?.scope === 'single'
        );
        if (hasSelfMention) return;

        const selfId = String(this.self_id);
        payload.mentions = [{
            bot: true,
            id: selfId,
            member_openid: selfId,
            is_you: true,
            scope: 'single',
            ...(this.nickname ? { username: this.nickname } : {})
        }, ...mentions];

        const content = typeof payload.content === 'string' ? payload.content : '';
        const escapedId = selfId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`<@!?${escapedId}>`).test(content)) {
            payload.content = `<@${selfId}>${content}`;
        }
    }

    processPayload(event_id: string, event: string, payload: Dict): Dict | null {
        const [post_type, ...sub_type] = event.split('.');
        const result: Dict = {
            event_id,
            post_type,
            [`${post_type}_type`]: sub_type.join('.'),
            ...payload
        };

        const parser = EventParserMap.get(event);
        if (!parser) {
            this.logger.warn('Unhandled event:', event);
            return result;
        }

        return parser.call(this as any, event, result);
    }


    dispatchEvent(event: string, wsRes: DataPacket): void {
        this.logger.debug(event, wsRes);

        const { d: payload, id: event_id = '' } = wsRes;
        if (!payload || !event) return;

        this.completeGroupAtMention(event, payload);
        const transformEvent = QQEvent[event] ?? 'system';

        try {
            const result = this.processPayload(event_id, transformEvent, payload);
            if (!result) {
                this.logger.debug('Failed to parse event:', wsRes);
                return;
            }
            this.em(transformEvent, result);
        } catch (error) {
            this.logger.debug('Failed to parse event:', wsRes);
        }
    }
    em(event: string, payload: Dict): void {
        const eventNames = event.split('.');
        const [post_type, detail_type, ...sub_type] = eventNames;

        Object.assign(payload, {
            post_type,
            [`${post_type}_type`]: detail_type,
            sub_type: sub_type.join('.'),
            ...payload
        });

        let prefix = '';
        const eventNamesCopy = [...eventNames];

        while (eventNamesCopy.length) {
            const eventName = eventNamesCopy.shift()!;
            const fullEventName = prefix ? `${prefix}.${eventName}` : eventName;
            this.emit(fullEventName, payload);
            prefix = fullEventName;
        }
    }

    private setupInterceptors(): void {
        this.request.interceptors.request.use((config) => {
            config.headers.Authorization = `QQBot ${this.sessionManager.access_token}`;
            config.headers['X-Union-Appid'] = this.config.appid;

            // Handle REST parameters
            if ((config as any).rest) {
                const restObj = (config as any).rest;
                delete (config as any).rest;
                Object.entries(restObj).forEach(([key, value]) => {
                    config.url = config.url?.replace(`:${key}`, String(value));
                });
            }

            // Handle multipart form data
            if (config.headers['Content-Type'] === 'multipart/form-data') {
                delete config.data.message_reference;
                const formData = new FormData();
                Object.entries(config.data).forEach(([key, value]) => {
                    if (value !== undefined) {
                        formData.set(key, value);
                    }
                });
                config.data = formData;
            }

            return config;
        });

        this.request.interceptors.response.use(
            (res) => res,
            (res) => {
                if (!res?.response?.data) return Promise.reject(res);

                const data = res.response.data;
                const {
                    code = res.response.status,
                    message = res.response.statusText
                } = data;

                if ([304023, 304024].includes(code)) {
                    this.logger.warn(message);
                    return Promise.resolve(res.response.data);
                }

                const error = Object.assign(
                    new Error(`Request "${res.config.url}" failed with code(${code}): ${message}`),
                    {
                        code,
                        err_code: data.err_code ?? code,
                        trace_id: data.trace_id,
                    }
                );
                return Promise.reject(error);
            }
        );
    }
}

export interface Client<T extends ReceiverMode = ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> {
    on<E extends keyof EventMap>(event: E, callback: EventMap[E]): this;
    on<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback: (...args: any[]) => void): this;

    once<E extends keyof EventMap>(event: E, callback: EventMap[E]): this;
    once<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback: (...args: any[]) => void): this;

    off<E extends keyof EventMap>(event: E, callback?: EventMap[E]): this;
    off<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback?: (...args: any[]) => void): this;

    emit<E extends keyof EventMap>(event: E, ...args: Parameters<EventMap[E]>): boolean;
    emit<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, ...args: any[]): boolean;

    addListener<E extends keyof EventMap>(event: E, callback: EventMap[E]): this;
    addListener<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback: (...args: any[]) => void): this;

    addListenerOnce<E extends keyof EventMap>(event: E, callback: EventMap[E]): this;
    addListenerOnce<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback: (...args: any[]) => void): this;

    removeListener<E extends keyof EventMap>(event: E, callback?: EventMap[E]): this;
    removeListener<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>, callback?: (...args: any[]) => void): this;

    removeAllListeners<E extends keyof EventMap>(event: E): this;
    removeAllListeners<S extends string | symbol>(event: S & Exclude<string | symbol, keyof EventMap>): this;
}

export namespace Client {
    export interface Token {
        access_token: string;
        expires_in: number;
        cache?: string;
    }

    export type Config<T extends ReceiverMode=ReceiverMode, M extends ApplicationPlatform = ApplicationPlatform> = {
        appid: string;
        secret: string;
        sandbox?: boolean;
        timeout?: number;
        maxRetry?: number;
        dataDir?: string;
        /** Whether to remove the first @ mention */
        removeAt?: boolean;
        delay?: Dict<number>;
        intents?: Intent[];
        logLevel?: LogLevel;
        mode: T;
    } & ReceiveModeConfig<M>[T];
}
