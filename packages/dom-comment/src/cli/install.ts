import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { encodeFrame, tryDecodeFrames, type HostResponse } from '../native-host/protocol.js';
import { extensionDir, packageRoot, skillSourceDir } from '../paths.js';
import { hostSockPath, resolveStorageDir } from '../storage/index.js';
import {
  isOtherChecked,
  loadSkillPrefs,
  runPicker,
  saveSkillPrefs,
  selectedSkillRoots,
} from './skill-picker.js';

const HOST_NAME = 'com.workbench.dom_comment';

export function chromeNativeMessagingProfileRoots(
  homeDir: string = os.homedir(),
): { name: string; profileRoot: string }[] {
  return [
    {
      name: 'Google Chrome',
      profileRoot: path.join(homeDir, 'Library/Application Support/Google/Chrome'),
    },
    {
      name: 'Chrome Canary',
      profileRoot: path.join(homeDir, 'Library/Application Support/Google/Chrome Canary'),
    },
    { name: 'Chromium', profileRoot: path.join(homeDir, 'Library/Application Support/Chromium') },
    {
      name: 'Google Chrome (Linux)',
      profileRoot: path.join(homeDir, '.config/google-chrome'),
    },
    {
      name: 'Chromium (Linux)',
      profileRoot: path.join(homeDir, '.config/chromium'),
    },
  ];
}

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') {
    return os.homedir();
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

/** Existing `~/.<name>/skills` directories. No vendor names. */
export function detectAgentSkillRoots(homeDir: string = os.homedir()): string[] {
  const found: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(homeDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.name.startsWith('.')) {
      continue;
    }
    const skillsDir = path.join(homeDir, entry.name, 'skills');
    try {
      if (fs.statSync(skillsDir).isDirectory()) {
        found.push(skillsDir);
      }
    } catch {
      // no skills/ here
    }
  }
  return found.sort();
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

function printExtensionHint(): void {
  process.stdout.write(
    `\nChrome 扩展目录：\n  ${extensionDir()}\n在 chrome://extensions 打开开发者模式，加载该文件夹。\n也可运行：dom-comment extension\n`,
  );
}

export function cmdInstallHost(flags: Map<string, string | true>, opts?: { quiet?: boolean }): void {
  const root = packageRoot();
  const nativeJs = path.join(root, 'dist/native-host.js');
  if (!fs.existsSync(nativeJs)) {
    fail('找不到 native-host。请从 npm 安装完整包，或在源码树运行构建。');
  }
  const nodeBin = process.execPath;
  const dataDir = resolveStorageDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const wrapper = path.join(dataDir, 'native-host-wrapper.sh');
  const wrapperBody = `#!/bin/sh\nexec "${nodeBin}" "${nativeJs}" "$@"\n`;
  fs.writeFileSync(wrapper, wrapperBody, { mode: 0o755 });
  fs.chmodSync(wrapper, 0o755);

  const id = readExtensionId(
    typeof flags.get('extension-id') === 'string' ? String(flags.get('extension-id')) : undefined,
  );
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
  for (const browser of chromeNativeMessagingProfileRoots()) {
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
    printExtensionHint();
  }
}

export function cmdUninstallHost(): void {
  for (const browser of chromeNativeMessagingProfileRoots()) {
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
    const raw = JSON.parse(fs.readFileSync(path.join(resolveStorageDir(), 'runtime.json'), 'utf8')) as {
      nodePath?: string;
    };
    if (raw.nodePath && fs.existsSync(raw.nodePath)) {
      if (raw.nodePath !== process.execPath) {
        process.stderr.write(
          'wrapper 仍指向旧 Node，与当前 shell 不一致。若扩展连不上 host，请重跑 install-skill\n',
        );
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
    fail('找不到 native-host');
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
  const canonical = skillSourceDir();
  const locator = path.join(canonical, 'scripts/dom-comment');
  if (!fs.existsSync(path.join(canonical, 'SKILL.md')) || !fs.existsSync(locator)) {
    fail('找不到 Skill 源文件');
  }
  fs.chmodSync(locator, 0o755);
  for (const target of targets) {
    const dest = path.join(expandHome(target), 'dom-comment');
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

export function cmdExtension(): void {
  const dir = extensionDir();
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    fail('找不到扩展产物。请从 npm 安装完整包，或在源码树运行构建。');
  }
  process.stdout.write(`${dir}\n`);
}

function readStdinChunk(stdin: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: string | Buffer) => {
      cleanup();
      resolve(String(chunk));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.off('error', onError);
    };
    stdin.once('data', onData);
    stdin.once('error', onError);
  });
}

async function askOtherPath(): Promise<string | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('其他路径：')).trim();
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

export async function promptSkillTargets(): Promise<string[] | null> {
  const found = detectAgentSkillRoots();
  const { targets: last } = loadSkillPrefs(resolveStorageDir());
  const { stdin } = process;
  if (typeof stdin.setRawMode !== 'function') {
    return [];
  }
  const wasRaw = stdin.isRaw;
  stdin.resume();
  stdin.setEncoding('utf8');
  try {
    const state = await runPicker(found, last, {
      write: (text) => {
        process.stdout.write(text);
      },
      readChunk: () => readStdinChunk(stdin),
      setRawMode: (enabled) => {
        stdin.setRawMode(enabled);
      },
    });
    if (state.status === 'aborted') {
      return null;
    }
    let extra = '';
    if (isOtherChecked(state.checked, found.length)) {
      const typed = await askOtherPath();
      if (typed === null) {
        return null;
      }
      extra = typed ? expandHome(typed) : '';
    }
    return selectedSkillRoots(found, state.checked, extra);
  } finally {
    stdin.setRawMode(Boolean(wasRaw));
  }
}

export function finishSkillSelection(targets: string[] | null): void {
  if (targets === null) {
    fail('已取消。');
  }
  if (targets.length > 0) {
    cmdInstallSkill(targets);
  } else {
    process.stdout.write('已跳过 Skill。\n');
  }
  saveSkillPrefs(resolveStorageDir(), targets);
  printExtensionHint();
}

export function cmdInstall(flags: Map<string, string | true>, targets: string[]): void {
  cmdInstallHost(flags, { quiet: true });
  process.stdout.write('已登记 Chrome Native Messaging。\n');
  if (targets.length > 0) {
    const abs = targets.map((dir) => expandHome(dir));
    cmdInstallSkill(abs);
    saveSkillPrefs(resolveStorageDir(), abs);
  } else {
    process.stdout.write('未安装 Skill。需要时：dom-comment install-skill --target <dir>\n');
  }
  printExtensionHint();
}

export async function cmdInstallInteractive(flags: Map<string, string | true>): Promise<void> {
  cmdInstallHost(flags, { quiet: true });
  process.stdout.write('已登记 Chrome Native Messaging。\n');
  finishSkillSelection(await promptSkillTargets());
}
