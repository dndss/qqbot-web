/**
 * 消息系统入口文件
 */
export { MessageBuilder } from './builder';
export { FileProcessor } from './file-processor';
export { ChunkedUploader, UploadDailyLimitExceededError } from './chunked-upload';

export type { MessagePayload, FilePayload, BuildResult } from './builder';
export type { FileUploadResult, UploadOptions } from './file-processor';
export type {
  ChunkedUploadOptions,
  ChunkedUploadProgress,
  MediaFileType,
  MediaUploadResult
} from './chunked-upload';
