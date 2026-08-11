// markdown-comment（简写 mdc）CLI —— 给 Agent 读取/回复评论（list/reply/resolve），以及给用户一键安装（init）。
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readStorageDir, listAll, loadDoc, saveDoc, findThread } from './storage';
import type { StoredComment, StoredThread } from './types';

function fail(msg: string): never {
  process.stderr.write(msg + '\n');
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

function requiredFlagValue(name: string): string | undefined {
  const indexes = rest.flatMap((value, index) => (value === name ? [index] : []));
  if (indexes.length > 1) {
    fail(`${name} 只能传一次。`);
  }
  if (!indexes.length) {
    return undefined;
  }
  const value = rest[indexes[0] + 1];
  if (!value || value.startsWith('-')) {
    fail(`${name} 缺少目录参数。`);
  }
  return value;
}

function validateInitArgs(): void {
  const valueFlags = new Set(['--skill-dir', '--skill-dirs']);
  const booleanFlags = new Set(['--no-skill', '--no-extension']);
  const seen = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (valueFlags.has(token)) {
      if (seen.has(token)) {
        fail(`${token} 只能传一次。`);
      }
      const value = rest[index + 1];
      if (!value || value.startsWith('-')) {
        fail(`${token} 缺少目录参数。`);
      }
      seen.add(token);
      index += 1;
      continue;
    }
    if (booleanFlags.has(token)) {
      if (seen.has(token)) {
        fail(`${token} 只能传一次。`);
      }
      seen.add(token);
      continue;
    }
    if (token.startsWith('--')) {
      fail(`未知参数: ${token}`);
    }
    fail(`不支持的位置参数: ${token}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 30) => {
  const t = oneLine(s);
  return t.length > n ? t.slice(0, n) + '…' : t;
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
  // 渲染态引用（preview 划词时所选）更贴近人看到的文字，优先展示。
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

/** 展示路径：文件在当前终端目录下则转相对路径，否则保留绝对路径。 */
function displayPath(abs: string): string {
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
  const fileArg = args.find((a) => a !== '-g'); // -g 是单划线，不在 args 的 -- 过滤里，手动排掉
  let docs = fileArg
    ? [{ path: path.resolve(fileArg), doc: loadDoc(storageDir, path.resolve(fileArg)) }]
    : listAll(storageDir);
  // 默认只看当前目录（含子目录）下有评论的文档；-g/--global 看全局。指定 file 时不限定。
  const scoped = !fileArg && !global;
  if (scoped) {
    const cwd = process.cwd();
    docs = docs.filter(({ path: p }) => isUnder(cwd, p));
  }

  // 默认隐藏失联评论（原文已删/被替换，定位不到）；--hidden 才列出。
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
        const orphaned = state.orphaned;
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
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  const nameOnly = flags.has('--name-only');
  const blocks: string[] = [];
  for (const { path: p, doc } of docs) {
    const text = fileTextOf(p);
    const threads = doc.threads.filter((t) => {
      const state = anchorState(text, t.anchor);
      return (!flags.has('--open') || t.status === 'open') && (showHidden || !state.orphaned);
    });
    if (threads.length === 0) {
      continue;
    }
    if (nameOnly) {
      blocks.push(`${displayPath(p)}  ${threads.length} 条`);
      continue;
    }
    const lines = [displayPath(p)];
    for (const t of threads) {
      const status = t.status === 'resolved' ? ' [已解决]' : '';
      const state = anchorState(text, t.anchor);
      const anchorStatus = state.orphaned ? ' [失联]' : state.diagramFallback ? ' [降级到整图]' : '';
      lines.push(`${headOf(p, t)}  #${shortId(t.id)}${status}${anchorStatus}`); // headOf 用绝对路径读行内容
      for (const c of t.comments) {
        lines.push(`    - ${c.author}: ${oneLine(c.body)}`);
      }
    }
    blocks.push(lines.join('\n'));
  }
  const empty = scoped ? '（当前目录下没有评论；加 -g 看全部）' : '（没有评论）';
  process.stdout.write((blocks.join(nameOnly ? '\n' : '\n\n') || empty) + '\n');
}

function cmdReply(): void {
  const storageDir = getStorageDir();
  const threadId = args[0];
  const body = args.slice(1).join(' ');
  if (!threadId || !body) {
    fail('用法: mdc reply <threadId> <text>');
  }
  const found = findThread(storageDir, threadId);
  if (!found) {
    fail('未找到 thread（或前缀不唯一）: ' + threadId);
  }
  const comment: StoredComment = {
    id: randomUUID(),
    author: 'agent',
    body,
    createdAt: new Date().toISOString(),
  };
  found.thread.comments.push(comment);
  saveDoc(storageDir, found.path, found.doc);
  process.stdout.write('OK: 已回复 #' + shortId(found.thread.id) + '\n');
}

function cmdResolve(): void {
  const storageDir = getStorageDir();
  const threadId = args[0];
  if (!threadId) {
    fail('用法: mdc resolve <threadId>');
  }
  const found = findThread(storageDir, threadId);
  if (!found) {
    fail('未找到 thread（或前缀不唯一）: ' + threadId);
  }
  found.thread.status = 'resolved';
  saveDoc(storageDir, found.path, found.doc);
  process.stdout.write('OK: 已标记已解决 #' + shortId(found.thread.id) + '\n');
}

function nearestExistingAncestor(target: string): string {
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return current;
}

/**
 * 返回安装目标的 canonical identity。
 * 目标本身可能还不存在，因此先 realpath 最近的已存在祖先，再拼回剩余相对路径。
 */
