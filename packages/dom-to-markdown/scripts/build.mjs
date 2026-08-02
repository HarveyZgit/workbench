import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(packageRoot, 'src');
const outputRoot = path.join(packageRoot, 'dist');

await rm(outputRoot, { force: true, recursive: true });
await mkdir(path.join(outputRoot, 'lib'), { recursive: true });

await Promise.all([
  cp(path.join(sourceRoot, 'background.js'), path.join(outputRoot, 'background.js')),
  cp(path.join(sourceRoot, 'content.js'), path.join(outputRoot, 'content.js')),
  cp(path.join(sourceRoot, 'manifest.json'), path.join(outputRoot, 'manifest.json')),
  cp(path.join(sourceRoot, 'lib', 'turndown.js'), path.join(outputRoot, 'lib', 'turndown.js')),
]);
