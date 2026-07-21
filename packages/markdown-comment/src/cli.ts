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
    fail('未找到评论存储。请先在 VS Code 里启动 Markdown Comment 插件（它会写入存储指针 ~/.markdown-comment/pointer.json）。');
  }
  return dir;
}

const [, , cmd, ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const args = rest.filter((a) => !a.startsWith('--'));

function flagValue(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
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

/** 线程标题：用 [划词]/[整行]/[全文] 前置标类型；划词显示 quote，整行回退读该行内容。 */
function headOf(absFile: string, t: StoredThread): string {
  if (t.anchor.kind === 'document') {
    return '- [全文]';
  }
  const start = t.anchor.startLine + 1;
  const end = t.anchor.endLine + 1;
  const loc = end > start ? `L${start}-${end}` : `L${start}`;
  // 渲染态引用（preview 划词时所选）更贴近人看到的文字，优先展示。
  const quote = t.anchor.rendered?.quote || t.anchor.quote;
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
function isOrphaned(text: string | null, anchor: StoredThread['anchor']): boolean {
  if (anchor.kind === 'document' || !anchor.quote || text === null) {
    return false;
  }
  return !text.includes(anchor.quote);
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
        const orphaned = isOrphaned(text, t.anchor);
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
    const threads = doc.threads.filter(
      (t) => (!flags.has('--open') || t.status === 'open') && (showHidden || !isOrphaned(text, t.anchor)),
    );
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
      const orphan = isOrphaned(text, t.anchor) ? ' [失联]' : '';
      lines.push(`${headOf(p, t)}  #${shortId(t.id)}${status}${orphan}`); // headOf 用绝对路径读行内容
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

/** mdc 是否已是全局命令（pnpm link --global / npm i -g 之后）。 */
function hasGlobalCli(): boolean {
  try {
    execFileSync('which', ['mdc'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 支持的 skill 目录约定（多选，默认 .agents/skills）。
const SKILL_CONVS = ['.agents/skills', '.claude/skills', '.codex/skills', '.trae/skills'];
const DEFAULT_CONVS = ['.agents/skills'];

function askLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}

/** 决定装到哪些 skill 目录约定：--skill-dirs 指定 > 交互多选 > 非 TTY 用默认。 */
async function chooseSkillConvs(): Promise<string[]> {
  const csv = flagValue('--skill-dirs');
  if (csv) {
    return csv.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }
  if (!process.stdin.isTTY) {
    return DEFAULT_CONVS; // 非交互（如 Agent 调用）：用默认，不卡住。
  }
  process.stdout.write('安装 skill 到哪些目录？（输入数字，逗号/空格分隔多选；回车=默认 .agents/skills；all=全部）\n');
  SKILL_CONVS.forEach((c, i) => process.stdout.write(`  ${i + 1}) ${c}${c === DEFAULT_CONVS[0] ? '   [默认]' : ''}\n`));
  const line = (await askLine('> ')).trim();
  if (!line) {
    return DEFAULT_CONVS;
  }
  if (line.toLowerCase() === 'all') {
    return [...SKILL_CONVS];
  }
  const chosen = [...new Set(line.split(/[\s,]+/).map((s) => parseInt(s, 10)))]
    .filter((n) => n >= 1 && n <= SKILL_CONVS.length)
    .map((n) => SKILL_CONVS[n - 1]);
  return chosen.length ? chosen : DEFAULT_CONVS;
}

/** 安装：打 vsix → 装 VS Code 插件 → 写 skill（默认 ~/.agents/skills，可多选 / --project 装当前项目）。 */
async function cmdInit(): Promise<void> {
  const pkgRoot = path.resolve(__dirname, '..'); // dist/.. = 包根

  // 先决定 skill 目标（含交互），避免插件安装日志后再打断提问。
  let skillTargets: string[] = [];
  if (!flags.has('--no-skill')) {
    const explicit = flagValue('--skill-dir');
    if (explicit) {
      skillTargets = [explicit]; // 显式指定单个 markdown-comment 目录（向后兼容）
    } else {
      const base = flags.has('--project') ? process.cwd() : os.homedir();
      skillTargets = (await chooseSkillConvs()).map((c) => path.join(base, c, 'markdown-comment'));
    }
  }

  if (!flags.has('--no-extension')) {
    const vsix = path.join(pkgRoot, 'dist', 'vscode-markdown-comment.vsix');
    if (!fs.existsSync(vsix)) {
      const vsce = path.join(pkgRoot, 'node_modules', '.bin', 'vsce');
      process.stdout.write('打包 vsix…\n');
      execFileSync(vsce, ['package', '--no-dependencies', '-o', vsix], { cwd: pkgRoot, stdio: 'inherit' });
    }
    process.stdout.write('安装 VS Code 插件…\n');
    try {
      execFileSync('code', ['--install-extension', vsix, '--force'], { stdio: 'inherit' });
    } catch {
      fail('调用 `code` 失败。请确认 VS Code 的 code 命令在 PATH（VS Code 执行 “Shell Command: Install \'code\' command in PATH”），或加 --no-extension 跳过。');
    }
  }

  if (skillTargets.length) {
    // CLI 已全局可用就用 mdc，否则回退绝对路径，保证 Agent 一定能调用。
    const cliCmd = hasGlobalCli() ? 'mdc' : `node ${path.join(pkgRoot, 'dist', 'cli.js')}`;
    const body = fs.readFileSync(path.join(pkgRoot, 'dist', 'resources', 'skills', 'markdown-comment', 'SKILL.md'), 'utf8').replaceAll('{{CLI}}', cliCmd);
    for (const dir of skillTargets) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
      process.stdout.write(`已安装 skill → ${path.join(dir, 'SKILL.md')}（CLI = ${cliCmd}）\n`);
    }
  }

  process.stdout.write('\n完成。VS Code 执行 “Developer: Reload Window”，打开任意 .md 即可划词评论（在跑 F5 调试实例的话先关掉）。\n');
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
        '  init [--project] [--skill-dirs <a,b>] [--skill-dir <dir>] [--no-skill] [--no-extension]',
        '                                  安装 VS Code 插件 + Agent skill',
        '                                  skill 目录交互多选（.agents/.claude/.codex/.trae/skills，默认 .agents/skills）',
        '                                  --skill-dirs 跳过交互直接指定；--project 装当前项目而非用户目录',
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
