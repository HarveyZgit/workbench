// Document identity helpers that do not require a VS Code workspace folder.
// Saved files are keyed by absolute fsPath (same contract as storageKey).
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StorageUriLike } from './storage';
import { storageKey } from './storage';

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

/** True when two file fsPaths refer to the same location (raw + realpath). */
export function sameFileFsPath(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  if (normalizeFileFsPath(a) === normalizeFileFsPath(b)) {
    return true;
  }
  const realA = realpathOrNull(a);
  const realB = realpathOrNull(b);
  return realA !== null && realB !== null && realA === realB;
}

/**
 * Same markdown document? file: compares absolute fsPath (no workspace needed);
 * untitled / other schemes keep toString() identity (Untitled-N / cliId flows).
 */
export function sameDocumentUri(a: StorageUriLike, b: StorageUriLike): boolean {
  if (a.scheme === 'file' && b.scheme === 'file') {
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
 * Implicit workspace root for a saved file when no folder is open:
 * the file's directory. Untitled / non-file → undefined.
 */
export function implicitFileWorkspaceRoot(uri: { scheme: string; fsPath: string }): string | undefined {
  if (uri.scheme !== 'file' || !uri.fsPath) {
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

/** Read a saved markdown file by absolute fsPath. Missing/unreadable → undefined. */
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

/** Stable identity used for storage / matching; file: is always the absolute fsPath. */
export function documentStorageKey(uri: StorageUriLike): string {
  return storageKey(uri);
}
