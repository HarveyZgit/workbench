import { clip, foldWhitespace } from '../core/anchor.js';
import { kindLabel, quoteOf } from '../core/markdown.js';
import {
  cmdExtension,
  cmdInstall,
  cmdInstallHost,
  cmdInstallInteractive,
  cmdOpenTab,
  cmdPingHost,
  cmdUninstallHost,
} from './install.js';
import { canonicalizeUrl } from '../core/identity.js';
import { reply as opsReply, resolve as opsResolve } from '../core/ops.js';
import { LIST_QUOTE_CLIP } from '../core/types.js';
import type { StoredPage, StoredThread } from '../core/types.js';
import {
  currentSession,
  findThread,
  listBatches,
  loadTab,
  resolveStorageDir,
  saveTab,
  screenshotAbsPath,
} from '../storage/index.js';

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

const SHORT_ID_LEN = 8;

function shortId(id: string): string {
  return id.slice(0, SHORT_ID_LEN);
}

function headOf(thread: StoredThread): string {
  const extra = thread.anchor.kind === 'element' && thread.anchor.tagName ? ` ${thread.anchor.tagName}` : '';
  const shot = thread.screenshot ? '截图' : '无截图';
  const num = thread.number ? ` ${thread.number}.` : '';
  return `- [${kindLabel(thread.anchor)}]${extra}${num} 「${clip(quoteOf(thread.anchor), LIST_QUOTE_CLIP)}」  #${shortId(thread.id)}  [${shot}]`;
}

function parseArgs(argv: string[]): { cmd: string; flags: Map<string, string | true>; rest: string[] } {
  const [cmd = '', ...raw] = argv;
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (token.startsWith('--')) {
      const key = token.slice(ARGV_AFTER_NODE_AND_SCRIPT);
      const next = raw[i + 1];
      if (next && !next.startsWith('--')) {
        flags.set(key, next);
        i += 1;
      } else {
        flags.set(key, true);
      }
    } else {
      rest.push(token);
    }
  }
  return { cmd, flags, rest };
}

function flagStr(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

function parseTabId(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    fail(`无效 tab id：${raw}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    fail(`无效 tab id：${raw}`);
  }
  return n;
}

function pageVisible(page: StoredPage, flags: Map<string, string | true>): StoredThread[] {
  const showHidden = flags.has('hidden');
  const openOnly = flags.has('open');
  return page.threads.filter((t) => {
    if (openOnly && t.status !== 'open') {
      return false;
    }
    if (!showHidden && t.relocateStatus?.state === 'orphaned') {
      return false;
    }
    return true;
  });
}

function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

function cmdListBatches(flags: Map<string, string | true>): void {
  const dir = resolveStorageDir();
  const openOnly = !flags.has('all');
  const batches = listBatches(dir, { openOnly });
  if (flags.has('json')) {
    const out = batches.map((batch) => ({
      batchId: batch.batchId,
      tabId: batch.tabId,
      url: batch.url,
      title: batch.title,
      updatedAt: batch.updatedAt,
      open: batch.open,
      threads: batch.items.map((item) => ({
        tabId: batch.tabId,
        url: item.url,
        threadId: item.thread.id,
        number: item.thread.number,
        status: item.thread.status,
        quote: item.thread.anchor.quote,
        kind: item.thread.anchor.kind,
        screenshotAbs: item.thread.screenshot
          ? screenshotAbsPath(dir, batch.tabId, item.thread.screenshot)
          : '',
        comments: item.thread.comments.map((c) => ({ author: c.author, body: c.body })),
      })),
    }));
    const jsonIndent = 2;
    process.stdout.write(`${JSON.stringify(out, null, jsonIndent)}\n`);
    return;
  }
  if (batches.length === 0) {
    process.stdout.write('（没有网页标记。）\n');
    return;
  }
  if (flags.has('name-only')) {
    const lines = batches.map((batch) => {
      const state = batch.open ? 'open' : 'resolved';
      return `#${shortId(batch.batchId)} [${state}] ${batch.items.length} 条  ${batch.title || hostPath(batch.url)}`;
    });
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }
  const blocks = batches.map((batch) => {
    const state = batch.open ? 'open' : 'resolved';
    const lines = [
      `#${shortId(batch.batchId)} [${state}] ${batch.items.length} 条`,
      `${batch.title || '（无标题）'} — ${hostPath(batch.url)}`,
    ];
    for (const item of batch.items) {
      const resolved = item.thread.status === 'resolved' ? ' [已解决]' : '';
      lines.push(`${headOf(item.thread)}${resolved}`);
      for (const c of item.thread.comments) {
        lines.push(`    - ${c.author}: ${foldWhitespace(c.body)}`);
      }
    }
    return lines.join('\n');
  });
  process.stdout.write(`${blocks.join('\n\n')}\n`);
}

