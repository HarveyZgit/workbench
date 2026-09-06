import * as esbuild from 'esbuild';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const executableMode = 0o755;
const outExt = path.join(packageRoot, 'dist/chrome-mv3');
await import(pathToFileURL(path.join(packageRoot, 'scripts/generate-icons.mjs')).href);

await esbuild.build({
  entryPoints: {
    cli: path.join(packageRoot, 'src/cli.ts'),
    'native-host': path.join(packageRoot, 'src/native-host/host.ts'),
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: path.join(packageRoot, 'dist'),
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  logLevel: 'info',
});
await chmod(path.join(packageRoot, 'dist/cli.js'), executableMode);
await chmod(path.join(packageRoot, 'dist/native-host.js'), executableMode);

await mkdir(outExt, { recursive: true });
await esbuild.build({
  entryPoints: {
    background: path.join(packageRoot, 'src/adapters/extension/background.ts'),
    content: path.join(packageRoot, 'src/adapters/extension/content.ts'),
    sidepanel: path.join(packageRoot, 'src/adapters/extension/sidepanel.ts'),
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  outdir: outExt,
  sourcemap: true,
  logLevel: 'info',
});

await copyFile(
  path.join(packageRoot, 'src/adapters/extension/sidepanel.html'),
  path.join(outExt, 'sidepanel.html'),
);

const ext = JSON.parse(await readFile(path.join(packageRoot, 'chrome-extension.json'), 'utf8'));
const manifest = {
  manifest_version: 3,
  name: 'DOM Comment',
  description: '在页面上标记元素、文字或区域并评论',
  version: '0.0.2',
  key: ext.key,
  action: {
    default_title: '进入标注模式',
    default_icon: { 16: 'icon-plus-16.png', 32: 'icon-plus-32.png' },
  },
  background: { service_worker: 'background.js', type: 'module' },
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*', 'file:///*'],
      js: ['content.js'],
      run_at: 'document_idle',
    },
  ],
  side_panel: { default_path: 'sidepanel.html' },
  permissions: ['nativeMessaging', 'storage', 'sidePanel', 'contextMenus', 'scripting', 'clipboardWrite'],
  host_permissions: ['<all_urls>'],
  commands: {
    'toggle-annotate': {
      suggested_key: { default: 'Ctrl+Period', mac: 'Command+Period' },
      description: '切换标注模式',
    },
    'open-side-panel': {
      description: '打开页内评论列表',
    },
  },
  icons: {
    16: 'icon-plus-16.png',
    32: 'icon-plus-32.png',
  },
};
await writeFile(path.join(outExt, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

for (const name of ['icon-plus-16.png', 'icon-plus-32.png', 'icon-x-16.png', 'icon-x-32.png']) {
  await copyFile(path.join(packageRoot, 'public', name), path.join(outExt, name));
}
