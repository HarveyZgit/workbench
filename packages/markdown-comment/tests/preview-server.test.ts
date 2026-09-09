import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { loadDoc } from '../src/storage.ts';
import { startPreviewServer } from '../src/preview/web-server.ts';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('preview server flush persists comments visible to loadDoc', async () => {
  const storage = tmp('mdc-preview-store-');
  const workspace = tmp('mdc-preview-ws-');
  const md = path.join(workspace, 'note.md');
  fs.writeFileSync(md, '# Hello\n\nWorld\n', 'utf8');

  const server = await startPreviewServer({
    storageDir: storage,
    port: 0,
    host: '127.0.0.1',
    distDir: tmp('mdc-preview-dist-'),
    syncIntervalMs: 5000,
    idleExitMs: 0,
  });
  try {
    server.openFile(md);
    const url = server.urlFor(md);
    assert.match(url, /file=/);

    const health = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    assert.equal(health.ok, true);
    const flushed = await fetch(`http://127.0.0.1:${server.port}/api/flush`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: md,
        messages: [{ type: 'createDocThread', text: 'from browser' }],
      }),
    });
    const flushText = await flushed.text();
    assert.equal(flushed.ok, true, flushText);
    const body = JSON.parse(flushText) as { ok: boolean; messages: unknown[] };
    assert.equal(body.ok, true);

    const stored = loadDoc(storage, md);
    assert.equal(stored.threads.length, 1);
    assert.equal(stored.threads[0].comments[0].body, 'from browser');
    assert.equal(stored.threads[0].anchor.kind, 'document');

    const listed = await fetch(`http://127.0.0.1:${server.port}/api/snapshot?file=${encodeURIComponent(md)}`);
    assert.equal(listed.ok, true);
    const snap = (await listed.json()) as { messages: Array<{ type: string; threads?: unknown[] }> };
    const render = snap.messages.find((m) => m.type === 'render');
    assert.ok(render);
    assert.equal(render?.threads?.length, 1);
  } finally {
    await server.close();
  }
});
