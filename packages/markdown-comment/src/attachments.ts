/** Portable local image attachments. Draft bytes never enter the store before submission. */
import fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StoredAttachment } from './types';

export type { AttachmentInput } from './types';
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL = 30 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

export function attachmentDirectory(storageDir: string): string {
  return path.join(storageDir, 'attachments');
}

function safeDirectory(storageDir: string, create = false): string {
  if (create) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  const root = fs.realpathSync(storageDir);
  const directory = path.join(root, 'attachments');
  if (create && !fs.existsSync(directory)) {
    fs.mkdirSync(directory);
  }
  if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory) {
    throw new Error('附件目录不能是符号链接');
  }
  return directory;
}

export function attachmentPath(storageDir: string, id: string): string {
  if (!ID.test(id)) {
    throw new Error('无效的附件标识');
  }
  const directory = safeDirectory(storageDir);
  const file = path.join(directory, id);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file) {
    throw new Error('附件路径不安全');
  }
  return file;
}

function imageType(bytes: Buffer): { mime: string; extension: string } | undefined {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217
  ) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) {
    return { mime: 'image/gif', extension: 'gif' };
  }
  if (
    bytes.length >= 16 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return undefined;
}

/** Validate the entire ordered batch before writing any bytes. Existing IDs must belong to this comment. */
export function prepareAttachments(
  storageDir: string,
  input: unknown,
  existing: StoredAttachment[] = [],
): {
  attachments: StoredAttachment[];
  rollback: () => void;
} {
  if (input === undefined) {
    return {
      attachments: existing,
      rollback: () => {
        /* No new files to roll back. */
      },
    };
  }
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENTS) {
    throw new Error('最多添加 10 张图片');
  }
  const seen = new Set<string>();
  let total = 0;
  const pending: Array<{ attachment: StoredAttachment; bytes?: Buffer }> = input.map((item: unknown) => {
    if (!item || typeof item !== 'object') {
      throw new Error('无效的附件');
    }
    const value = item as Record<string, unknown>;
    if ('id' in value) {
      if (typeof value.id !== 'string' || seen.has(value.id)) {
        throw new Error('无效或重复的附件');
      }
      const attachment = existing.find((candidate) => candidate.id === value.id);
      if (!attachment) {
        throw new Error('附件不属于当前评论');
      }
      let { size } = attachment;
      try {
        size = fs.statSync(attachmentPath(storageDir, attachment.id)).size;
      } catch (error) {
        // A missing original may still be retained while editing text. Unsafe
        // paths/symlinks and all other read failures are never accepted.
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
          throw error;
        }
      }
      if (!Number.isInteger(size) || size < 0 || size > MAX_ATTACHMENT_SIZE) {
        throw new Error('单张图片不能超过 10 MiB');
      }
      total += size;
      seen.add(value.id);
      return { attachment: { ...attachment, size } };
    }
    if (
      typeof value.name !== 'string' ||
      !value.name.trim() ||
      value.name.length > 255 ||
      // eslint-disable-next-line no-control-regex -- Reject control bytes in display filenames.
      /[\x00-\x1f\x7f]/.test(value.name) ||
      typeof value.mime !== 'string' ||
      typeof value.data !== 'string'
    ) {
      throw new Error('无效的图片信息');
    }
    if (
      value.data.length > Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4 ||
      value.data.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/.test(value.data)
    ) {
      throw new Error('图片编码无效或超过 10 MiB');
    }
    const bytes = Buffer.from(value.data, 'base64');
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_SIZE || bytes.toString('base64') !== value.data) {
      throw new Error('图片编码无效或超过 10 MiB');
    }
    const type = imageType(bytes);
    if (!type || type.mime !== value.mime) {
      throw new Error('仅支持内容与类型一致的 PNG、JPEG、GIF、WebP 图片');
    }
    total += bytes.length;
    return {
      attachment: {
        id: `${randomUUID()}.${type.extension}`,
        name: value.name,
        mime: type.mime,
        size: bytes.length,
      },
      bytes,
    };
  });
  if (total > MAX_ATTACHMENT_TOTAL) {
    throw new Error('图片总大小不能超过 30 MiB');
  }
  const created: string[] = [];
  const rollback = () => {
    for (const file of created) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* Preserve original failure. */
      }
    }
  };
  try {
    if (pending.some((item) => item.bytes)) {
      const directory = safeDirectory(storageDir, true);
      for (const item of pending) {
        if (!item.bytes) {
          continue;
        }
        const file = path.join(directory, item.attachment.id);
        const descriptor = fs.openSync(file, 'wx', 0o600);
        created.push(file);
        try {
          fs.writeFileSync(descriptor, item.bytes);
        } finally {
          fs.closeSync(descriptor);
        }
      }
    }
    return { attachments: pending.map((item) => item.attachment), rollback };
  } catch (error) {
    rollback();
    throw error;
  }
}
