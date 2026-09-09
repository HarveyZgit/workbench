// On-demand local preview: HTTP host for the existing webview UI (no permanent daemon).
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { loadDoc, saveDoc, fileHash, formatSkillPrompt } from '../storage';
import { hasMarkdownExtension } from '../markdown-lang';
import { PlainTextDocument } from '../text-model';
import { DEFAULT_IDLE_EXIT_MS, DEFAULT_PREVIEW_HOST } from '../config';
import { applyCommentMutation } from './comment-ops';
import { isCommentMutation, isWebviewMessage, MAX_LINK_LENGTH } from './protocol';
import { buildPreviewHtml } from './shell';
import { toWire } from './threads';
import type { HostToWebview, PreviewRenderOptions, ResolvedPreviewResource, WebviewToHost } from './messages';

const RENDER_DEBOUNCE_MS = 150;

export interface PreviewServerOptions {
  storageDir: string;
  port?: number;
  host?: string;
  distDir?: string;
  syncIntervalMs?: number;
  idleExitMs?: number;
}

export interface PreviewServer {
  urlFor: (filePath: string) => string;
  port: number;
  host: string;
  syncIntervalMs: number;
  openFile: (filePath: string) => void;
  close: () => Promise<void>;
}

function defaultRenderOptions(): PreviewRenderOptions {
  return {
    frontMatter: 'table',
    scrollPreviewWithEditor: false,
    scrollEditorWithPreview: false,
    doubleClickToSwitchToEditor: false,
    styles: [],
    fontSize: 14,
    lineHeight: 1.7,
    breaks: false,
    typographer: false,
    html: 'strict',
    renderedDiff: false,
    mermaidNodeComments: true,
  };
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function realPath(candidate: string): string | null {
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return null;
  }
}

