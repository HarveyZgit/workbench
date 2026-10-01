import esbuild from 'esbuild';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.join(packageRoot, 'resources/skills/markdown-comment');
const skillSource = path.join(skillDir, 'SKILL.md');
const skillScript = path.join(skillDir, 'scripts/markdown-comment');
const skillOutput = path.join(packageRoot, 'dist/resources/skills/markdown-comment/SKILL.md');
const skillHubDir = path.join(packageRoot, 'dist/skill-hub/markdown-comment');
const obsidianSrcDir = path.join(packageRoot, 'src/adapters/obsidian');
const obsidianOutDir = path.join(packageRoot, 'dist/obsidian');

const PLUGIN_CLI_NOTE = '插件安装时已替换为实际可执行路径';
const PORTABLE_CLI_NOTE =
  '`<skill-dir>` 为本 SKILL.md 所在目录；请用 node 调用同目录 `scripts/markdown-comment`，它会定位本机 CLI';
const PORTABLE_CLI = 'node <skill-dir>/scripts/markdown-comment';

async function copySkill() {
  const source = await readFile(skillSource, 'utf8');
  await mkdir(path.dirname(skillOutput), { recursive: true });
  await writeFile(skillOutput, source.replaceAll('{{CLI_NOTE}}', PLUGIN_CLI_NOTE));

  await mkdir(path.join(skillHubDir, 'scripts'), { recursive: true });
  await writeFile(
    path.join(skillHubDir, 'SKILL.md'),
    source.replaceAll('{{CLI_NOTE}}', PORTABLE_CLI_NOTE).replaceAll('{{CLI}}', PORTABLE_CLI),
  );
  const hubScript = path.join(skillHubDir, 'scripts/markdown-comment');
  await copyFile(skillScript, hubScript);
  await chmod(hubScript, 0o755);
}

/** Obsidian 插件目录需要 main.js + manifest.json + styles.css；manifest 的 version 跟随 package.json。 */
async function copyObsidianAssets() {
  await mkdir(obsidianOutDir, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(obsidianSrcDir, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(path.join(obsidianOutDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await copyFile(path.join(obsidianSrcDir, 'styles.css'), path.join(obsidianOutDir, 'styles.css'));
}

/** Node 侧：extension.js 由 VS Code 宿主加载；cli.js 作为 markdown-comment 命令给 Agent 用；skill-install.js 供纯 node 测试/脚本调用。 */
/** @type {import('esbuild').BuildOptions} */
const nodeOptions = {
  entryPoints: ['src/extension.ts', 'src/cli.ts', 'src/skill-install.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outdir: 'dist',
  // vscode 由宿主在运行时注入，不能打进包里（cli.ts / skill-install.ts 不引用它）。
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
  loader: {
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
  },
  assetNames: 'assets/[name]-[hash]',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/**
 * Obsidian 侧（桌面端 Electron 渲染进程）：obsidian / electron 由宿主注入，node 内置模块用 require。
 * 不带 shebang；`node:` 前缀改写成裸模块名，避免依赖宿主 Electron 对前缀的支持。
 * @type {import('esbuild').BuildOptions}
 */
const obsidianOptions = {
  entryPoints: [path.join(obsidianSrcDir, 'main.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2021',
  outfile: path.join(obsidianOutDir, 'main.js'),
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules],
  plugins: [
    {
      name: 'strip-node-prefix',
      setup(build) {
        build.onResolve({ filter: /^node:/ }, (args) => ({
          path: args.path.slice('node:'.length),
          external: true,
        }));
      },
    },
  ],
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
};

if (watch) {
  await copySkill();
  await copyObsidianAssets();
  const ctxs = await Promise.all([
    esbuild.context(nodeOptions),
    esbuild.context(webviewOptions),
    esbuild.context(obsidianOptions),
  ]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[esbuild] watching…');
} else {
  await Promise.all([
    esbuild.build(nodeOptions),
    esbuild.build(webviewOptions),
    esbuild.build(obsidianOptions),
  ]);
  await copySkill();
  await copyObsidianAssets();
}
