/**
 * 消息构建器 - 专门负责构建消息内容
 */

import { Sendable, MessageElem, ImageElem, VideoElem, AudioElem, FileElem, ReplyElem, AtElem, LinkElem, TextElem, FaceElem, MDElem, KeyboardElem, ButtonElem, EmbedElem, ArkElem } from "@/elements";
import { md5 } from "@/utils";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface MessagePayload {
  msg_seq?: number;
  content: string;
  msg_type?: number;
  msg_id?: string;
  event_id?: string;
  message_reference?: {
    message_id: string;
  };
  image?: string;
  file_image?: any;
  media?: {
    file_info: any;
  };
  markdown?: any;
  keyboard?: any;
  bot_appid?: string;
  ark?: any;
  embed?: any;
}

export interface FilePayload {
  file_type?: 1 | 2 | 3 | 4;
  url?: string
  file_data?: any;
  file_name?: string;
  local_path?: string;
}

export interface BuildResult {
  messagePayload: MessagePayload;
  filePayload: FilePayload;
  isFile: boolean;
  contentType: string;
  brief: string;
}

/**
 * 消息构建器
 * 专门负责将Sendable类型的消息转换为API所需的格式
 */
export class MessageBuilder {
  private messagePayload: MessagePayload;
  private filePayload: FilePayload;
  private buttons: any[] = [];
  private isFile = false;
  private contentType = 'application/json';
  private brief = '';

  constructor(
    private appid: string,
    private isGuild?: boolean,
    private source?: { id?: string; event_id?: string; msg_idx?: string },
    private quote = false
  ) {
    this.messagePayload = {
      content: ''
    };

    this.filePayload = {};

    if (source?.id) {
      this.messagePayload.msg_id = source.id;
      this.messagePayload.msg_seq = 1;
    }

    if (quote && source?.msg_idx) {
      this.messagePayload.message_reference = {
        message_id: source.msg_idx
      };
    }

    if (source?.event_id) {
      this.messagePayload.event_id = source.event_id;
    }
  }

  /**
   * 构建消息
   */
  async build(message: Sendable): Promise<BuildResult> {
    await this.processMessage(message);
    await this.processButtons();

    return {
      messagePayload: this.messagePayload,
      filePayload: this.filePayload,
      isFile: this.isFile,
      contentType: this.contentType,
      brief: this.brief
    };
  }

  /**
   * 处理消息内容
   */
  private async processMessage(message: Sendable): Promise<void> {
    if (!Array.isArray(message)) {
      message = [message as any];
    }

    const messageQueue = [...message];

    while (messageQueue.length) {
      const elem = messageQueue.shift();

      if (typeof elem === 'string') {
        const parsedElems = this.parseFromTemplate(elem);
        messageQueue.unshift(...(parsedElems as any));
        continue;
      }

      await this.processElement(elem);
    }
  }

  /**
   * 处理单个消息元素
   */
  private async processElement(elem: MessageElem): Promise<void> {
    switch (elem.type) {
      case 'reply':
        this.handleReply(elem as ReplyElem);
        break;
      case 'at':
        this.handleAt(elem as AtElem);
        break;
      case 'link':
        this.handleLink(elem as LinkElem);
        break;
      case 'text':
        this.handleText(elem as TextElem);
        break;
      case 'face':
        this.handleFace(elem as FaceElem);
        break;
      case 'image':
      case 'audio':
      case 'video':
      case 'file':
        await this.handleMedia(elem as ImageElem | VideoElem | AudioElem | FileElem);
        break;
      case 'markdown':
        this.handleMarkdown(elem as MDElem);
        break;
      case 'keyboard':
        this.handleKeyboard(elem as KeyboardElem);
        break;
      case 'button':
        this.handleButton(elem as ButtonElem);
        break;
      case 'embed':
        this.handleEmbed(elem as EmbedElem);
        break;
      case 'ark':
        this.handleArk(elem as any);
        break;
      default:
        console.warn(`未知的消息元素类型: ${elem.type}`);
        break;
    }
  }

  /**
   * 处理回复元素
   */
  private handleReply(elem: ReplyElem): void {
    if (elem.data.event_id) {
      this.messagePayload.event_id = elem.data.event_id;
      this.brief += `<reply,event_id=${elem.data.event_id}>`;
    } else if (elem.data.id) {
      this.messagePayload.msg_id = elem.data.id;
      this.messagePayload.msg_seq ??= 1;
      this.brief += `<reply,msg_id=${elem.data.id}>`;
      if (elem.data.msg_idx) {
        this.messagePayload.message_reference = {
          message_id: elem.data.msg_idx
        };
        this.brief += `<reference,msg_idx=${elem.data.msg_idx}>`;
      }
    }
  }

