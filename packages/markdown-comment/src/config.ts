// ~/.markdown-comment/config.json —— 浏览器预览同步间隔等本机配置。
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const DEFAULT_SYNC_INTERVAL_SECONDS = 5;
export const MIN_SYNC_INTERVAL_SECONDS = 1;
export const MAX_SYNC_INTERVAL_SECONDS = 300;
export const DEFAULT_IDLE_EXIT_MS = 15 * 60 * 1000;
export const DEFAULT_PREVIEW_PORT = 8765;
export const DEFAULT_PREVIEW_HOST = '127.0.0.1';

export interface MarkdownCommentConfig {
  syncIntervalSeconds?: number;
}

export function configFilePath(): string {
  return path.join(os.homedir(), '.markdown-comment', 'config.json');
}

export function clampSyncIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SYNC_INTERVAL_SECONDS;
  }
  return Math.min(MAX_SYNC_INTERVAL_SECONDS, Math.max(MIN_SYNC_INTERVAL_SECONDS, Math.round(value)));
}

export function readUserConfig(): MarkdownCommentConfig {
  try {
    const data = JSON.parse(fs.readFileSync(configFilePath(), 'utf8')) as unknown;
    if (!data || typeof data !== 'object') {
      return {};
    }
    const raw = (data as { syncIntervalSeconds?: unknown }).syncIntervalSeconds;
    if (typeof raw === 'number') {
      return { syncIntervalSeconds: clampSyncIntervalSeconds(raw) };
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * 同步间隔（秒）：CLI 显式值 > 环境变量 > 用户配置 > 默认 5。
 */
export function resolveSyncIntervalSeconds(cliValue?: number): number {
  if (cliValue !== undefined) {
    return clampSyncIntervalSeconds(cliValue);
  }
  const env = process.env.MARKDOWN_COMMENT_SYNC_INTERVAL;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed)) {
      return clampSyncIntervalSeconds(parsed);
    }
  }
  return readUserConfig().syncIntervalSeconds ?? DEFAULT_SYNC_INTERVAL_SECONDS;
}
