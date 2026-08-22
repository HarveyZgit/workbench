import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { encodeFrame, tryDecodeFrames, type HostResponse } from '../native-host/protocol.js';
import { defaultStorageDir, packageRoot } from '../paths.js';
import { hostSockPath } from '../storage/index.js';

const HOST_NAME = 'com.workbench.dom_comment';

const BROWSERS: { name: string; profileRoot: string }[] = [
  {
    name: 'Google Chrome',
    profileRoot: path.join(os.homedir(), 'Library/Application Support/Google/Chrome'),
  },
  {
    name: 'Chrome Canary',
    profileRoot: path.join(os.homedir(), 'Library/Application Support/Google/Chrome Canary'),
  },
  { name: 'Chromium', profileRoot: path.join(os.homedir(), 'Library/Application Support/Chromium') },
];

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

export function readExtensionId(override?: string): string {
  if (override) {
    return override;
  }
  const file = path.join(packageRoot(), 'chrome-extension.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { id?: string };
  if (!raw.id) {
    fail('chrome-extension.json 缺少 id');
  }
  return raw.id;
}

export function cmdInstallHost(flags: Map<string, string | true>, opts?: { quiet?: boolean }): void {
  const root = packageRoot();
  const nativeJs = path.join(root, 'dist/native-host.js');
  if (!fs.existsSync(nativeJs)) {
    fail('请先构建 native-host（rushx build）');
  }
  const nodeBin = process.execPath;
  const wrapper = path.join(root, 'dist/native-host-wrapper.sh');
  const wrapperBody = `#!/bin/sh\nexec "${nodeBin}" "${nativeJs}" "$@"\n`;
  fs.writeFileSync(wrapper, wrapperBody, { mode: 0o755 });
  fs.chmodSync(wrapper, 0o755);

  const id = readExtensionId(
    typeof flags.get('extension-id') === 'string' ? String(flags.get('extension-id')) : undefined,
  );
  const dataDir = defaultStorageDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const runtime = {
    storageDir: dataDir,
    cliPath: path.join(root, 'dist/cli.js'),
    nodePath: nodeBin,
  };
  fs.writeFileSync(path.join(dataDir, 'runtime.json'), `${JSON.stringify(runtime, null, 2)}\n`, 'utf8');

  const written: string[] = [];
  const skipped: string[] = [];
  const manifest = {
    name: HOST_NAME,
    description: 'DOM Comment native host',
    path: wrapper,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`],
  };
  for (const browser of BROWSERS) {
    if (!fs.existsSync(browser.profileRoot) || !fs.statSync(browser.profileRoot).isDirectory()) {
      skipped.push(`${browser.name}（无配置目录）`);
      continue;
    }
    const nmDir = path.join(browser.profileRoot, 'NativeMessagingHosts');
    fs.mkdirSync(nmDir, { recursive: true });
    const dest = path.join(nmDir, `${HOST_NAME}.json`);
    fs.writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    written.push(dest);
  }
  if (!opts?.quiet) {
    process.stdout.write(`WRITTEN:\n${written.map((w) => `  ${w}`).join('\n') || '  （无）'}\n`);
    process.stdout.write(`SKIPPED:\n${skipped.map((w) => `  ${w}`).join('\n') || '  （无）'}\n`);
  }
  if (written.length === 0) {
    fail('未找到 Chrome/Chromium 配置目录');
  }
  if (!opts?.quiet) {
    process.stdout.write(
      `下一步：chrome://extensions → 开发者模式 → 加载 ${path.join(root, '.output/chrome-mv3')}\n`,
    );
  }
}

export function cmdUninstallHost(): void {
  for (const browser of BROWSERS) {
    const dest = path.join(browser.profileRoot, 'NativeMessagingHosts', `${HOST_NAME}.json`);
    try {
      fs.unlinkSync(dest);
      process.stdout.write(`已删除 ${dest}\n`);
    } catch {
      // missing
    }
  }
}

function pointerNodePath(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(defaultStorageDir(), 'runtime.json'), 'utf8')) as {
      nodePath?: string;
    };
    if (raw.nodePath && fs.existsSync(raw.nodePath)) {
      if (raw.nodePath !== process.execPath) {
        process.stderr.write('wrapper 仍指向旧 Node，与当前 shell 不一致。若扩展连不上 host，请重跑 setup\n');
      }
      return raw.nodePath;
    }
  } catch {
    // ignore
  }
  return process.execPath;
}

