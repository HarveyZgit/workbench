// 存储桥接：与 CLI / VS Code 共用 storage.ts 的同一份 store，这里只补「定位目录 / 文档键 / 监听」。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileHash, loadDoc, readStorageDir, saveDoc } from '../../storage';
import type { StoredDocument } from '../../types';

/** 与 extension.ts 的 recentSelfWrite 同一口径：自己刚写的文件 1.5 s 内的 watch 事件忽略。 */
const SELF_WRITE_WINDOW_MS = 1500;

/**
 * 文档键 = vault 根目录绝对路径 + 笔记 vault 内路径。与 VS Code 的 `uri.fsPath` 一致，
 * 所以同一篇笔记在两边 sha1 相同、看到同一组线程。
 */
export function docKeyOf(vaultBasePath: string, filePath: string): string {
  return path.join(vaultBasePath, filePath);
}

export class CommentStore {
  private readonly recentSelfWrite = new Map<string, number>();
  private watcher: fs.FSWatcher | null = null;

  /** @param settingDir 插件设置里的「存储目录」，仅在环境变量和 pointer.json 都没有时使用。 */
  constructor(private readonly settingDir: () => string) {}

  /** MARKDOWN_COMMENT_STORAGE_DIR → ~/.markdown-comment/pointer.json → 插件设置。 */
  dir(): string | null {
    return readStorageDir() || this.settingDir().trim() || null;
  }

  load(key: string): StoredDocument {
    const dir = this.dir();
    return dir ? loadDoc(dir, key) : { version: 1, threads: [] };
  }

  /** 读最新 → 最小改动 → 写回，与 CLI 共用 saveDoc（无并发锁，与 VS Code 现状一致）。 */
  mutate(key: string, fn: (doc: StoredDocument) => void): boolean {
    const dir = this.dir();
    if (!dir) {
      return false;
    }
    const doc = loadDoc(dir, key);
    fn(doc);
    this.recentSelfWrite.set(fileHash(key), Date.now());
    saveDoc(dir, key, doc);
    return true;
  }

  /** 监听 `<store>/docs`，onChange 收到被外部改动的文档 hash（CLI reply / resolve、VS Code 写入等）。 */
  startWatch(onChange: (hash: string) => void): void {
    this.stopWatch();
    const dir = this.dir();
    if (!dir) {
      return;
    }
    const docsDir = path.join(dir, 'docs');
    try {
      fs.mkdirSync(docsDir, { recursive: true });
      this.watcher = fs.watch(docsDir, (_event, filename) => {
        if (!filename) {
          return;
        }
        const hash = String(filename).replace(/\.json$/, '');
        if (Date.now() - (this.recentSelfWrite.get(hash) || 0) < SELF_WRITE_WINDOW_MS) {
          return;
        }
        onChange(hash);
      });
    } catch {
      // 某些平台 / 文件系统不支持 fs.watch：自动刷新降级，不影响其余功能。
    }
  }

  stopWatch(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