  /**
   * 处理@元素
   */
  private handleAt(elem: AtElem): void {
    const userId = elem.data.user_id === 'all' ? 'everyone' : elem.data.user_id;
    this.messagePayload.content += `<@${userId}>`;
    this.brief += `<at,user=${userId}>`;
  }

  /**
   * 处理链接元素
   */
  private handleLink(elem: LinkElem): void {
    this.messagePayload.content += `<#${elem.data.channel_id}>`;
    this.brief += `<link,channel=${elem.data.channel_id}>`;
  }

  /**
   * 处理文本元素
   */
  private handleText(elem: TextElem): void {
    this.messagePayload.content += elem.data.text;
    this.brief += elem.data.text;
  }

  /**
   * 处理表情元素
   */
  private handleFace(elem: FaceElem): void {
    this.messagePayload.content += `<emoji:${elem.data.id}>`;
    this.brief += `<face,id=${elem.data.id}>`;
  }

  /**
   * 处理媒体元素（图片、视频、音频）
   */
  private async handleMedia(elem: ImageElem | VideoElem | AudioElem | FileElem): Promise<void> {
    const mediaType = this.getMediaType(elem.type);
    if (this.isGuild && mediaType === 4) {
      throw new Error('Guild messages do not support file elements');
    }

    // 如果是回复消息，需要特殊处理
    if (this.messagePayload.msg_id || this.messagePayload.event_id) {// 频道消息的文件处理
      const {url,blob,base64,localPath} = await this.formatMediaData(elem, !this.isGuild);
      if (this.isGuild) {
        this.contentType = 'multipart/form-data';
        if (blob) {
          this.messagePayload.file_image = blob;
        } else {
          this.messagePayload.image = url;
        }
      } else {
        // 群聊/私聊消息的文件处理
        this.messagePayload.msg_type = 7;
        // 这里需要调用上传接口，暂时标记为需要文件上传
        this.isFile = true;
        this.filePayload.file_type = mediaType;
        if (localPath) {
          this.filePayload.local_path = localPath;
        } else if(base64) {
          this.filePayload.file_data = base64;
        } else {
          this.filePayload.url = url;
        }
        if (mediaType === 4) {
          this.filePayload.file_name = this.getFileName(elem as FileElem, localPath, url);
        }
      }
    } else {
      const {url,blob,base64,localPath} = await this.formatMediaData(elem, !this.isGuild);
      // 非回复消息的处理
      if (this.isGuild) {
        if (blob) {
          this.messagePayload.file_image = blob;
        } else {
          this.messagePayload.image = url;
        }
      } else {
        this.messagePayload.msg_type = 7;
        this.isFile = true;
        this.filePayload.file_type = mediaType;
        if (localPath) {
          this.filePayload.local_path = localPath;
        } else if(base64) {
          this.filePayload.file_data = base64;
        } else {
          this.filePayload.url = url;
        }
        if (mediaType === 4) {
          this.filePayload.file_name = this.getFileName(elem as FileElem, localPath, url);
        }
      }
    }

    this.brief += `<${elem.type}:${this.getFileHash(elem.data.file)}>`;
  }

  /**
   * 处理Markdown元素
   */
  private handleMarkdown(elem: MDElem): void {
    this.messagePayload.markdown = elem.data;
    this.messagePayload.msg_type = 2;
    const content = elem.data.content ? `content=${elem.data.content}` : `template_id=${elem.data.custom_template_id}`;
    this.brief += `<markdown,${content}>`;
  }

  /**
   * 处理键盘元素
   */
  private handleKeyboard(elem: KeyboardElem): void {
    this.messagePayload.msg_type = 2;
    this.messagePayload.keyboard = elem.data;
    this.messagePayload.bot_appid = this.appid;
    this.brief += `<keyboard>`;
  }

  /**
   * 处理按钮元素
   */
  private handleButton(elem: ButtonElem): void {
    this.buttons.push(elem.data);
    this.brief += `<button,data=${JSON.stringify(elem.data)}>`;
  }

  /**
   * 处理嵌入元素
   */
  private handleEmbed(elem: EmbedElem): void {
    if (!this.isGuild) return;
    this.messagePayload.msg_type = 4;
    this.messagePayload.embed = elem.data;
    this.brief += `<embed>`;
  }

  /**
   * 处理ARK元素
   */
  private handleArk(elem: ArkElem): void {
    this.messagePayload.msg_type = 3;
    this.messagePayload.ark = elem.data;
    this.brief += `<ark>`;
  }

  /**
   * 处理按钮组
   */
  private async processButtons(): Promise<void> {
    if (this.buttons.length === 0) return;

    const rows = [];
    let row = [];

    for (let i = 0; i < this.buttons.length; i++) {
      if (row.length >= 5) {
        rows.push(row);
        row = [];
      }
      // 支持按钮模板发送
      if (this.buttons[i].id) {
        this.messagePayload.keyboard = {
          id: this.buttons[i].id,
          bot_appid: this.appid
        };
        return;
      }
      // 如果是按钮组，则直接添加到行中
      if (Array.isArray(this.buttons[i].buttons)) {
        rows.push(this.buttons[i].buttons);
      }else{
        row.push(this.buttons[i]);  
      }
    }

    if (row.length > 0) {
      rows.push(row);
    }

    this.messagePayload.keyboard = {
      content: {
        rows: rows.map(row => ({
          buttons: row
        }))
      },
      bot_appid: this.appid
    };
  }

