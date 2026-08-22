import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StoredTabFile, StoredThread } from '../core/types.js';
import { defaultStorageDir } from '../paths.js';

export function hostSockPath(): string {
  return path.join(resolveStorageDir(), 'host.sock');
}

export function resolveStorageDir(): string {
  if (process.env.DOM_COMMENT_STORAGE_DIR) {
    return process.env.DOM_COMMENT_STORAGE_DIR;
  }
  return defaultStorageDir();
}

function sessionFile(dir: string): string {
  return path.join(dir, '.session');
}

const SESSION_NOISE_BYTES = 2;

export function newSessionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  return `${stamp}-${randomBytes(SESSION_NOISE_BYTES).toString('hex')}`;
}

export function currentSession(dir: string): string {
  try {
    const id = fs.readFileSync(sessionFile(dir), 'utf8').trim();
    if (id) {
      return id;
    }
  } catch {
    // missing
  }
  const id = newSessionId();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile(dir), `${id}\n`, 'utf8');
  return id;
}

export function writeSession(dir: string, sessionId: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sessionFile(dir), `${sessionId}\n`, 'utf8');
}

export function urlHash(canonicalUrl: string): string {
  return createHash('sha1').update(canonicalUrl).digest('hex');
}

export function tabJsonPath(dir: string, tabId: number): string {
  return path.join(dir, `${tabId}.json`);
}

export function tabShotDir(dir: string, tabId: number): string {
  return path.join(dir, String(tabId));
}

export function screenshotRelPath(canonicalUrl: string, threadId: string): string {
  return `${urlHash(canonicalUrl)}/${threadId}.png`;
}

export function screenshotAbsPath(dir: string, tabId: number, rel: string): string {
  return path.join(tabShotDir(dir, tabId), rel);
}

function emptyTab(tabId: number, sessionId: string): StoredTabFile {
  return {
    version: 1,
    tabId,
    sessionId,
    updatedAt: new Date().toISOString(),
    pages: {},
  };
}

export function loadTab(dir: string, tabId: number): StoredTabFile {
  const file = tabJsonPath(dir, tabId);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredTabFile;
    if (data && data.version === 1 && data.pages && typeof data.pages === 'object') {
      return data;
    }
  } catch {
    // missing or invalid
  }
  return emptyTab(tabId, currentSession(dir));
}

/** Load for write: rotate a leftover tab file from another Chrome session. */
export function prepareTab(dir: string, tabId: number, sessionId = currentSession(dir)): StoredTabFile {
  const file = tabJsonPath(dir, tabId);
  if (!fs.existsSync(file)) {
    return emptyTab(tabId, sessionId);
  }
  const loaded = loadTab(dir, tabId);
  if (loaded.sessionId !== sessionId) {
    rotateIfStale(dir, emptyTab(tabId, sessionId));
    return emptyTab(tabId, sessionId);
  }
  return loaded;
}

function isEmptyTab(tab: StoredTabFile): boolean {
  return Object.values(tab.pages).every((page) => page.threads.length === 0);
}