function canonicalTarget(target: string): string {
  const absolute = path.resolve(target);
  const ancestor = nearestExistingAncestor(absolute);
  try {
    return path.join(fs.realpathSync.native(ancestor), path.relative(ancestor, absolute));
  } catch {
    return absolute;
  }
}

function dedupeSkillTargets(targets: string[]): { targets: string[]; duplicates: Array<{ target: string; original: string }> } {
  const seen = new Map<string, string>();
  const unique: string[] = [];
  const duplicates: Array<{ target: string; original: string }> = [];
  for (const target of targets) {
    const canonical = canonicalTarget(target);
    const original = seen.get(canonical);
    if (original) {
      duplicates.push({ target, original });
      continue;
    }
    seen.set(canonical, target);
    unique.push(target);
  }
  return { targets: unique, duplicates };
}

function askLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

function parseSkillDirs(input: string, label: string): string[] {
  const directories = [...new Set(input.split(',').map((s) => s.trim()).filter(Boolean))];
  if (!directories.length) {
    fail(`${label} 至少需要一个非空目录。`);
  }
  return directories;
}

/** 决定装到哪些 skill 根目录：--skill-dirs 指定 > 交互输入 > 非 TTY 明确失败。 */
async function chooseSkillDirs(): Promise<string[]> {
  const csv = requiredFlagValue('--skill-dirs');
  if (csv) {
    return parseSkillDirs(csv, '--skill-dirs');
  }
  if (!process.stdin.isTTY) {
    fail('非交互安装必须用 --skill-dir <目录> 或 --skill-dirs <目录列表> 明确指定 skill 目标。');
  }
  const line = (
    await askLine('请输入一个或多个 skill 根目录（逗号分隔；每个目录下会创建 markdown-comment/）：\n> ')
  ).trim();
  if (!line) {
    fail('未指定 skill 目标目录；可用 --no-skill 跳过安装。');
  }
  return parseSkillDirs(line, 'skill 目录');
}

/** 安装：打 vsix → 装 VS Code 插件 → 写 skill（目标目录必须显式指定）。 */
async function cmdInit(): Promise<void> {
  validateInitArgs();
  const pkgRoot = path.resolve(__dirname, '..'); // dist/.. = 包根

  // 先决定 skill 目标（含交互），避免插件安装日志后再打断提问。
  let skillTargets: string[] = [];
  const explicit = requiredFlagValue('--skill-dir');
  const roots = requiredFlagValue('--skill-dirs');
  if (explicit && roots) {
    fail('--skill-dir 与 --skill-dirs 不能同时使用。');
  }
  if (flags.has('--no-skill') && (explicit || roots)) {
    fail('--no-skill 不能与 --skill-dir 或 --skill-dirs 同时使用。');
  }
  if (!flags.has('--no-skill')) {
    if (explicit) {
      skillTargets = [path.resolve(explicit.replace(/^~(?=$|\/)/, os.homedir()))];
    } else {
      skillTargets = (await chooseSkillDirs()).map((directory) =>
        path.join(path.resolve(directory.replace(/^~(?=$|\/)/, os.homedir())), 'markdown-comment'),
      );
    }
    const deduped = dedupeSkillTargets(skillTargets);
    skillTargets = deduped.targets;
    for (const duplicate of deduped.duplicates) {
      process.stdout.write(`跳过重复 skill 目标：${duplicate.target} → ${duplicate.original}\n`);
    }
  }

  if (!flags.has('--no-extension')) {
    const vsix = path.join(pkgRoot, 'dist', 'vscode-markdown-comment.vsix');
    if (!fs.existsSync(vsix)) {
      const vsce = path.join(pkgRoot, 'node_modules', '.bin', 'vsce');
      process.stdout.write('打包 vsix…\n');
      execFileSync(vsce, ['package', '--no-dependencies', '--ignoreFile', '.vscodeignore', '-o', vsix], {
        cwd: pkgRoot,
        stdio: 'inherit',
      });
    }
    process.stdout.write('安装 VS Code 插件…\n');
    try {
      execFileSync('code', ['--install-extension', vsix, '--force'], { stdio: 'inherit' });
    } catch {
      fail(
        "调用 `code` 失败。请确认 VS Code 的 code 命令在 PATH（VS Code 执行 “Shell Command: Install 'code' command in PATH”），或加 --no-extension 跳过。",
      );
    }
  }

  if (skillTargets.length) {
    // 始终绑定当前 package 的 CLI，避免 PATH 里的同名命令指向旧仓库或其他版本。
    const cliCmd = `node ${shellQuote(path.join(pkgRoot, 'dist', 'cli.js'))}`;
    const body = fs
      .readFileSync(path.join(pkgRoot, 'dist', 'resources', 'skills', 'markdown-comment', 'SKILL.md'), 'utf8')
      .replaceAll('{{CLI}}', cliCmd);
    for (const dir of skillTargets) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
      process.stdout.write(`已安装 skill → ${path.join(dir, 'SKILL.md')}（CLI = ${cliCmd}）\n`);
    }
  }

  process.stdout.write(
    '\n完成。VS Code 执行 “Developer: Reload Window”，打开任意 .md 即可划词评论（在跑 F5 调试实例的话先关掉）。\n',
  );
}

switch (cmd) {
  case 'init':
  case 'install': // 兼容旧名
    void cmdInit();
    break;
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
        'markdown-comment（简写 mdc）<command>',
        '',
        '给用户：',
        '  init [--skill-dirs <a,b>] [--skill-dir <dir>] [--no-skill] [--no-extension]',
        '                                  安装 VS Code 插件 + Agent skill',
        '                                  --skill-dir 指定完整目标目录；--skill-dirs 指定一个或多个 skill 根目录',
        '                                  未传目录时仅在 TTY 交互询问；非交互调用必须显式指定',
        '',
        '给 Agent：',
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
