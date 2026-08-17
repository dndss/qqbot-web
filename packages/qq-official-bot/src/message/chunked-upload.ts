import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import * as path from 'node:path';
import type { AxiosInstance } from 'axios';

export type MediaFileType = 1 | 2 | 3 | 4;

export interface MediaUploadResult {
  file_uuid: string;
  file_info: string;
  ttl: number;
}

export interface ChunkedUploadProgress {
  completedParts: number;
  totalParts: number;
  uploadedBytes: number;
  totalBytes: number;
}

export interface ChunkedUploadOptions {
  fileName?: string;
  onProgress?: (progress: ChunkedUploadProgress) => void;
}

interface UploadPart {
  index: number;
  presigned_url: string;
  block_size?: number | string;
}

interface UploadPrepareResponse {
  upload_id: string;
  block_size: number | string;
  parts: UploadPart[];
  concurrency?: number | string;
  retry_timeout?: number | string;
}

interface FileHashes {
  md5: string;
  sha1: string;
  md5_10m: string;
}

const MD5_10M_SIZE = 10_002_432;
const DEFAULT_CONCURRENT_PARTS = 1;
const MAX_CONCURRENT_PARTS = 10;
const PART_UPLOAD_TIMEOUT = 300_000;
const PART_UPLOAD_MAX_RETRIES = 2;
const PART_FINISH_MAX_RETRIES = 2;
const PART_FINISH_RETRYABLE_CODE = 40093001;
const PART_FINISH_DEFAULT_TIMEOUT = 120_000;
const PART_FINISH_MAX_TIMEOUT = 600_000;
const COMPLETE_UPLOAD_MAX_RETRIES = 2;
const REQUEST_TIMEOUT = 120_000;

export class UploadDailyLimitExceededError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly fileSize: number,
    message: string
  ) {
    super(message);
    this.name = 'UploadDailyLimitExceededError';
  }
}

export class ChunkedUploader {
  constructor(private readonly request: AxiosInstance) {}

  async upload(
    endpointPath: string,
    filePath: string,
    fileType: MediaFileType,
    options: ChunkedUploadOptions = {}
  ): Promise<MediaUploadResult> {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error(`Invalid upload file: ${filePath}`);

    const fileSize = fileStat.size;
    const fileName = sanitizeFileName(options.fileName || path.basename(filePath));
    const hashes = await computeFileHashes(filePath, fileSize);

    let prepared: UploadPrepareResponse;
    try {
      const { data } = await this.request.post<UploadPrepareResponse>(
        `${endpointPath}/upload_prepare`,
        {
          file_type: fileType,
          file_name: fileName,
          file_size: fileSize,
          ...hashes
        },
        { timeout: REQUEST_TIMEOUT }
      );
      prepared = data;
    } catch (error) {
      if (getErrorCode(error) === 40093002) {
        throw new UploadDailyLimitExceededError(filePath, fileSize, getErrorMessage(error));
      }
      throw error;
    }

    const blockSize = Number(prepared.block_size);
    if (!prepared.upload_id || !Number.isFinite(blockSize) || blockSize <= 0) {
      throw new Error('Invalid upload_prepare response');
    }
    if (!Array.isArray(prepared.parts) || prepared.parts.length === 0) {
      throw new Error('upload_prepare returned no parts');
    }

    const concurrency = clamp(
      Number(prepared.concurrency) || DEFAULT_CONCURRENT_PARTS,
      1,
      MAX_CONCURRENT_PARTS
    );
    const retryTimeout = clamp(
      (Number(prepared.retry_timeout) || PART_FINISH_DEFAULT_TIMEOUT / 1000) * 1000,
      1000,
      PART_FINISH_MAX_TIMEOUT
    );

    let completedParts = 0;
    let uploadedBytes = 0;
    const tasks = prepared.parts.map(part => async () => {
      const partIndex = Number(part.index);
      const offset = (partIndex - 1) * blockSize;
      const partSize = Number(part.block_size) || blockSize;
      const length = Math.min(partSize, fileSize - offset);
      if (!Number.isInteger(partIndex) || partIndex < 1 || length <= 0) {
        throw new Error(`Invalid upload part: ${JSON.stringify(part)}`);
      }

      const chunk = await readFileChunk(filePath, offset, length);
      const md5 = createHash('md5').update(chunk).digest('hex');
      await putToPresignedUrl(part.presigned_url, chunk);
      await this.finishPart(
        endpointPath,
        prepared.upload_id,
        partIndex,
        chunk.length,
        md5,
        retryTimeout
      );

      completedParts++;
      uploadedBytes += chunk.length;
      options.onProgress?.({
        completedParts,
        totalParts: prepared.parts.length,
        uploadedBytes,
        totalBytes: fileSize
      });
    });

    await runWithConcurrency(tasks, concurrency);
    return this.completeUpload(endpointPath, prepared.upload_id);
  }

