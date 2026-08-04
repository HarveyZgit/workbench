import esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const skillSource = path.join(packageRoot, 'resources/skills/markdown-comment/SKILL.md');
const skillOutput = path.join(packageRoot, 'dist/resources/skills/markdown-comment/SKILL.md');

async function copySkill() {
  await mkdir(path.dirname(skillOutput), { recursive: true });
  await copyFile(skillSource, skillOutput);
}

/** Node 侧：extension.js 由 VS Code 宿主加载；cli.js 作为 markdown-comment 命令给 Agent 用。 */
/** @type {import('esbuild').BuildOptions} */
const nodeOptions = {
  entryPoints: ['src/extension.ts', 'src/cli.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outdir: 'dist',
  // vscode 由宿主在运行时注入，不能打进包里（cli.ts 不引用它）。
  external: ['vscode'],
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** Webview 侧：跑在浏览器沙箱 iframe 里，markdown-it 一起打包，不能有 node banner/external。 */
/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ['src/preview/webview.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/webview.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

if (watch) {
  await copySkill();
  const ctxs = await Promise.all([esbuild.context(nodeOptions), esbuild.context(webviewOptions)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[esbuild] watching…');
} else {
  await Promise.all([esbuild.build(nodeOptions), esbuild.build(webviewOptions)]);
  await copySkill();
}