export function cmdPingHost(): void {
  const root = packageRoot();
  const nativeJs = path.join(root, 'dist/native-host.js');
  if (!fs.existsSync(nativeJs)) {
    fail('请先构建 native-host');
  }
  const child = spawn(pointerNodePath(), [nativeJs], { stdio: ['pipe', 'pipe', 'inherit'] });
  const req = { id: 'ping-1', op: 'ping' };
  child.stdin.write(encodeFrame(req));
  let buf = Buffer.alloc(0);
  const timer = setTimeout(() => {
    child.kill();
    fail('ping-host 超时');
  }, 3000);
  child.stdout.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages } = tryDecodeFrames(buf);
    const msg = messages[0] as HostResponse | undefined;
    if (!msg) {
      return;
    }
    clearTimeout(timer);
    child.stdin.end();
    child.kill();
    if (!msg.ok) {
      fail(msg.error);
    }
    process.stdout.write('pong\n');
    process.exit(0);
  });
}

export function cmdOpenTab(tabId: number): void {
  const sock = hostSockPath();
  if (!fs.existsSync(sock)) {
    fail('Chrome 未连接本地宿主。请先打开 Chrome 并确保扩展已加载。请先查看该评论的截图。');
  }
  const conn = net.createConnection(sock);
  const id = `cli-focus-${Date.now()}`;
  const timer = setTimeout(() => {
    conn.destroy();
    fail('聚焦超时。请先查看该评论的截图。');
  }, 3000);
  conn.on('connect', () => {
    conn.write(encodeFrame({ id, op: 'focusTab', tabId }));
  });
  let buf = Buffer.alloc(0);
  conn.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { messages } = tryDecodeFrames(buf);
    const msg = messages[0] as HostResponse | undefined;
    if (!msg) {
      return;
    }
    clearTimeout(timer);
    conn.end();
    if (!msg.ok) {
      fail(msg.error || '无法聚焦该标签。请先查看该评论的截图。');
    }
    process.stdout.write('ok\n');
  });
  conn.on('error', () => {
    clearTimeout(timer);
    fail('Chrome 未连接本地宿主。请先打开 Chrome 并确保扩展已加载。请先查看该评论的截图。');
  });
}

export function cmdInstallSkill(targets: string[]): void {
  if (targets.length === 0) {
    fail('用法：dom-comment install-skill --target <skill-root>');
  }
  const canonical = path.join(packageRoot(), 'resources/skills/dom-comment');
  const locator = path.join(canonical, 'scripts/dom-comment');
  if (!fs.existsSync(path.join(canonical, 'SKILL.md')) || !fs.existsSync(locator)) {
    fail('找不到 Skill 源文件');
  }
  fs.chmodSync(locator, 0o755);
  for (const target of targets) {
    const dest = path.join(path.resolve(target), 'dom-comment');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const st = fs.lstatSync(dest);
      if (!st.isSymbolicLink()) {
        process.stderr.write(`跳过 ${dest}（已存在且不是本工具管理的软链）\n`);
        continue;
      }
      fs.unlinkSync(dest);
    } catch {
      // missing
    }
    fs.symlinkSync(canonical, dest);
    process.stdout.write(`已链接 ${dest} → ${canonical}\n`);
  }
}

export function cmdSetup(flags: Map<string, string | true>, extraTargets: string[]): void {
  const root = packageRoot();
  const extDir = path.join(root, '.output/chrome-mv3');
  if (!fs.existsSync(path.join(root, 'dist/cli.js')) || !fs.existsSync(extDir)) {
    fail('请先构建：在 packages/dom-comment 运行 rushx build（或 rushx setup）');
  }
  cmdInstallHost(flags, { quiet: true });
  process.stdout.write('已安装本机写入宿主（Chrome Native Messaging）。\n');

  const agentsSkills = path.join(os.homedir(), '.agents/skills');
  const targets = [...extraTargets];
  if (targets.length === 0 && fs.existsSync(agentsSkills)) {
    targets.push(agentsSkills);
  }
  if (targets.length > 0) {
    cmdInstallSkill(targets);
  } else {
    process.stdout.write(
      '未找到 ~/.agents/skills，已跳过 Skill。需要时：dom-comment install-skill --target <dir>\n',
    );
  }

  try {
    spawn('open', [extDir], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // ignore
  }
  process.stdout.write(`
还差一步（Chrome 不允许脚本代装扩展）：
  1. chrome://extensions → 打开「开发者模式」
  2. 「加载已解压的扩展程序」→ 选中已打开的文件夹
     ${extDir}
装过之后刷新扩展即可。以后改代码再 rushx setup 会覆盖 host 和 Skill。
`);
}
