import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Package root whether running from src/ or bundled dist/*.js */
export function packageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const base = path.basename(here);
  if (base === 'dist' || base === 'src') {
    return path.dirname(here);
  }
  return path.resolve(here, '..');
}

export function isSourceTree(root = packageRoot()): boolean {
  return fs.existsSync(path.join(root, 'src', 'cli.ts'));
}

export function extensionDir(root = packageRoot()): string {
  return path.join(root, 'dist', 'chrome-mv3');
}

export function skillSourceDir(root = packageRoot()): string {
  return path.join(root, 'resources', 'skills', 'dom-comment');
}

export function defaultStorageDir(): string {
  if (isSourceTree()) {
    return path.join(packageRoot(), 'data');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dom-comment');
  }
  return path.join(os.homedir(), '.dom-comment');
}
