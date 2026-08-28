import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  cmdExtension,
  cmdInstallSkill,
  detectAgentSkillRoots,
  expandHome,
  finishSkillSelection,
  readExtensionId,
} from '../src/cli/install.js';
import { loadSkillPrefs } from '../src/cli/skill-picker.js';
import { defaultStorageDir, extensionDir, isSourceTree, packageRoot } from '../src/paths.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-inst-'));
}

test('readExtensionId override and file', () => {
  assert.equal(readExtensionId('abc'), 'abc');
  assert.match(readExtensionId(), /^[a-z]{32}$/);
});

test('cmdExtension prints dist after build or fails cleanly', () => {
  const dir = extensionDir();
  const manifest = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifest)) {
    const logs: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      cmdExtension();
    } finally {
      process.stdout.write = write;
    }
    assert.match(logs.join(''), /chrome-mv3/);
  } else {
    assert.ok(packageRoot().endsWith('dom-comment'));
  }
});

test('cmdInstallSkill skips a regular file at dest', () => {
  const destRoot = tmpDir();
  fs.mkdirSync(destRoot, { recursive: true });
  fs.writeFileSync(path.join(destRoot, 'dom-comment'), 'not-a-link');
  cmdInstallSkill([destRoot]);
  assert.equal(fs.lstatSync(path.join(destRoot, 'dom-comment')).isSymbolicLink(), false);
});

test('detectAgentSkillRoots ignores missing home', () => {
  assert.deepEqual(detectAgentSkillRoots(path.join(tmpDir(), 'nope')), []);
});

test('expandHome resolves slash forms', () => {
  assert.equal(expandHome('~/x'), path.join(os.homedir(), 'x'));
  assert.ok(path.isAbsolute(expandHome('rel-path')));
});

test('isSourceTree and defaultStorageDir in this checkout', () => {
  assert.equal(isSourceTree(), true);
  assert.equal(defaultStorageDir(), path.join(packageRoot(), 'data'));
  assert.equal(isSourceTree(tmpDir()), false);
});

test('finishSkillSelection skips skills and remembers empty targets', () => {
  const store = tmpDir();
  process.env.DOM_COMMENT_STORAGE_DIR = store;
  const logs: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    logs.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    finishSkillSelection([]);
  } finally {
    process.stdout.write = write;
  }
  assert.match(logs.join(''), /已跳过 Skill/);
  assert.deepEqual(loadSkillPrefs(store), { targets: [] });
});

test('finishSkillSelection installs and remembers chosen roots', () => {
  const store = tmpDir();
  const dest = tmpDir();
  process.env.DOM_COMMENT_STORAGE_DIR = store;
  finishSkillSelection([dest]);
  assert.ok(fs.lstatSync(path.join(dest, 'dom-comment')).isSymbolicLink());
  assert.deepEqual(loadSkillPrefs(store), { targets: [path.resolve(dest)] });
});
