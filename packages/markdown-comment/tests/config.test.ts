import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  clampSyncIntervalSeconds,
  DEFAULT_SYNC_INTERVAL_SECONDS,
  readUserConfig,
  resolveSyncIntervalSeconds,
} from '../src/config.ts';

function withHome<T>(fn: () => T): T {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-cfg-'));
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    return fn();
  } finally {
    if (prev === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = prev;
    }
  }
}

test('clampSyncIntervalSeconds keeps the default window', () => {
  assert.equal(clampSyncIntervalSeconds(Number.NaN), DEFAULT_SYNC_INTERVAL_SECONDS);
  assert.equal(clampSyncIntervalSeconds(0), 1);
  assert.equal(clampSyncIntervalSeconds(999), 300);
  assert.equal(clampSyncIntervalSeconds(5.4), 5);
});

test('resolveSyncIntervalSeconds prefers cli then env then config', () => {
  withHome(() => {
    const prev = process.env.MARKDOWN_COMMENT_SYNC_INTERVAL;
    delete process.env.MARKDOWN_COMMENT_SYNC_INTERVAL;
    fs.mkdirSync(path.join(process.env.HOME!, '.markdown-comment'), { recursive: true });
    fs.writeFileSync(
      path.join(process.env.HOME!, '.markdown-comment', 'config.json'),
      JSON.stringify({ syncIntervalSeconds: 12 }),
    );
    assert.equal(resolveSyncIntervalSeconds(), 12);
    process.env.MARKDOWN_COMMENT_SYNC_INTERVAL = '8';
    assert.equal(resolveSyncIntervalSeconds(), 8);
    assert.equal(resolveSyncIntervalSeconds(3), 3);
    if (prev === undefined) {
      delete process.env.MARKDOWN_COMMENT_SYNC_INTERVAL;
    } else {
      process.env.MARKDOWN_COMMENT_SYNC_INTERVAL = prev;
    }
    assert.deepEqual(readUserConfig(), { syncIntervalSeconds: 12 });
  });
});