  private async finishPart(
    endpointPath: string,
    uploadId: string,
    partIndex: number,
    blockSize: number,
    md5: string,
    retryTimeout: number
  ): Promise<void> {
    const body = {
      upload_id: uploadId,
      part_index: partIndex,
      block_size: blockSize,
      md5
    };
    const startedAt = Date.now();
    let normalAttempts = 0;

    while (true) {
      try {
        await this.request.post(`${endpointPath}/upload_part_finish`, body, {
          timeout: REQUEST_TIMEOUT
        });
        return;
      } catch (error) {
        if (getErrorCode(error) === PART_FINISH_RETRYABLE_CODE) {
          if (Date.now() - startedAt >= retryTimeout) throw error;
          await delay(1000);
          continue;
        }

        if (normalAttempts >= PART_FINISH_MAX_RETRIES) throw error;
        await delay(1000 * Math.pow(2, normalAttempts));
        normalAttempts++;
      }
    }
  }

  private async completeUpload(
    endpointPath: string,
    uploadId: string
  ): Promise<MediaUploadResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= COMPLETE_UPLOAD_MAX_RETRIES; attempt++) {
      try {
        const { data } = await this.request.post<MediaUploadResult>(
          `${endpointPath}/files`,
          { upload_id: uploadId },
          { timeout: REQUEST_TIMEOUT }
        );
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < COMPLETE_UPLOAD_MAX_RETRIES) {
          await delay(2000 * Math.pow(2, attempt));
        }
      }
    }
    throw lastError;
  }
}

async function computeFileHashes(filePath: string, fileSize: number): Promise<FileHashes> {
  return new Promise((resolve, reject) => {
    const md5 = createHash('md5');
    const sha1 = createHash('sha1');
    const md5First10m = createHash('md5');
    const needsPartialHash = fileSize > MD5_10M_SIZE;
    let processed = 0;
    const stream = createReadStream(filePath);

    stream.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      md5.update(buffer);
      sha1.update(buffer);
      if (needsPartialHash && processed < MD5_10M_SIZE) {
        const remaining = MD5_10M_SIZE - processed;
        md5First10m.update(buffer.subarray(0, Math.min(buffer.length, remaining)));
      }
      processed += buffer.length;
    });
    stream.on('error', reject);
    stream.on('end', () => {
      const md5Hex = md5.digest('hex');
      resolve({
        md5: md5Hex,
        sha1: sha1.digest('hex'),
        md5_10m: needsPartialHash ? md5First10m.digest('hex') : md5Hex
      });
    });
  });
}

async function readFileChunk(filePath: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    if (bytesRead !== length) {
      throw new Error(`Short read at offset ${offset}: expected ${length}, got ${bytesRead}`);
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

async function putToPresignedUrl(url: string, data: Buffer): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= PART_UPLOAD_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PART_UPLOAD_TIMEOUT);
    try {
      const arrayBuffer = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      ) as ArrayBuffer;
      const response = await fetch(url, {
        method: 'PUT',
        body: new Blob([arrayBuffer]),
        headers: { 'Content-Length': String(data.length) },
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`COS PUT failed: ${response.status} ${response.statusText} ${body}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < PART_UPLOAD_MAX_RETRIES) {
        await delay(1000 * Math.pow(2, attempt));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency: number
): Promise<void> {
  for (let index = 0; index < tasks.length; index += concurrency) {
    await Promise.all(tasks.slice(index, index + concurrency).map(task => task()));
  }
}

function sanitizeFileName(fileName: string): string {
  const name = fileName.split(/[/\\]/).pop()?.replace(/[\u0000-\u001f]/g, '').trim();
  return name || 'file';
}

function getErrorCode(error: unknown): number | undefined {
  const directCode = Number(
    (error as any)?.response?.data?.code ?? (error as any)?.response?.data?.err_code
  );
  if (Number.isFinite(directCode)) return directCode;
  const match = getErrorMessage(error).match(/code\((\d+)\)/);
  return match ? Number(match[1]) : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
