/**
 * 文件处理器 - 专门负责文件上传和处理
 */
import * as fs from 'node:fs';
import { getFileBase64 } from "@/utils/file";
import {ReceiverMode} from "@/receivers/base";
import {ApplicationPlatform} from "@/receivers/middleware";
import { AxiosInstance } from "axios";

export interface FileUploadResult {
  file_info: any;
  url?: string;
  file_id?: string;
}

export interface UploadOptions {
  targetId: string;
  targetType: 'user' | 'group';
  fileType: 1 | 2 | 3 | 4; // 1: image, 2: video, 3: audio, 4: file
  fileName?: string;
  sendMessage?: boolean;
}

/**
 * 文件处理器
 * 专门负责文件的上传、处理和管理
 */
export class FileProcessor<T extends ReceiverMode=ReceiverMode,M extends ApplicationPlatform=ApplicationPlatform> {
  constructor(private request: AxiosInstance) {}

  /**
   * 上传媒体文件
   */
  async uploadMedia(
    fileData: string | Buffer,
    options: UploadOptions
  ): Promise<FileUploadResult> {
    // 转换文件数据为base64格式
      const base64Data = await getFileBase64(fileData);

      // 构建上传请求
      const uploadPayload = {
        file_type: options.fileType,
        file_data: base64Data,
        ...(options.fileType === 4 && options.fileName ? { file_name: options.fileName } : {}),
        srv_send_msg: options.sendMessage || false
      };

      // 发送上传请求
      const { data: result } = await this.request.post(
        `/v2/${options.targetType}s/${options.targetId}/files`,
        uploadPayload
      );

      return result;
  }

  /**
   * 批量上传文件
   */
  async uploadMultipleFiles(
    files: Array<{
      data: string | Buffer;
      type: 1 | 2 | 3 | 4;
    }>,
    options: Omit<UploadOptions, 'fileType'>
  ): Promise<FileUploadResult[]> {
    const results = [];

    for (const file of files) {
      const result = await this.uploadMedia(file.data, {
          ...options,
          fileType: file.type
        });
        results.push(result);
    }

    return results;
  }

  /**
   * 检查文件类型
   */
  validateFileType(fileData: string | Buffer, expectedType: 1 | 2 | 3): boolean {
    // 这里可以添加文件类型验证逻辑
    // 例如检查文件头、扩展名等
    return true;
  }

  /**
   * 获取文件大小
   */
  getFileSize(fileData: string | Buffer): number {
    if (Buffer.isBuffer(fileData)) {
      return fileData.length;
    }

    if (typeof fileData === 'string') {
      if (fileData.startsWith('base64://')) {
        return Buffer.from(fileData.slice(9), 'base64').length;
      } else if (fileData.startsWith('data:')) {
        const base64Data = fileData.split(',')[1];
        return Buffer.from(base64Data, 'base64').length;
      }
    }

    return 0;
  }

  /**
   * 检查文件大小限制
   */
  checkFileSizeLimit(fileData: string | Buffer, maxSize: number = 10 * 1024 * 1024): boolean {
    const fileSize = this.getFileSize(fileData);
    return fileSize <= maxSize;
  }

  /**
   * 从URL下载文件
   */
  async downloadFromUrl(url: string): Promise<Buffer> {
    const axios = require('axios');
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 10 * 1024 * 1024 // 10MB limit
      });

      return Buffer.from(response.data);
  }

  /**
   * 清理临时文件
   */
  async cleanupTempFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      fs.unlinkSync(filePath);
    }
  }
}
