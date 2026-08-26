import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { docFile, saveDoc } from '../src/storage.ts';
import type { StoredAnchor, StoredDocument, StoredThread } from '../src/types.ts';

const cliPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
function resolveTsxLoader(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    path.resolve(here, '../node_modules/tsx/dist/loader.mjs'),
    path.resolve(here, '../../dom-comment/node_modules/tsx/dist/loader.mjs'),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'tsx';
}
const TSX_LOADER = resolveTsxLoader();

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function thread(
  id: string,
  extra: {
    status?: StoredThread['status'];
    kind?: StoredAnchor['kind'];
    quote?: string;
    startLine?: number;
    endLine?: number;
    target?: StoredAnchor['target'];
    rendered?: StoredAnchor['rendered'];
    body?: string;
  } = {},
): StoredThread {
  const startLine = extra.startLine ?? 0;
  return {
    id,
    status: extra.status ?? 'open',
    anchor: {
      kind: extra.kind ?? 'selection',
      startLine,
      startChar: 0,
      endLine: extra.endLine ?? startLine,
      endChar: 4,
      quote: extra.quote ?? '',
      before: '',
      after: '',
      rendered: extra.rendered,
      target: extra.target,
    },
    comments: [
      {
        id: `${id}-c`,
        author: 'user',
        body: extra.body ?? 'note',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

function seed(): {
  storage: string;
  workspace: string;
  home: string;
  md: string;
  outside: string;
  ids: Record<string, string>;
} {
  const storage = tmp('mdc-cli-store-');
  const workspace = tmp('mdc-cli-ws-');
  const home = tmp('mdc-cli-home-');
  const md = path.join(workspace, 'doc.md');
  const outside = path.join(tmp('mdc-cli-out-'), 'other.md');
  const content = [
    'Hello quoted text that is fairly long for clipping purposes extra',
    '',
    '```mermaid',
    'flowchart LR',
    '  Start[Start] --> End[End]',
    '```',
    '',
    'A later line',
    '```',
    'plain fence',
    '```',
  ].join('\n');
  fs.writeFileSync(md, content, 'utf8');
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, 'outside quote\n', 'utf8');

  const ids = {
    selection: '11111111-1111-4111-8111-111111111111',
    document: '22222222-2222-4222-8222-222222222222',
    diagram: '33333333-3333-4333-8333-333333333333',
    node: '44444444-4444-4444-8444-444444444444',
    line: '55555555-5555-4555-8555-555555555555',
    orphan: '66666666-6666-4666-8666-666666666666',
    resolved: '77777777-7777-4777-8777-777777777777',
    fallback: '88888888-8888-4888-8888-888888888888',
    emptyLine: '99999999-9999-4999-8999-999999999999',
    outside: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };

  const doc: StoredDocument = {
    version: 1,
    threads: [
      thread(ids.selection, {
        quote: 'Hello quoted text that is fairly long for clipping purposes extra',
        startLine: 0,
        body: 'selection comment',
      }),
      thread(ids.document, { kind: 'document', quote: '', body: 'doc comment' }),
      thread(ids.diagram, {
        quote: 'Mermaid 图',
        startLine: 2,
        endLine: 5,
        target: { kind: 'mermaid-diagram' },
        body: 'diagram comment',
      }),
      thread(ids.node, {
        quote: 'Start',
        startLine: 4,
        target: { kind: 'mermaid-node', nodeId: 'Start' },
        rendered: { quote: 'Start', before: '', after: '' },
        body: 'node comment',
      }),
      thread(ids.line, { quote: '', startLine: 7, body: 'line comment' }),
      thread(ids.orphan, { quote: 'this quote was deleted', startLine: 0, body: 'orphan comment' }),
      thread(ids.resolved, {
        quote: 'A later line',
        startLine: 7,
        status: 'resolved',
        body: 'resolved comment',
      }),
      thread(ids.fallback, {
        quote: 'missing node label',
        startLine: 4,
        target: { kind: 'mermaid-node', nodeId: 'Start' },
        body: 'fallback comment',
      }),
      thread(ids.emptyLine, { quote: '', startLine: 1, body: 'empty line comment' }),
    ],
  };
  saveDoc(storage, md, doc);
  saveDoc(storage, outside, {
    version: 1,
    threads: [thread(ids.outside, { quote: 'outside quote', body: 'outside comment' })],
  });
  return { storage, workspace, home, md, outside, ids };
}

function run(
  args: string[],
  opts: { cwd: string; storage?: string; home?: string; unsetStorage?: boolean },
): SpawnSyncReturns<string> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: opts.home ?? tmp('mdc-cli-home-'),
    NODE_PATH: path.resolve(TSX_LOADER, '../../..'),
  };
  if (opts.unsetStorage) {
    delete env.MARKDOWN_COMMENT_STORAGE_DIR;
  } else if (opts.storage) {
    env.MARKDOWN_COMMENT_STORAGE_DIR = opts.storage;
  }
  const loader = TSX_LOADER;
  return spawnSync(process.execPath, ['--import', loader, cliPath, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd,
    env,
  });
}

test('no-command prints help', () => {
  const { storage, workspace, home } = seed();
  const result = run([], { cwd: workspace, storage, home });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /markdown-comment <command>/);
  assert.match(result.stdout, /list \[file\]/);
  assert.match(result.stdout, /reply <threadId>/);
});

