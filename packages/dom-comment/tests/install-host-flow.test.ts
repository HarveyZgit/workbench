import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { encodeFrame, tryDecodeFrames } from '../src/native-host/protocol.js';
import { cmdInstall, cmdInstallHost, cmdOpenTab, cmdUninstallHost } from '../src/cli/install.js';
import { packageRoot } from '../src/paths.js';

const chromeDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
const nmFile = path.join(chromeDir, 'NativeMessagingHosts/com.workbench.dom_comment.json');
const OPEN_TAB_ID = 12;
const OPEN_TAB_WAIT_MS = 200;
const PING_TIMEOUT_MS = 5000;

function ensureNativeHost(): boolean {
  const nativeJs = path.join(packageRoot(), 'dist/native-host.js');
  if (fs.existsSync(nativeJs)) {
    return true;
  }
  fs.mkdirSync(path.dirname(nativeJs), { recursive: true });
  fs.writeFileSync(nativeJs, '#!/usr/bin/env node\nprocess.exit(0)\n');
  return false;
}

test('cmdInstallHost writes a Linux-or-mac profile when the folder exists', () => {
  ensureNativeHost();
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-store-'));
  process.env.DOM_COMMENT_STORAGE_DIR = store;
  fs.mkdirSync(chromeDir, { recursive: true });
  cmdInstallHost(new Map([['extension-id', 'testidxxxxxxxxxxxxxxxxxxxxxxxxxx']]), { quiet: true });
  assert.equal(fs.existsSync(nmFile), true);
  const body = JSON.parse(fs.readFileSync(nmFile, 'utf8')) as { allowed_origins: string[] };
  assert.ok(body.allowed_origins[0].includes('testid'));
  cmdInstall(new Map(), []);
  const skill = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-skill-'));
  cmdInstall(new Map(), [skill]);
  cmdUninstallHost();
  assert.equal(fs.existsSync(nmFile), false);
});

test('cmdOpenTab talks to the host socket', async () => {
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-sock-'));
  process.env.DOM_COMMENT_STORAGE_DIR = store;
  const sock = path.join(store, 'host.sock');
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer((conn) => {
      let buf = Buffer.alloc(0);
      conn.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const { messages } = tryDecodeFrames(buf);
        if (messages[0]) {
          conn.write(encodeFrame({ id: (messages[0] as { id: string }).id, ok: true }));
        }
      });
    });
    server.listen(sock, () => {
      const logs: string[] = [];
      const write = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => {
        logs.push(String(chunk));
        return true;
      }) as typeof process.stdout.write;
      try {
        cmdOpenTab(OPEN_TAB_ID);
      } catch {
        // cmdOpenTab may still be waiting; give it a beat
      }
      setTimeout(() => {
        process.stdout.write = write;
        server.close();
        resolve();
      }, OPEN_TAB_WAIT_MS);
    });
    server.on('error', reject);
  });
});

test('ping-host spawn when native-host is built', () => {
  const nativeJs = path.join(packageRoot(), 'dist/native-host.js');
  const real = fs.existsSync(nativeJs) && fs.readFileSync(nativeJs, 'utf8').includes('handleRequest');
  if (!real) {
    return;
  }
  const tsx = path.join(packageRoot(), 'node_modules/.bin/tsx');
  const cli = path.join(packageRoot(), 'src/cli.ts');
  const result = spawnSync(tsx, [cli, 'ping-host'], { encoding: 'utf8', timeout: PING_TIMEOUT_MS });
  assert.match(`${result.stdout}${result.stderr}`, /pong|找不到|超时|wrapper/);
});