function splitResourceReference(source: string): { path: string; suffix: string } {
  const index = source.search(/[?#]/);
  return index < 0
    ? { path: source, suffix: '' }
    : { path: source.slice(0, index), suffix: source.slice(index) };
}

function resolveLocalFile(mdFile: string, source: string, workspaceRoot: string): string | null {
  const trimmed = source.trim();
  if (!trimmed || trimmed.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return null;
  }
  const reference = splitResourceReference(trimmed);
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(reference.path);
  } catch {
    return null;
  }
  const absolutePath = decodedPath.startsWith('/')
    ? path.resolve(workspaceRoot, `.${decodedPath}`)
    : path.resolve(path.dirname(mdFile), decodedPath);
  const resolvedRealPath = realPath(absolutePath);
  const roots = [path.dirname(mdFile), workspaceRoot].map((r) => realPath(r)).filter((r): r is string => !!r);
  if (!resolvedRealPath || !roots.some((root) => isInside(root, resolvedRealPath))) {
    return null;
  }
  return resolvedRealPath;
}

function readDocText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function mimeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function openExternal(target: string): void {
  const {platform} = process;
  try {
    if (platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // best-effort
  }
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify(body)}\n`);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function assertMarkdownFile(filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  if (!hasMarkdownExtension(filePath)) {
    throw new Error(`不是 Markdown 文件: ${filePath}`);
  }
}

export function previewPageUrl(host: string, port: number, filePath: string): string {
  return `http://${host}:${port}/?file=${encodeURIComponent(filePath)}`;
}

export async function probePreviewServer(
  host: string,
  port: number,
): Promise<{ ok: boolean; pid?: number } | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 400);
  try {
    const res = await fetch(`http://${host}:${port}/api/health`, { signal: ac.signal });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as { ok: boolean; pid?: number };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function requestOpenFile(
  host: string,
  port: number,
  filePath: string,
): Promise<{ url: string } | null> {
  try {
    const res = await fetch(`http://${host}:${port}/api/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: filePath }),
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as { url: string };
  } catch {
    return null;
  }
}

export async function startPreviewServer(options: PreviewServerOptions): Promise<PreviewServer> {
  const {storageDir} = options;
  const host = options.host ?? DEFAULT_PREVIEW_HOST;
  const distDir = options.distDir ?? path.join(__dirname);
  const syncIntervalMs = options.syncIntervalMs ?? 5000;
  const idleExitMs = options.idleExitMs ?? DEFAULT_IDLE_EXIT_MS;
  const sessions = new Map<
    string,
    {
      fileWatcher?: fs.FSWatcher;
      storageWatcher?: fs.FSWatcher;
      renderTimer?: ReturnType<typeof setTimeout>;
      storageTimer?: ReturnType<typeof setTimeout>;
    }
  >();
  let lastActivity = Date.now();
  let closed = false;

  const touch = () => {
    lastActivity = Date.now();
  };

  const snapshotMessages = (filePath: string): HostToWebview[] => {
    const text = readDocText(filePath);
    const doc = PlainTextDocument.fromString(text);
    const threads = loadDoc(storageDir, filePath).threads.map((t) => toWire(t, doc));
    return [
      { type: 'render', text, threads, options: defaultRenderOptions() },
      { type: 'skillPromptTarget', enabled: true, tip: '复制 Skill 提示' },
    ];
  };

  const threadMessages = (filePath: string): HostToWebview[] => {
    const doc = PlainTextDocument.fromString(readDocText(filePath));
    return [
      { type: 'threads', threads: loadDoc(storageDir, filePath).threads.map((t) => toWire(t, doc)) },
      { type: 'skillPromptTarget', enabled: true, tip: '复制 Skill 提示' },
    ];
  };

  const resolveResources = (filePath: string, sources: string[], port: number): ResolvedPreviewResource[] =>
    sources.map((source) => {
      if (/^https:/i.test(source) || /^data:image\//i.test(source)) {
        return { source, uri: source };
      }
      const resolved = resolveLocalFile(filePath, source, path.dirname(filePath));
      if (!resolved) {
        return { source, error: '不允许读取该资源路径' };
      }
      if (!fs.existsSync(resolved)) {
        return { source, error: '资源文件不存在' };
      }
      return {
        source,
        uri: `http://${host}:${port}/file?path=${encodeURIComponent(resolved)}`,
      };
    });

  const handleMessage = (filePath: string, msg: WebviewToHost, port: number): HostToWebview[] => {
    if (isCommentMutation(msg.type)) {
      const stored = loadDoc(storageDir, filePath);
      const result = applyCommentMutation(stored, readDocText(filePath), msg);
      if (result.changed) {
        saveDoc(storageDir, filePath, stored);
      }
      return threadMessages(filePath);
    }
    switch (msg.type) {
      case 'ready':
        return snapshotMessages(filePath);
      case 'resolveResources':
        return [
          {
            type: 'resolvedResources',
            requestId: msg.requestId,
            resources: resolveResources(filePath, msg.sources, port),
          },
        ];
      case 'copySkillPrompt':
        return [{ type: 'skillPromptCopied' }];
      case 'openLink': {
        const href = msg.href.trim();
        if (href && !href.startsWith('#')) {
          if (/^https?:/i.test(href) || /^mailto:/i.test(href)) {
            openExternal(href);
          } else {
            const resolved = resolveLocalFile(filePath, href, path.dirname(filePath));
            if (resolved) {
              openExternal(resolved);
            }
          }
        }
        return [];
      }
      case 'openImage': {
        if (/^https:/i.test(msg.source)) {
          openExternal(msg.source);
        } else {
          const resolved = resolveLocalFile(filePath, msg.source, path.dirname(filePath));
          if (resolved) {
            openExternal(resolved);
          }
        }
        return [];
      }
      default:
        return [];
    }
  };

  const watchFile = (filePath: string) => {
    if (sessions.has(filePath)) {
      return;
    }
    const session: {
      fileWatcher?: fs.FSWatcher;
      storageWatcher?: fs.FSWatcher;
      renderTimer?: ReturnType<typeof setTimeout>;
      storageTimer?: ReturnType<typeof setTimeout>;
    } = {};
    try {
      session.fileWatcher = fs.watch(filePath, () => {
        if (session.renderTimer) {
          clearTimeout(session.renderTimer);
        }
        session.renderTimer = setTimeout(() => {
          touch();
        }, RENDER_DEBOUNCE_MS);
      });
    } catch {
      // unsupported
    }
    const docsDir = path.join(storageDir, 'docs');
    const myHash = fileHash(filePath);
    try {
      fs.mkdirSync(docsDir, { recursive: true });
      session.storageWatcher = fs.watch(docsDir, (_event, filename) => {
        if (!filename || String(filename).replace(/\.json$/, '') !== myHash) {
          return;
        }
        if (session.storageTimer) {
          clearTimeout(session.storageTimer);
        }
        session.storageTimer = setTimeout(() => touch(), 120);
      });
    } catch {
      // ignore
    }
    sessions.set(filePath, session);
  };

  const openFile = (filePath: string) => {
    const abs = path.resolve(filePath);
    assertMarkdownFile(abs);
    watchFile(abs);
    touch();
  };

  const parseFileParam = (raw: string | null): string => {
    if (!raw) {
      throw new Error('缺少 file');
    }
    const abs = path.resolve(raw);
    assertMarkdownFile(abs);
    watchFile(abs);
    return abs;
  };

  const server = http.createServer((req, res) => {
    touch();
    void (async () => {
      try {
        const url = new URL(req.url || '/', `http://${host}`);
        if (url.pathname === '/api/health') {
          writeJson(res, 200, { ok: true, pid: process.pid, files: [...sessions.keys()] });
          return;
        }
        if (url.pathname === '/api/open' && req.method === 'POST') {
          const body = JSON.parse(await readBody(req)) as { file?: string };
          const abs = parseFileParam(body.file ?? null);
          const addr = server.address();
          const port = addr && typeof addr !== 'string' ? addr.port : 0;
          writeJson(res, 200, { ok: true, url: previewPageUrl(host, port, abs) });
          return;
        }
        if ((url.pathname === '/api/snapshot' || url.pathname === '/api/threads') && req.method === 'GET') {
          const abs = parseFileParam(url.searchParams.get('file'));
          writeJson(res, 200, {
            ok: true,
            file: abs,
            prompt: formatSkillPrompt(abs),
            messages: url.pathname === '/api/threads' ? threadMessages(abs) : snapshotMessages(abs),
          });
          return;
        }
        if ((url.pathname === '/api/flush' || url.pathname === '/api/message') && req.method === 'POST') {
          const body = JSON.parse(await readBody(req)) as {
            file?: string;
            message?: unknown;
            messages?: unknown;
          };
          const abs = parseFileParam(body.file ?? null);
          const addr = server.address();
          const port = addr && typeof addr !== 'string' ? addr.port : 0;
          const incoming: unknown[] =
            url.pathname === '/api/message'
              ? [body.message]
              : Array.isArray(body.messages)
                ? body.messages
                : [];
          const out: HostToWebview[] = [];
          for (const item of incoming) {
            if (!isWebviewMessage(item)) {
              continue;
            }
            out.push(...handleMessage(abs, item, port));
          }
          if (url.pathname === '/api/flush' && incoming.length === 0) {
            out.push(...snapshotMessages(abs));
          }
          writeJson(res, 200, { ok: true, messages: out, prompt: formatSkillPrompt(abs) });
          return;
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          const abs = parseFileParam(url.searchParams.get('file'));
          const extraHead = `<script>window.mdcBrowser=${JSON.stringify({
            file: abs,
            syncIntervalMs,
            apiBase: '',
          })};</script>\n`;
          const html = buildPreviewHtml({
            title: `评论预览：${path.basename(abs)}`,
            scriptUri: '/webview.js',
            styleUri: '/webview.css',
            includeBrowserTheme: true,
            extraHead,
            bodyClass: 'mdc-browser',
          });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(html);
          return;
        }
        if (
          url.pathname === '/webview.js' ||
          url.pathname === '/webview.css' ||
          url.pathname.startsWith('/assets/')
        ) {
          const asset = path.join(distDir, url.pathname.slice(1));
          if (!isInside(distDir, asset) || !fs.existsSync(asset)) {
            res.writeHead(404).end('Not found');
            return;
          }
          res.writeHead(200, {
            'Content-Type': mimeFor(asset),
            'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=86400' : 'no-cache',
          });
          fs.createReadStream(asset).pipe(res);
          return;
        }
        if (url.pathname === '/file') {
          const target = url.searchParams.get('path') || '';
          const resolved = realPath(target);
          const file = url.searchParams.get('file');
          const md = file ? path.resolve(file) : [...sessions.keys()][0];
          const roots = (md ? [path.dirname(md)] : [])
            .map((r) => realPath(r))
            .filter((r): r is string => !!r);
          if (
            !resolved ||
            !md ||
            !roots.some((root) => isInside(root, resolved)) ||
            !fs.existsSync(resolved)
          ) {
            res.writeHead(403).end('Forbidden');
            return;
          }
          if (target.length > MAX_LINK_LENGTH) {
            res.writeHead(400).end('Bad request');
            return;
          }
          res.writeHead(200, { 'Content-Type': mimeFor(resolved) });
          fs.createReadStream(resolved).pipe(res);
          return;
        }
        res.writeHead(404).end('Not found');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/缺少 file|文件不存在|不是 Markdown/.test(message)) {
          writeJson(res, 400, { ok: false, error: message });
          return;
        }
        writeJson(res, 500, { ok: false, error: message });
      }
    })();
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind preview server'));
        return;
      }
      resolve(addr.port);
    });
  });

  let idleTimer: ReturnType<typeof setInterval> | undefined;
  if (idleExitMs > 0) {
    idleTimer = setInterval(
      () => {
        if (Date.now() - lastActivity >= idleExitMs) {
          void close().finally(() => process.exit(0));
        }
      },
      Math.min(30_000, idleExitMs),
    );
  }

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    if (idleTimer) {
      clearInterval(idleTimer);
    }
    for (const session of sessions.values()) {
      if (session.renderTimer) {
        clearTimeout(session.renderTimer);
      }
      if (session.storageTimer) {
        clearTimeout(session.storageTimer);
      }
      session.fileWatcher?.close();
      session.storageWatcher?.close();
    }
    sessions.clear();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return {
    urlFor: (filePath: string) => previewPageUrl(host, port, path.resolve(filePath)),
    port,
    host,
    syncIntervalMs,
    openFile,
    close,
  };
}
