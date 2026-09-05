#!/usr/bin/env node
/**
 * Zed task helper: resolve markdown-comment CLI and run `preview <file>`.
 * Looks for (in order):
 *   1. MARKDOWN_COMMENT_CLI
 *   2. `markdown-comment` on PATH
 *   3. harveyz.vscode-markdown-comment-* extension dist/cli.js under common editor dirs
 *   4. Sibling workbench package dist/cli.js (dev monorepo)
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: preview.mjs <absolute-or-relative-markdown-file>');
  process.exit(2);
}
const md = path.resolve(fileArg);
if (!fs.existsSync(md)) {
  console.error(`File not found: ${md}`);
  process.exit(1);
}

const home = os.homedir();
const extRoots = [
  path.join(home, '.vscode/extensions'),
  path.join(home, '.vscode-insiders/extensions'),
  path.join(home, '.cursor/extensions'),
  path.join(home, '.cursor-server/extensions'),
  path.join(home, '.trae/extensions'),
  path.join(home, '.trae-cn/extensions'),
];

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function fromPath() {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const names = process.platform === 'win32' ? ['markdown-comment.cmd', 'markdown-comment'] : ['markdown-comment'];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return { cmd: candidate, args: [] };
    }
  }
  return null;
}

function fromExtensions() {
  const prefix = 'harveyz.vscode-markdown-comment-';
  // also accept old publisher for transition
  const prefixes = [prefix, 'corehr-fe.vscode-markdown-comment-'];
  let best = null;
  for (const root of extRoots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!prefixes.some((p) => name.startsWith(p))) continue;
      const cli = path.join(root, name, 'dist', 'cli.js');
      if (!isFile(cli)) continue;
      if (!best || name > best.name) best = { name, cli };
    }
  }
  return best ? { cmd: process.execPath, args: [best.cli] } : null;
}

function fromMonorepo() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cli = path.resolve(here, '../../dist/cli.js');
  return isFile(cli) ? { cmd: process.execPath, args: [cli] } : null;
}

function resolveCli() {
  if (process.env.MARKDOWN_COMMENT_CLI) {
    const p = process.env.MARKDOWN_COMMENT_CLI;
    if (p.endsWith('.js')) return { cmd: process.execPath, args: [p] };
    return { cmd: p, args: [] };
  }
  return fromPath() || fromExtensions() || fromMonorepo();
}

const resolved = resolveCli();
if (!resolved) {
  console.error(
    [
      '找不到 markdown-comment CLI。',
      '请先安装 VS Code 扩展 harveyz.vscode-markdown-comment，或把 CLI 放到 PATH，',
      '或设置 MARKDOWN_COMMENT_CLI 指向 dist/cli.js。',
    ].join('\n'),
  );
  process.exit(1);
}

const args = [...resolved.args, 'preview', md];
console.log(`Running: ${resolved.cmd} ${args.join(' ')}`);
const child = spawn(resolved.cmd, args, { stdio: 'inherit', env: process.env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