  /**
   * 从模板字符串解析消息元素
   */
  private parseFromTemplate(template: string): MessageElem[] {
    const result: MessageElem[] = [];
    let cursor = 0;

    while (cursor < template.length) {
      const tagStart = template.indexOf('<', cursor);
      if (tagStart === -1) {
        const text = template.slice(cursor);
        if (text) {
          result.push({
            type: 'text',
            data: { text }
          });
        }
        break;
      }

      if (tagStart > cursor) {
        result.push({
          type: 'text',
          data: { text: template.slice(cursor, tagStart) }
        });
      }

      const tagEnd = template.indexOf('>', tagStart + 1);
      if (tagEnd === -1) {
        const text = template.slice(tagStart);
        if (text) {
          result.push({
            type: 'text',
            data: { text }
          });
        }
        break;
      }

      const match = template.slice(tagStart, tagEnd + 1);
      cursor = tagEnd + 1;

      const [type, ...attrArr] = match.slice(1, -1).split(',');
      const attrs = Object.fromEntries(attrArr.map((attr: string) => {
        const [key, value] = attr.split('=');
        try {
          return [key, JSON.parse(value)];
        } catch {
          return [key, value];
        }
      }));

      result.push({
        type,
        data: attrs
      } as MessageElem);
    }

    return result;
  }


  /**
   * 准备频道媒体数据
   */
  private async formatMediaData(
    elem: ImageElem | VideoElem | AudioElem | FileElem,
    preserveLocalPath = false
  ): Promise<{
    url: string;
    blob?: Blob;
    base64?: string;
    localPath?: string;
  }> {
    if ('url' in elem.data && elem.data.url) return { url: elem.data.url };

    if (typeof elem.data.file === "string" && elem.data.file.startsWith('http')) {
      return { url: elem.data.file };
    }


    if (Buffer.isBuffer(elem.data.file)) {
      return { 
        url: '',
        blob: new Blob([Buffer.from(elem.data.file)]),
        base64: elem.data.file.toString('base64')
       };
    } else if (typeof elem.data.file !== "string") {
      throw new Error("无效的文件参数: " + elem.data.file);
    } else if (elem.data.file.startsWith("base64://")) {
      return { 
        url: '',
        blob: new Blob([Buffer.from(elem.data.file.slice(9), 'base64')]),
        base64: elem.data.file.slice(9)
      };
    } else if (/^data:[^/]+\/[^;]+;base64,/.test(elem.data.file)) {
      return { 
        url: '',
        blob: new Blob([Buffer.from(elem.data.file.replace(/^data:[^/]+\/[^;]+;base64,/, ''), 'base64')]),
        base64: elem.data.file.replace(/^data:[^/]+\/[^;]+;base64,/, '')
      };
    } else {
      try {
        const localPath = elem.data.file.startsWith('file://')
          ? fileURLToPath(elem.data.file)
          : elem.data.file;
        if (preserveLocalPath) return { url: '', localPath };
        const buffer = await fs.readFile(localPath);
        return { 
          url: '',
          blob: new Blob([buffer]),
          base64: buffer.toString('base64')
        };
      } catch {
        throw new Error("无效的文件路径: " + elem.data.file);
      }
    }
  }

  /**
   * 获取媒体类型编号
   */
  private getMediaType(type: string): 1 | 2 | 3 | 4 {
    const types = {
      image: 1,
      video: 2,
      audio: 3,
      file: 4
    } as const;
    const mediaType = types[type as keyof typeof types];
    if (!mediaType) throw new Error(`Unsupported media type: ${type}`);
    return mediaType;
  }

  private getFileName(
    elem: FileElem,
    localPath?: string,
    url?: string
  ): string {
    if (elem.data.name) return this.sanitizeFileName(elem.data.name);
    if (localPath) return this.sanitizeFileName(path.basename(localPath));
    if (url) {
      try {
        return this.sanitizeFileName(decodeURIComponent(new URL(url).pathname));
      } catch {}
    }
    return 'file';
  }

  private sanitizeFileName(fileName: string): string {
    const name = fileName.split(/[/\\]/).pop()?.replace(/[\u0000-\u001f]/g, '').trim();
    return name || 'file';
  }

  /**
   * 获取文件哈希值
   */
  private getFileHash(file: string | Buffer): string {
    try {
      return md5(file);
    } catch {
      return 'unknown';
    }
  }
}
