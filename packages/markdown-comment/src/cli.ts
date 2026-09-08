// markdown-comment CLI —— 给 Agent 读取/回复评论（list/reply/resolve）。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readStorageDir, listAll, loadDoc, saveDoc, findThread, resolveDocKey, getCliId } from './storage';
import type { StoredComment, StoredThread } from './types';

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function getStorageDir(): string {
  const dir = readStorageDir();
  if (!dir) {
    fail(
      '未找到评论存储。请先在 VS Code 里启动 Markdown Comment 插件（它会写入存储指针 ~/.markdown-comment/pointer.json）。',
    );
  }
  return dir;
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
    docs = docs.filter(({ path: p }) => isUnder(cwd, p));
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
  default:
    process.stdout.write(
      [
        'markdown-comment <command>',
        '',
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
