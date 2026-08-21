// 纯 node 模块（不依赖 vscode），插件运行时与 markdown-comment CLI 共用。
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { StoredDocument, StoredThread } from './types';

// 指针文件：固定在用户主目录，记录插件 globalStorage 的真实路径，
// 让脱离 VS Code 的 CLI 也能找到评论数据。
const POINTER_DIR = path.join(os.homedir(), '.markdown-comment');
const POINTER_FILE = path.join(POINTER_DIR, 'pointer.json');

export function writePointer(storageDir: string): void {
  fs.mkdirSync(POINTER_DIR, { recursive: true });
  fs.writeFileSync(POINTER_FILE, `${JSON.stringify({ storageDir }, null, 2)}\n`, 'utf8');
}

export function readStorageDir(): string | null {
  // 显式覆盖优先（测试 / CI / Agent 指定）。
  if (process.env.MARKDOWN_COMMENT_STORAGE_DIR) {
    return process.env.MARKDOWN_COMMENT_STORAGE_DIR;
  }
  try {
    const data = JSON.parse(fs.readFileSync(POINTER_FILE, 'utf8'));
    if (data && typeof data.storageDir === 'string') {
      return data.storageDir;
    }
  } catch {
    // 指针不存在：插件还没启动过。
  }
  return null;
}

export function fileHash(absPath: string): string {
  return createHash('sha1').update(absPath).digest('hex');
}

function docsDir(storageDir: string): string {
  return path.join(storageDir, 'docs');
}

export function docFile(storageDir: string, absPath: string): string {
  return path.join(docsDir(storageDir), `${fileHash(absPath)}.json`);
}

function indexFile(storageDir: string): string {
  return path.join(storageDir, 'index.json');
}

interface IndexEntry {
  path: string;
  updatedAt: string;
}
// hash → { 原始绝对路径, 更新时间 }，让 CLI 能反查 hash 对应哪个 markdown。
type Index = Record<string, IndexEntry>;

function readIndex(storageDir: string): Index {
  try {
    return JSON.parse(fs.readFileSync(indexFile(storageDir), 'utf8')) as Index;
  } catch {
    return {};
  }
}

function writeIndex(storageDir: string, idx: Index): void {
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(indexFile(storageDir), `${JSON.stringify(idx, null, 2)}\n`, 'utf8');
}

export function loadDoc(storageDir: string, absPath: string): StoredDocument {
  try {
    const data = JSON.parse(fs.readFileSync(docFile(storageDir, absPath), 'utf8'));
    if (data && Array.isArray(data.threads)) {
      return data as StoredDocument;
    }
  } catch {
    // 没有评论。
  }
  return { version: 1, threads: [] };
}

export function saveDoc(storageDir: string, absPath: string, data: StoredDocument): void {
  const file = docFile(storageDir, absPath);
  const idx = readIndex(storageDir);
  const h = fileHash(absPath);
  if (data.threads.length === 0) {
    try {
      fs.unlinkSync(file);
    } catch {
      // 本就不存在。
    }
    delete idx[h];
    writeIndex(storageDir, idx);
    return;
  }
  fs.mkdirSync(docsDir(storageDir), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  idx[h] = { path: absPath, updatedAt: new Date().toISOString() };
  writeIndex(storageDir, idx);
}

export function listAll(storageDir: string): { path: string; doc: StoredDocument }[] {
  const idx = readIndex(storageDir);
  return Object.values(idx).map((entry) => ({ path: entry.path, doc: loadDoc(storageDir, entry.path) }));
}

/** 按完整 id 或 id 前缀定位线程；前缀命中多条（歧义）时返回 null。 */
export function findThread(
  storageDir: string,
  threadIdOrPrefix: string,
): { path: string; doc: StoredDocument; thread: StoredThread } | null {
  const hits: { path: string; doc: StoredDocument; thread: StoredThread }[] = [];
  for (const { path, doc } of listAll(storageDir)) {
    for (const thread of doc.threads) {
      if (thread.id === threadIdOrPrefix) {
        return { path, doc, thread }; // 完整匹配优先
      }
      if (thread.id.startsWith(threadIdOrPrefix)) {
        hits.push({ path, doc, thread });
      }
    }
  }
  return hits.length === 1 ? hits[0] : null;
}
