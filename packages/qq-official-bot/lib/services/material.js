"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaterialService = void 0;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_CONTENT_TYPES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};
function validateImage(fileName, contentType, size) {
    const expected = IMAGE_CONTENT_TYPES[(0, node_path_1.extname)(fileName).toLowerCase()];
    if (!expected || expected !== contentType) {
        throw new Error('Image file extension must match contentType (png, jpeg, gif or webp)');
    }
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_IMAGE_SIZE) {
        throw new Error('Image size must be between 1 byte and 10 MiB');
    }
}
class MaterialService {
    constructor(request) {
        this.request = request;
    }
    /** 申请上传；摘要由调用方提供，适用于自行控制二进制上传的场景。 */
    async prepareImageUpload(payload, options = {}) {
        validateImage(payload.file_name, payload.content_type, payload.file_size);
        if (!/^[a-f0-9]{32}$/i.test(payload.md5) || !/^[a-f0-9]{40}$/i.test(payload.sha1)) {
            throw new Error('Invalid image MD5 or SHA1');
        }
        const { data } = await this.request.post('/v2/media-images/prepare', payload, options);
        return data;
    }
    /** md5 必须使用 COS PUT 响应的 ETag，去掉两端引号。 */
    async completeImageUpload(payload, options = {}) {
        if (!payload.upload_id || !/^[a-f0-9]{32}$/i.test(payload.md5)) {
            throw new Error('Missing upload_id or invalid image MD5');
        }
        const { data } = await this.request.post('/v2/media-images/complete', payload, options);
        return data;
    }
    async uploadImage(file, options = {}) {
        options.signal?.throwIfAborted();
        const { timeout = 30000, signal } = options;
        if (!Number.isFinite(timeout) || timeout < 0) {
            throw new Error('timeout must be a non-negative finite number');
        }
        const fileName = options.fileName ?? (typeof file === 'string' ? (0, node_path_1.basename)(file) : '');
        const contentType = options.contentType ?? (typeof file === 'string' ? IMAGE_CONTENT_TYPES[(0, node_path_1.extname)(fileName).toLowerCase()] : undefined);
        if (!fileName || !contentType) {
            throw new Error('A supported fileName and contentType are required');
        }
        let data;
        if (typeof file === 'string') {
            const info = await (0, promises_1.stat)(file);
            if (!info.isFile())
                throw new Error('Image path must point to a regular file');
            validateImage(fileName, contentType, info.size);
            data = await (0, promises_1.readFile)(file, { signal });
        }
        else {
            validateImage(fileName, contentType, file.length);
            // 保持摘要与实际上传内容一致，避免调用方在异步上传中修改 Buffer。
            data = Buffer.from(file);
        }
        validateImage(fileName, contentType, data.length);
        signal?.throwIfAborted();
        const md5 = (0, node_crypto_1.createHash)('md5').update(data).digest('hex');
        const sha1 = (0, node_crypto_1.createHash)('sha1').update(data).digest('hex');
        const prepared = await this.prepareImageUpload({
            file_name: fileName,
            file_size: data.length,
            content_type: contentType,
            md5,
            sha1,
        }, { timeout, signal });
        if (!prepared.upload_id)
            throw new Error('Invalid image prepare response: missing upload_id');
        const url = new URL(prepared.presigned_url);
        if (url.protocol !== 'https:' || url.username || url.password) {
            throw new Error('Image prepare response must contain an HTTPS upload URL');
        }
        signal?.throwIfAborted();
        const uploadSignal = timeout > 0 ? AbortSignal.timeout(timeout) : undefined;
        // 预签名地址不使用 bot.request，避免附带 QQBot 鉴权头。
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': contentType },
            body: new Uint8Array(data),
            signal: signal && uploadSignal ? AbortSignal.any([signal, uploadSignal]) : signal ?? uploadSignal,
            redirect: 'error',
        });
        await response.body?.cancel();
        if (!response.ok)
            throw new Error(`Image upload failed with HTTP ${response.status}`);
        const etag = response.headers.get('etag')?.replace(/^"|"$/g, '');
        if (!etag || !/^[a-f0-9]{32}$/i.test(etag) || etag.toLowerCase() !== md5) {
            throw new Error('Image upload returned a missing or mismatched MD5 ETag');
        }
        signal?.throwIfAborted();
        return this.completeImageUpload({ upload_id: prepared.upload_id, md5: etag }, { timeout, signal });
    }
    /** 首页省略 cursor；next_cursor 为空表示末页。 */
    async listImages(cursor, options = {}) {
        const { data } = await this.request.get('/v2/media-images', {
            ...options,
            params: cursor ? { cursor } : undefined,
        });
        return data;
    }
    /** 删除后引用立即失效，已发送消息中的图片副本不受影响。 */
    async deleteImage(imageId, options = {}) {
        if (!imageId)
            throw new Error('imageId is required');
        await this.request.delete(`/v2/media-images/${encodeURIComponent(imageId)}/delete`, options);
    }
}
exports.MaterialService = MaterialService;