function cmdList(flags: Map<string, string | true>, rest: string[]): void {
  const dir = resolveStorageDir();
  const tabRaw = flagStr(flags, 'tab') || rest[0];
  if (!tabRaw) {
    cmdListBatches(flags);
    return;
  }
  const tabId = parseTabId(tabRaw);
  const tab = loadTab(dir, tabId);
  const session = currentSession(dir);
  if (tab.sessionId !== session) {
    if (flags.has('json')) {
      process.stdout.write('[]\n');
      return;
    }
    process.stdout.write('（当前会话这个标签没有评论）\n');
    return;
  }
  const urlFilter = flagStr(flags, 'url');
  let canonical: string | undefined;
  if (urlFilter) {
    try {
      canonical = canonicalizeUrl(urlFilter);
    } catch {
      fail(`无效 URL：${urlFilter}`);
    }
  }

  const pages = Object.values(tab.pages)
    .filter((p) => !canonical || p.url === canonical)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  if (flags.has('json')) {
    const out = [];
    for (const page of pages) {
      for (const thread of pageVisible(page, flags)) {
        out.push({
          tabId,
          sessionId: tab.sessionId,
          url: page.url,
          threadId: thread.id,
          status: thread.status,
          quote: thread.anchor.quote,
          kind: thread.anchor.kind,
          screenshotAbs: thread.screenshot ? screenshotAbsPath(dir, tabId, thread.screenshot) : '',
          comments: thread.comments.map((c) => ({ author: c.author, body: c.body })),
        });
      }
    }
    const jsonIndent = 2;
    process.stdout.write(`${JSON.stringify(out, null, jsonIndent)}\n`);
    return;
  }

  if (flags.has('name-only')) {
    const n = pages.reduce((sum, p) => sum + pageVisible(p, flags).length, 0);
    process.stdout.write(n === 0 ? '（没有评论）\n' : `tab ${tabId}  ${n} 条\n`);
    return;
  }

  const blocks: string[] = [];
  for (const page of pages) {
    const threads = pageVisible(page, flags);
    if (threads.length === 0) {
      continue;
    }
    const lines = [`tab ${tabId}`, page.url];
    if (page.title) {
      lines.push(`  ${page.title}`);
    }
    for (const thread of threads) {
      const resolved = thread.status === 'resolved' ? ' [已解决]' : '';
      lines.push(`${headOf(thread)}${resolved}`);
      for (const c of thread.comments) {
        lines.push(`    - ${c.author}: ${foldWhitespace(c.body)}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  process.stdout.write(`${blocks.join('\n\n') || '（当前会话这个标签没有评论）'}\n`);
}

function cmdReply(rest: string[]): void {
  const dir = resolveStorageDir();
  const threadId = rest[0];
  const body = rest.slice(1).join(' ');
  if (!threadId || !body) {
    fail('用法：dom-comment reply <threadId> <text>');
  }
  const hit = findThread(dir, threadId);
  if (!hit) {
    fail('找不到唯一线程。请用更长的 id。');
  }
  opsReply(hit.tab, hit.thread.id, { author: 'agent', body });
  saveTab(dir, hit.tab);
}

function cmdResolve(rest: string[]): void {
  const dir = resolveStorageDir();
  const threadId = rest[0];
  if (!threadId) {
    fail('用法：dom-comment resolve <threadId>');
  }
  const hit = findThread(dir, threadId);
  if (!hit) {
    fail('找不到唯一线程。请用更长的 id。');
  }
  opsResolve(hit.tab, hit.thread.id);
  saveTab(dir, hit.tab);
}

function cmdOpen(flags: Map<string, string | true>, rest: string[]): void {
  const tabRaw = flagStr(flags, 'tab') || rest[0];
  if (!tabRaw) {
    fail('用法：dom-comment open --tab <id>');
  }
  cmdOpenTab(parseTabId(tabRaw));
}

function collectTargets(argv: string[]): string[] {
  const targets: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--target' && argv[i + 1]) {
      targets.push(argv[i + 1]);
      i += 1;
    }
  }
  return targets;
}

function usage(): void {
  process.stdout.write(`dom-comment install-skill [--target <skill-root>]
dom-comment extension
dom-comment list [--open] [--all] [--json] [--name-only]
dom-comment list --tab <id> [--url <canonical>] [--open] [--hidden] [--json] [--name-only]
dom-comment reply <threadId> <text>
dom-comment resolve <threadId>
dom-comment open --tab <id>
dom-comment ping-host
dom-comment install-host [--extension-id <id>]
dom-comment uninstall-host
`);
}

const ARGV_AFTER_NODE_AND_SCRIPT = 2;

export function main(argv = process.argv.slice(ARGV_AFTER_NODE_AND_SCRIPT)): void {
  const { cmd, flags, rest } = parseArgs(argv);
  switch (cmd) {
    case 'list':
      cmdList(flags, rest);
      break;
    case 'reply':
      cmdReply(rest);
      break;
    case 'resolve':
      cmdResolve(rest);
      break;
    case 'open':
      cmdOpen(flags, rest);
      break;
    case 'install':
      fail('`install` 已换成 `install-skill`');
      break;
    case 'setup':
    case 'install-skill': {
      const targets = collectTargets(argv);
      if (targets.length > 0 || !process.stdin.isTTY) {
        cmdInstall(flags, targets);
      } else {
        void cmdInstallInteractive(flags).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`${message}\n`);
          process.exit(1);
        });
      }
      break;
    }
    case 'extension':
      cmdExtension();
      break;
    case 'install-host':
      cmdInstallHost(flags);
      break;
    case 'uninstall-host':
      cmdUninstallHost();
      break;
    case 'ping-host':
      cmdPingHost();
      break;
    case '':
    case '-h':
    case '--help':
    case 'help':
      usage();
      break;
    default:
      fail(`未知命令：${cmd}`);
  }
}
