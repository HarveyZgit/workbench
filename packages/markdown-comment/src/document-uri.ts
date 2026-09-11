// Document identity helpers that do not require a VS Code workspace folder.
// Saved local files (file: / vscode-local:) are keyed by absolute fsPath.
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StorageUriLike } from './storage';
import { storageKey } from './storage';
import { isLocalPathScheme, isSavedDocumentScheme, isUntitledScheme } from './uri-scheme';

/** Shown when preview/anchors cannot obtain source text (deleted, moved, or remote×local). */
export const SOURCE_UNREADABLE_MESSAGE =
  '无法读取源 Markdown。若这是远程窗口中的本机文件，请保持源标签打开（扩展主机无法直接读本机路径）；文件也可能已删除或移动。';

export function unsupportedSchemeMessage(scheme: string): string {
  return `不支持在 ${scheme} 方案下评论此 Markdown。请在本地窗口打开本机文件，或在远程窗口打开远程文件。`;
}

/** Normalize a file fsPath for equality (path.normalize + Windows drive letter). */
export function normalizeFileFsPath(fsPath: string): string {
  const normalized = path.normalize(fsPath);
  if (process.platform === 'win32' && /^[A-Za-z]:/.test(normalized)) {
    return normalized[0].toUpperCase() + normalized.slice(1);
  }
  return normalized;
}

function realpathOrNull(fsPath: string): string | null {
  try {
    return fs.realpathSync.native(fsPath);
  } catch {
    return null;
  }
}

function nodePathExists(fsPath: string): boolean {
  try {
    return fs.existsSync(fsPath);
  } catch {
    return false;
  }
}

/**
 * True when two file fsPaths refer to the same location.
 * Realpath is only used when both paths exist on this host — a remote Extension Host
 * must not require realpath of a Mac/Windows path it cannot see.
 */
export function sameFileFsPath(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  if (normalizeFileFsPath(a) === normalizeFileFsPath(b)) {
    return true;
  }
  if (!nodePathExists(a) || !nodePathExists(b)) {
    return false;
  }
  const realA = realpathOrNull(a);
  const realB = realpathOrNull(b);
  return realA !== null && realB !== null && realA === realB;
}

/**
 * Same markdown document?
 * - file: / vscode-local: compare absolute fsPath (no workspace, no realpath required)
 * - untitled / vscode-remote / other schemes keep toString() identity
 */
export function sameDocumentUri(a: StorageUriLike, b: StorageUriLike): boolean {
  if (isLocalPathScheme(a.scheme) && isLocalPathScheme(b.scheme)) {
    return sameFileFsPath(a.fsPath, b.fsPath);
  }
  return a.toString() === b.toString();
}

export function findMatchingDocument<T extends { uri: StorageUriLike }>(
  documents: readonly T[],
  uri: StorageUriLike,
): T | undefined {
  return documents.find((doc) => sameDocumentUri(doc.uri, uri));
}

/**
 * Implicit workspace root for a saved file when no folder contains it:
 * the file's directory. Untitled / non-saved → undefined.
 */
export function implicitFileWorkspaceRoot(uri: { scheme: string; fsPath: string }): string | undefined {
  if (!isSavedDocumentScheme(uri.scheme) || !uri.fsPath) {
    return undefined;
  }
  return path.dirname(uri.fsPath);
}

/**
 * Resolve a local resource path without requiring workspaceFolders.
 * `/foo` is workspace-root style when a folder (or implicit file dir) is known.
 */
export function resolveLocalResourcePath(
  decodedPath: string,
  fileFsPath: string | undefined,
  workspaceFolderFsPath: string | undefined,
): string | null {
  if (!decodedPath) {
    return null;
  }
  if (decodedPath.startsWith('/')) {
    const root = workspaceFolderFsPath ?? (fileFsPath ? path.dirname(fileFsPath) : undefined);
    return root ? path.resolve(root, `.${decodedPath}`) : decodedPath;
  }
  if (!fileFsPath) {
    return null;
  }
  return path.resolve(path.dirname(fileFsPath), decodedPath);
}

/**
 * How to obtain document text when the editor tab may be gone.
 * Prefer the original URI / workspace.fs; only use Node fs when this host can see the path.
 */
export type DocumentContentAttempt =
  | { type: 'open'; via: 'original' | 'file-uri' | 'fsPath' | 'vscode-local' }
  | { type: 'read'; via: 'workspace-fs' | 'workspace-fs-vscode-local' | 'node-fs' };

export function documentContentAttempts(
  uri: { scheme: string; fsPath: string },
  options: { nodeCanReadFsPath: boolean; remoteName?: string | null },
): DocumentContentAttempt[] {
  if (isUntitledScheme(uri.scheme)) {
    return [{ type: 'open', via: 'original' }];
  }

  const attempts: DocumentContentAttempt[] = [{ type: 'open', via: 'original' }];
  if (uri.scheme === 'file' && uri.fsPath && options.nodeCanReadFsPath) {
    attempts.push({ type: 'open', via: 'file-uri' }, { type: 'open', via: 'fsPath' });
  }

  const rewriteToVscodeLocal =
    uri.scheme === 'file' && Boolean(options.remoteName) && Boolean(uri.fsPath) && !options.nodeCanReadFsPath;
  if (rewriteToVscodeLocal) {
    attempts.push({ type: 'open', via: 'vscode-local' });
  }

  if (isSavedDocumentScheme(uri.scheme)) {
    attempts.push({ type: 'read', via: 'workspace-fs' });
  }
  if (rewriteToVscodeLocal) {
    attempts.push({ type: 'read', via: 'workspace-fs-vscode-local' });
  }
  if (isLocalPathScheme(uri.scheme) && uri.fsPath && options.nodeCanReadFsPath) {
    attempts.push({ type: 'read', via: 'node-fs' });
  }
  return attempts;
}

/**
 * Read a saved markdown file by absolute fsPath (Node). Missing/unreadable → undefined.
 * Callers on a Remote Extension Host should prefer vscode.workspace.fs / TextDocument.
 */
export function readSavedMarkdownText(absPath: string): string | undefined {
  if (!absPath || !path.isAbsolute(absPath)) {
    return undefined;
  }
  try {
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return undefined;
  }
}

/** Stable identity used for storage / matching; file: / vscode-local: use absolute fsPath. */
export function documentStorageKey(uri: StorageUriLike): string {
  return storageKey(uri);
}