function atomicWriteFile(file: string, contents: string): void {
  const folder = path.dirname(file);
  fs.mkdirSync(folder, { recursive: true });
  const tmp = path.join(folder, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

function moveIfExists(from: string, to: string): void {
  if (!fs.existsSync(from)) {
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function rotateIfStale(dir: string, tab: StoredTabFile): void {
  const file = tabJsonPath(dir, tab.tabId);
  if (!fs.existsSync(file)) {
    return;
  }
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredTabFile;
    if (existing.sessionId && existing.sessionId !== tab.sessionId) {
      const archiveDir = path.join(dir, 'archive');
      const stem = `${existing.sessionId}-${tab.tabId}`;
      moveIfExists(file, path.join(archiveDir, `${stem}.json`));
      moveIfExists(tabShotDir(dir, tab.tabId), path.join(archiveDir, stem));
    }
  } catch {
    // unreadable current file: overwrite
  }
}

function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

export function saveTab(dir: string, tab: StoredTabFile): void {
  fs.mkdirSync(dir, { recursive: true });
  rotateIfStale(dir, tab);
  writeTabFile(dir, tab);
}

function writeTabFile(dir: string, tab: StoredTabFile): void {
  const file = tabJsonPath(dir, tab.tabId);
  if (isEmptyTab(tab)) {
    try {
      fs.unlinkSync(file);
    } catch {
      // gone
    }
    rmrf(tabShotDir(dir, tab.tabId));
    return;
  }
  const jsonIndent = 2;
  atomicWriteFile(file, `${JSON.stringify(tab, null, jsonIndent)}\n`);
}

function copyMissingTree(from: string, to: string): void {
  if (!fs.existsSync(from)) {
    return;
  }
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
}

function mergePages(into: StoredTabFile, from: StoredTabFile): number {
  let added = 0;
  for (const [url, page] of Object.entries(from.pages || {})) {
    if (!into.pages[url]) {
      into.pages[url] = { ...page, threads: [...page.threads] };
      added += page.threads.length;
      continue;
    }
    const byId = new Map(into.pages[url].threads.map((thread) => [thread.id, thread]));
    for (const thread of page.threads) {
      const existing = byId.get(thread.id);
      if (!existing) {
        into.pages[url].threads.push(thread);
        byId.set(thread.id, thread);
        added += 1;
        continue;
      }
      if (thread.comments.length > existing.comments.length) {
        const idx = into.pages[url].threads.indexOf(existing);
        into.pages[url].threads[idx] = thread;
        byId.set(thread.id, thread);
      }
    }
  }
  return added;
}

function archiveEntriesForTab(dir: string, tabId: number): { json: string; shots: string }[] {
  const archiveDir = path.join(dir, 'archive');
  let names: string[] = [];
  try {
    names = fs.readdirSync(archiveDir);
  } catch {
    return [];
  }
  const suffix = `-${tabId}.json`;
  const out: { json: string; shots: string }[] = [];
  for (const name of names) {
    if (!name.endsWith(suffix)) {
      continue;
    }
    const json = path.join(archiveDir, name);
    const shots = path.join(archiveDir, name.slice(0, -'.json'.length));
    out.push({ json, shots });
  }
  return out;
}

/** Pull mistakenly archived comments back for tabs that are still open (extension reload). */
export function reclaimLiveTabs(dir: string, tabIds: number[], sessionId: string): number {
  let added = 0;
  for (const tabId of tabIds) {
    if (!Number.isInteger(tabId) || tabId <= 0) {
      continue;
    }
    const archives = archiveEntriesForTab(dir, tabId);
    if (archives.length === 0) {
      const existing = loadTab(dir, tabId);
      if (existing.sessionId !== sessionId && !isEmptyTab(existing)) {
        existing.sessionId = sessionId;
        existing.updatedAt = new Date().toISOString();
        writeTabFile(dir, existing);
      }
      continue;
    }
    const tab = loadTab(dir, tabId);
    for (const arch of archives) {
      try {
        const loaded = JSON.parse(fs.readFileSync(arch.json, 'utf8')) as StoredTabFile;
        added += mergePages(tab, loaded);
        copyMissingTree(arch.shots, tabShotDir(dir, tabId));
      } catch {
        // skip unreadable archive
      }
    }
    tab.sessionId = sessionId;
    tab.updatedAt = new Date().toISOString();
    writeTabFile(dir, tab);
    for (const arch of archives) {
      try {
        fs.unlinkSync(arch.json);
      } catch {
        // gone
      }
      rmrf(arch.shots);
    }
  }
  return added;
}

export function writeScreenshot(dir: string, tabId: number, rel: string, png: Buffer): void {
  const abs = screenshotAbsPath(dir, tabId, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, png);
}

export function listTabIds(dir: string): number[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const ids: number[] = [];
  for (const name of names) {
    const match = /^(\d+)\.json$/.exec(name);
    if (match) {
      ids.push(Number(match[1]));
    }
  }
  return ids.sort((a, b) => a - b);
}

export interface ThreadHit {
  tab: StoredTabFile;
  url: string;
  thread: StoredThread;
}

export function findThread(dir: string, threadIdOrPrefix: string): ThreadHit | null {
  const exact: ThreadHit[] = [];
  const prefix: ThreadHit[] = [];
  for (const tabId of listTabIds(dir)) {
    const tab = loadTab(dir, tabId);
    if (tab.sessionId !== currentSession(dir)) {
      continue;
    }
    for (const [url, page] of Object.entries(tab.pages)) {
      for (const thread of page.threads) {
        if (thread.id === threadIdOrPrefix) {
          exact.push({ tab, url, thread });
        } else if (thread.id.startsWith(threadIdOrPrefix)) {
          prefix.push({ tab, url, thread });
        }
      }
    }
  }
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    return null;
  }
  return prefix.length === 1 ? prefix[0] : null;
}
