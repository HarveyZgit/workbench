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

export function defaultStorageDir(): string {
  return path.join(packageRoot(), 'data');
}