test('list without storage pointer fails when env is unset', () => {
  const home = tmp('mdc-cli-empty-home-');
  const result = run(['list'], { cwd: tmp('mdc-cli-empty-cwd-'), home, unsetStorage: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未找到评论存储/);
});

test('list prints 划词 全文 Mermaid 图 Mermaid 节点 and 整行 kinds', () => {
  const ctx = seed();
  const result = run(['list'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[划词\]/);
  assert.match(result.stdout, /\[全文\]/);
  assert.match(result.stdout, /\[Mermaid 图\]/);
  assert.match(result.stdout, /\[Mermaid 节点:Start\]/);
  assert.match(result.stdout, /\[整行\]/);
  assert.match(result.stdout, /A later line/);
  assert.match(result.stdout, /\(空行\)/);
  assert.match(result.stdout, /\[已解决\]/);
  assert.match(result.stdout, /\[降级到整图\]/);
  assert.doesNotMatch(result.stdout, /\[失联\]/);
});

test('--hidden includes orphan threads', () => {
  const ctx = seed();
  const hidden = run(['list', '--hidden'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.match(hidden.stdout, /\[失联\]/);
  assert.match(hidden.stdout, /orphan comment/);
  const visible = run(['list'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.doesNotMatch(visible.stdout, /orphan comment/);
});

test('--open hides resolved threads', () => {
  const ctx = seed();
  const result = run(['list', '--open'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.doesNotMatch(result.stdout, /resolved comment/);
  assert.match(result.stdout, /selection comment/);
});

test('--name-only prints file and count', () => {
  const ctx = seed();
  const result = run(['list', '--name-only'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.match(result.stdout, /doc\.md/);
  assert.match(result.stdout, /条/);
  assert.doesNotMatch(result.stdout, /\[划词\]/);
});

test('--json emits thread objects', () => {
  const ctx = seed();
  const result = run(['list', '--json', '--hidden'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.equal(result.status, 0, result.stderr);
  const rows = JSON.parse(result.stdout) as Array<{ threadId: string; orphaned: boolean; target?: unknown }>;
  assert.ok(rows.some((row) => row.threadId === ctx.ids.selection));
  assert.ok(rows.some((row) => row.orphaned));
  const openOnly = run(['list', '--json', '--open'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  const openRows = JSON.parse(openOnly.stdout) as Array<{ status: string }>;
  assert.ok(openRows.every((row) => row.status === 'open'));
});

test('list one file ignores other documents', () => {
  const ctx = seed();
  const result = run(['list', ctx.md], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.match(result.stdout, /doc\.md/);
  assert.doesNotMatch(result.stdout, /outside quote/);
});

test('-g lists documents outside cwd', () => {
  const ctx = seed();
  const scoped = run(['list'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.doesNotMatch(scoped.stdout, /outside comment/);
  const globalFlag = run(['list', '-g'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.match(globalFlag.stdout, /outside comment/);
  const longFlag = run(['list', '--global'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.match(longFlag.stdout, /other\.md/);
});

test('empty cwd prints the scoped empty message', () => {
  const ctx = seed();
  const empty = tmp('mdc-cli-empty-cwd-');
  const result = run(['list'], { cwd: empty, storage: ctx.storage, home: ctx.home });
  assert.match(result.stdout, /当前目录下没有评论；加 -g 看全部/);
  const globalEmptyStore = run(['list', '-g'], { cwd: empty, storage: tmp('mdc-cli-empty-store-'), home: ctx.home });
  assert.match(globalEmptyStore.stdout, /没有评论/);
});

test('reply appends an agent comment', () => {
  const ctx = seed();
  const result = run(['reply', ctx.ids.selection, 'agent', 'says', 'hi'], {
    cwd: ctx.workspace,
    storage: ctx.storage,
    home: ctx.home,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: 已回复 #11111111/);
  const listed = run(['list', '--json'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  const rows = JSON.parse(listed.stdout) as Array<{ threadId: string; comments: Array<{ author: string; body: string }> }>;
  const target = rows.find((row) => row.threadId === ctx.ids.selection);
  assert.ok(target?.comments.some((comment) => comment.author === 'agent' && comment.body === 'agent says hi'));
});

test('resolve marks a thread resolved', () => {
  const ctx = seed();
  const result = run(['resolve', ctx.ids.selection.slice(0, 8)], {
    cwd: ctx.workspace,
    storage: ctx.storage,
    home: ctx.home,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK: 已标记已解决 #11111111/);
  const listed = run(['list', '--json', '--hidden'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  const rows = JSON.parse(listed.stdout) as Array<{ threadId: string; status: string }>;
  assert.equal(rows.find((row) => row.threadId === ctx.ids.selection)?.status, 'resolved');
});

test('missing args and missing ids fail', () => {
  const ctx = seed();
  const replyArgs = run(['reply'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.equal(replyArgs.status, 1);
  assert.match(replyArgs.stderr, /用法: markdown-comment reply/);
  const resolveArgs = run(['resolve'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.equal(resolveArgs.status, 1);
  assert.match(resolveArgs.stderr, /用法: markdown-comment resolve/);
  const replyMissing = run(['reply', 'not-a-real-id', 'hi'], {
    cwd: ctx.workspace,
    storage: ctx.storage,
    home: ctx.home,
  });
  assert.equal(replyMissing.status, 1);
  assert.match(replyMissing.stderr, /未找到 thread/);
  const resolveMissing = run(['resolve', 'ffffff'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.equal(resolveMissing.status, 1);
  assert.match(resolveMissing.stderr, /未找到 thread/);
});

test('list still works when the markdown file is missing', () => {
  const ctx = seed();
  fs.rmSync(ctx.md);
  const result = run(['list', '--hidden'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[全文\]/);
  assert.match(result.stdout, /\[整行\]/);
});

test('mermaid fallback is not used when a closing fence is nearer than a mermaid block', () => {
  const ctx = seed();
  const ghost = thread('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', {
    quote: 'gone-plain',
    startLine: 10,
    target: { kind: 'mermaid-diagram' },
    body: 'ghost diagram',
  });
  const current = JSON.parse(fs.readFileSync(requireDoc(ctx.storage, ctx.md), 'utf8')) as StoredDocument;
  current.threads.push(ghost);
  saveDoc(ctx.storage, ctx.md, current);
  const result = run(['list', '--hidden'], { cwd: ctx.workspace, storage: ctx.storage, home: ctx.home });
  assert.match(result.stdout, /ghost diagram/);
  assert.match(result.stdout, /\[失联\]/);
});

function requireDoc(storage: string, absPath: string): string {
  return docFile(storage, absPath);
}
