// markdown-comment CLI —— 给 Agent 读取/回复评论（list/reply/resolve），以及浏览器预览 / 扩展路径。
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  listAll,
  loadDoc,
  saveDoc,
  findThread,
  resolveDocKey,
  getCliId,
  isUntitledStorageKey,
  ensureStorageDir,
} from './storage';
import { hasMarkdownExtension } from './markdown-lang';
import { DEFAULT_PREVIEW_HOST, DEFAULT_PREVIEW_PORT, resolveSyncIntervalSeconds } from './config';
import { probePreviewServer, requestOpenFile, startPreviewServer } from './preview/web-server';
import type { StoredComment, StoredThread } from './types';

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function getStorageDir(): string {
  return ensureStorageDir();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function packageRoot(): string {
  const here = path.resolve(__dirname);
  return path.basename(here) === 'dist' ? path.dirname(here) : path.resolve(here, '..');
}

const [, , cmd, ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 30) => {
  const t = oneLine(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const shortId = (id: string) => id.slice(0, 8);

function readLine(absFile: string, lineIdx: number): string {
  try {
    return clip(fs.readFileSync(absFile, 'utf8').split(/\r?\n/)[lineIdx] ?? '');
  } catch {
    return '';
  }
}

/** 线程标题：区分全文、Mermaid 整图/节点、普通划词和整行评论。 */
function headOf(absFile: string, t: StoredThread): string {
  if (t.anchor.kind === 'document') {
    return '- [全文]';
  }
  const start = t.anchor.startLine + 1;
  const end = t.anchor.endLine + 1;
  const loc = end > start ? `L${start}-${end}` : `L${start}`;
  const quote = t.anchor.rendered?.quote || t.anchor.quote;
  if (t.anchor.target?.kind === 'mermaid-node') {
    const label = quote.trim() || t.anchor.target.nodeId;
    return `- [Mermaid 节点:${t.anchor.target.nodeId}] ${loc} 「${clip(label)}」`;
  }
  if (t.anchor.target?.kind === 'mermaid-diagram') {
    return `- [Mermaid 图] ${loc} 「${clip(quote || 'Mermaid 图')}」`;
  }
  if (quote.trim()) {
    return `- [划词] ${loc} 「${clip(quote)}」`;
  }
  return `- [整行] ${loc} 「${readLine(absFile, t.anchor.startLine) || '(空行)'}」`;
}

/** p 是否在 base 目录（含子目录）下。 */
function isUnder(base: string, p: string): boolean {
  const rel = path.relative(base, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 展示路径：untitled 优先 cliId（Skill 提示同源）；文件在 cwd 下转相对路径。 */
function displayPath(abs: string, cliId?: string): string {
  if (abs.startsWith('untitled:')) {
    return cliId ?? abs;
  }
  const rel = path.relative(process.cwd(), abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : abs;
}

function fileTextOf(absFile: string): string | null {
  try {
    return fs.readFileSync(absFile, 'utf8');
  } catch {
    return null;
  }
}

/**
 * 失联判定：划词锚点的源码 quote 在当前文件文本里搜不到 —— 与预览 relocate 失败等价（原文已删/被完整替换）。
 * 失联评论原文已不在，回复也无意义，`list` 默认隐藏（同预览）。text=null（文件读不到）/ 空 quote / 全文评论 → 不算失联。
 */
function mermaidBlockAtOrNear(text: string, line: number): boolean {
  const lines = text.split(/\r?\n/);
  for (let candidate = Math.min(Math.max(0, line), lines.length - 1); candidate >= 0; candidate--) {
    if (/^(?: {0,3})(`{3,}|~{3,})\s*mermaid(?:\s.*)?$/i.test(lines[candidate])) {
      return true;
    }
    if (/^(?: {0,3})(`{3,}|~{3,})\s*$/.test(lines[candidate])) {
      break;
    }
  }
  return false;
}

function anchorState(
  text: string | null,
  anchor: StoredThread['anchor'],
): { orphaned: boolean; diagramFallback: boolean } {
  if (anchor.kind === 'document' || !anchor.quote || text === null) {
    return { orphaned: false, diagramFallback: false };
  }
  if (text.includes(anchor.quote)) {
    return { orphaned: false, diagramFallback: false };
  }
  if (
    (anchor.target?.kind === 'mermaid-node' || anchor.target?.kind === 'mermaid-diagram') &&
    mermaidBlockAtOrNear(text, anchor.startLine)
  ) {
    return { orphaned: false, diagramFallback: anchor.target.kind === 'mermaid-node' };
  }
  return { orphaned: true, diagramFallback: false };
}

function cmdList(): void {
  const storageDir = getStorageDir();
  const global = flags.has('--global') || rest.includes('-g');
  const fileArg = args.find((a) => a !== '-g');
  let docs = fileArg
    ? (() => {
        const key = resolveDocKey(fileArg, storageDir);
        return [{ path: key, doc: loadDoc(storageDir, key), cliId: getCliId(storageDir, key) }];
      })()
    : listAll(storageDir);
  const scoped = !fileArg && !global;
  if (scoped) {
    const cwd = process.cwd();
    // untitled 键不是真实路径；path.relative(cwd, 'untitled:…') 会误判为 cwd 下文件。
    docs = docs.filter(({ path: p }) => !isUntitledStorageKey(p) && isUnder(cwd, p));
  }

  const showHidden = flags.has('--hidden');

  if (flags.has('--json')) {
    const out = [];
    for (const { path: p, doc } of docs) {
      const text = fileTextOf(p);
      for (const t of doc.threads) {
        if (flags.has('--open') && t.status !== 'open') {
          continue;
        }
        const state = anchorState(text, t.anchor);
        const { orphaned } = state;
        if (orphaned && !showHidden) {
          continue;
        }
        out.push({
          threadId: t.id,
          file: p,
          status: t.status,
          orphaned,
          line: t.anchor.kind === 'document' ? null : t.anchor.startLine + 1,
          quote: t.anchor.quote,
          renderedQuote: t.anchor.rendered?.quote,
          target: t.anchor.target,
          diagramFallback: state.diagramFallback,
          comments: t.comments.map((c) => ({ author: c.author, body: c.body })),
        });
      }
    }
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }

  const nameOnly = flags.has('--name-only');
  const blocks: string[] = [];
  for (const { path: p, doc, cliId } of docs) {
    const text = fileTextOf(p);
    const threads = doc.threads.filter((t) => {
      const state = anchorState(text, t.anchor);
      return (!flags.has('--open') || t.status === 'open') && (showHidden || !state.orphaned);
    });
    if (threads.length === 0) {
      continue;
    }
    if (nameOnly) {
      blocks.push(`${displayPath(p, cliId)}  ${threads.length} 条`);
      continue;
    }
    const lines = [displayPath(p, cliId)];
    for (const t of threads) {
      const status = t.status === 'resolved' ? ' [已解决]' : '';
      const state = anchorState(text, t.anchor);
      const anchorStatus = state.orphaned ? ' [失联]' : state.diagramFallback ? ' [降级到整图]' : '';
      lines.push(`${headOf(p, t)}  #${shortId(t.id)}${status}${anchorStatus}`);
      for (const c of t.comments) {
        lines.push(`    - ${c.author}: ${oneLine(c.body)}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  const empty = scoped ? '（当前目录下没有评论；加 -g 看全部）' : '（没有评论）';
  process.stdout.write(`${blocks.join(nameOnly ? '\n' : '\n\n') || empty}\n`);
}

function cmdReply(): void {
  const storageDir = getStorageDir();
  const threadId = args[0];
  const body = args.slice(1).join(' ');
  if (!threadId || !body) {
    fail('用法: markdown-comment reply <threadId> <text>');
  }
  const found = findThread(storageDir, threadId);
  if (!found) {
    fail(`未找到 thread（或前缀不唯一）: ${threadId}`);
  }
  const comment: StoredComment = {
    id: randomUUID(),
    author: 'agent',
    body,
    createdAt: new Date().toISOString(),
  };
  found.thread.comments.push(comment);
  saveDoc(storageDir, found.path, found.doc);
  process.stdout.write(`OK: 已回复 #${shortId(found.thread.id)}\n`);
}

function cmdResolve(): void {
  const storageDir = getStorageDir();
  const threadId = args[0];
  if (!threadId) {
    fail('用法: markdown-comment resolve <threadId>');
  }
  const found = findThread(storageDir, threadId);
  if (!found) {
    fail(`未找到 thread（或前缀不唯一）: ${threadId}`);
  }
  found.thread.status = 'resolved';
  saveDoc(storageDir, found.path, found.doc);
  process.stdout.write(`OK: 已标记已解决 #${shortId(found.thread.id)}\n`);
}

function flagValue(name: string): string | undefined {
  const idx = rest.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx < 0) {
    return undefined;
  }
  const token = rest[idx];
  if (token.startsWith(`${name}=`)) {
    return token.slice(name.length + 1);
  }
  const next = rest[idx + 1];
  return next && !next.startsWith('--') ? next : undefined;
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    process.stderr.write(`无法自动打开浏览器: ${err}\n`);
  }
}

function cmdExtension(): void {
  const target = (args[0] ?? '').toLowerCase();
  const root = packageRoot();
  if (!target || target === 'help' || target === '--help' || target === '-h') {
    process.stdout.write(
      [
        'markdown-comment extension <vscode|zed>',
        '',
        '  vscode   打印 VS Code VSIX 绝对路径',
        '  zed      打印可 Install Dev Extension 的 Zed 扩展目录',
        '',
      ].join('\n'),
    );
    return;
  }
  if (target === 'vscode' || target === 'vsix' || target === 'code') {
    const vsix = path.join(root, 'dist', 'vscode-markdown-comment.vsix');
    if (!fs.existsSync(vsix)) {
      fail(`VSIX 不存在: ${vsix}\n请先在 package 目录执行 rushx package`);
    }
    const abs = path.resolve(vsix);
    process.stdout.write(`${abs}\n`);
    process.stdout.write(`hint: code --install-extension ${shellQuote(abs)} --force\n`);
    return;
  }
  if (target === 'zed') {
    const dir = path.join(root, 'zed');
    if (!fs.existsSync(path.join(dir, 'extension.toml'))) {
      fail(`Zed 扩展目录不完整: ${dir}`);
    }
    const abs = path.resolve(dir);
    process.stdout.write(`${abs}
`);
    process.stdout.write(
      [
        'hint: 推荐先用 Task（无需 Rust）：把该目录 tasks.json 合并进 ~/.config/zed/tasks.json，',
        '      然后 task: spawn → Markdown Comment: 打开评论预览',
        'hint: 若要 /mdc-preview：先 rustup + `rustup target add wasm32-wasip1`（勿用 Homebrew rust），',
        '      再 Zed → Extensions → Install Dev Extension… → 选择该目录',
        'hint: 编译失败看 ~/Library/Logs/Zed/Zed.log；本目录可先 `cargo build --target wasm32-wasip1 --release`',
        '',
      ].join('
'),
    );
    return;
  }
  fail(`未知 extension 目标: ${target}（可用 vscode 或 zed）`);
}

async function cmdPreview(): Promise<void> {
  const fileArg = args[0];
  if (!fileArg) {
    fail(
      '用法: markdown-comment preview <file.md> [--port 8765] [--sync-interval 5] [--no-open] [--detach] [--no-reuse]',
    );
  }
  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`文件不存在: ${filePath}`);
  }
  if (!hasMarkdownExtension(filePath)) {
    fail(`不是 Markdown 文件: ${filePath}`);
  }
  const portRaw = flagValue('--port');
  const port = portRaw ? Number(portRaw) : DEFAULT_PREVIEW_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    fail(`无效端口: ${portRaw}`);
  }
  const intervalRaw = flagValue('--sync-interval');
  const syncIntervalSeconds = resolveSyncIntervalSeconds(
    intervalRaw !== undefined ? Number(intervalRaw) : undefined,
  );
  const syncIntervalMs = syncIntervalSeconds * 1000;
  const noOpen = flags.has('--no-open');
  const detach = flags.has('--detach');
  const noReuse = flags.has('--no-reuse');
  const host = DEFAULT_PREVIEW_HOST;

  if (detach && process.env.MDC_PREVIEW_DETACHED !== '1') {
    const logPath = path.join(os.homedir(), '.markdown-comment', 'preview-detach.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, 'w');
    const childArgv = process.argv.slice(1).filter((a) => a !== '--detach');
    const child = spawn(process.execPath, childArgv, {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, MDC_PREVIEW_DETACHED: '1' },
    });
    fs.closeSync(logFd);
    child.unref();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      let text = '';
      try {
        text = fs.readFileSync(logPath, 'utf8');
      } catch {
        continue;
      }
      const m = text.match(/url:\s+(\S+)/);
      if (m) {
        process.stdout.write(text);
        process.stdout.write(`(detached pid ${child.pid}; stop: kill ${child.pid})\n`);
        process.exit(0);
      }
      if (/文件不存在|不是 Markdown|无效端口|Failed to bind/.test(text)) {
        process.stderr.write(text);
        process.exit(1);
      }
    }
    fail(`preview 启动超时，见 ${logPath}`);
  }

  if (port > 0 && !noReuse) {
    const existing = await probePreviewServer(host, port);
    if (existing?.ok) {
      const opened = await requestOpenFile(host, port, filePath);
      if (opened?.url) {
        process.stdout.write('Markdown Comment preview (reused)\n');
        process.stdout.write(`  file:    ${filePath}\n`);
        process.stdout.write(`  storage: ${getStorageDir()}\n`);
        process.stdout.write(`  url:     ${opened.url}\n`);
        process.stdout.write(`  sync:    ${syncIntervalSeconds}s\n`);
        if (!noOpen) {
          openBrowser(opened.url);
        }
        return;
      }
    }
  }

  const storageDir = getStorageDir();
  const distDir = path.basename(__dirname) === 'dist' ? __dirname : path.join(packageRoot(), 'dist');
  let server;
  try {
    server = await startPreviewServer({
      storageDir,
      port,
      host,
      distDir,
      syncIntervalMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (port > 0 && /EADDRINUSE/.test(message) && !noReuse) {
      const opened = await requestOpenFile(host, port, filePath);
      if (opened?.url) {
        process.stdout.write('Markdown Comment preview (reused)\n');
        process.stdout.write(`  file:    ${filePath}\n`);
        process.stdout.write(`  storage: ${storageDir}\n`);
        process.stdout.write(`  url:     ${opened.url}\n`);
        process.stdout.write(`  sync:    ${syncIntervalSeconds}s\n`);
        if (!noOpen) {
          openBrowser(opened.url);
        }
        return;
      }
    }
    fail(message);
  }
  server.openFile(filePath);
  const url = server.urlFor(filePath);
  process.stdout.write('Markdown Comment preview\n');
  process.stdout.write(`  file:    ${filePath}\n`);
  process.stdout.write(`  storage: ${storageDir}\n`);
  process.stdout.write(`  url:     ${url}\n`);
  process.stdout.write(`  sync:    ${syncIntervalSeconds}s（保存按钮 / 关页会立即写入）\n`);
  process.stdout.write(process.env.MDC_PREVIEW_DETACHED === '1' ? '后台运行中\n' : '按 Ctrl+C 停止\n');
  if (!noOpen) {
    openBrowser(url);
  }
  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

function printHelp(): void {
  process.stdout.write(
    [
      'markdown-comment <command>',
      '',
      '  extension vscode|zed              打印 VS Code VSIX 或 Zed 扩展目录的绝对路径',
      '  preview <file.md> [--port 8765] [--sync-interval 5] [--no-open] [--detach] [--no-reuse]',
      '                                  启动本机评论预览（按间隔同步，默认 5s；Save / 关页立即写入）',
      '  list [file] [-g] [--open] [--name-only] [--hidden] [--json]',
      '                                  列出评论。默认只看当前目录（含子目录）下的文档、且隐藏失联评论；',
      '                                  -g/--global 看全局；指定 file 只看该文件；--open 只看未解决；',
      '                                  --hidden 连已隐藏的失联评论（原文已删/被替换）一并列出（标 [失联]）；',
      '                                  --name-only 只列文件+条数；--json 输出原始 JSON。本地文件路径显示为相对路径',
      '  reply <threadId> <text>         以 Agent 身份回复（threadId 可用前 8 位短 id）',
      '  resolve <threadId>              把线程标记为已解决',
      '',
    ].join('\n'),
  );
}

switch (cmd) {
  case 'list':
    cmdList();
    break;
  case 'reply':
    cmdReply();
    break;
  case 'resolve':
    cmdResolve();
    break;
  case 'extension':
    cmdExtension();
    break;
  case 'preview':
    void cmdPreview().catch((err) => {
      fail(err instanceof Error ? err.message : String(err));
    });
    break;
  default:
    printHelp();
}
