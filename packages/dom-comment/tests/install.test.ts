import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  chromeNativeMessagingProfileRoots,
  cmdInstallSkill,
  detectAgentSkillRoots,
  expandHome,
} from '../src/cli/install.js';
import { extensionDir, isSourceTree, packageRoot, skillSourceDir } from '../src/paths.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-install-'));
}

test('packageRoot is the package and source tree is detected here', () => {
  const root = packageRoot();
  assert.equal(path.basename(root), 'dom-comment');
  assert.equal(isSourceTree(root), true);
  assert.equal(path.basename(extensionDir(root)), 'chrome-mv3');
  assert.ok(fs.existsSync(path.join(skillSourceDir(root), 'SKILL.md')));
});

test('detectAgentSkillRoots only lists existing ~/.<name>/skills', () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, '.agents', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(home, 'plain', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(home, '.empty'), { recursive: true });
  assert.deepEqual(detectAgentSkillRoots(home), [path.join(home, '.agents', 'skills')]);
});

test('expandHome resolves ~', () => {
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/skills'), path.join(os.homedir(), 'skills'));
});

test('cmdInstallSkill creates a managed symlink', () => {
  const destRoot = tmpDir();
  cmdInstallSkill([destRoot]);
  const link = path.join(destRoot, 'dom-comment');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(link, 'SKILL.md')));
  assert.equal(fs.readlinkSync(link), skillSourceDir());
});

test('install.sh --from-dir --skip-setup links the CLI', () => {
  const prefix = tmpDir();
  const binDir = path.join(prefix, 'bin');
  const src = tmpDir();
  fs.mkdirSync(path.join(src, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(src, 'dist', 'cli.js'), '#!/usr/bin/env node\nconsole.log("ok")\n');
  fs.chmodSync(path.join(src, 'dist', 'cli.js'), 0o755);
  fs.writeFileSync(path.join(src, 'chrome-extension.json'), '{"id":"x"}\n');
  const script = path.join(packageRoot(), 'scripts', 'install.sh');
  const result = spawnSync('bash', [script, '--from-dir', src, '--skip-setup'], {
    encoding: 'utf8',
    env: { ...process.env, DOM_COMMENT_PREFIX: prefix, DOM_COMMENT_BIN_DIR: binDir },
  });
  assert.equal(result.status, 0, result.stderr);
  const linked = path.join(binDir, 'dom-comment');
  assert.ok(fs.lstatSync(linked).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(prefix, 'pkg', 'dist', 'cli.js')));
});

test('chromeNativeMessagingProfileRoots includes macOS and Linux user dirs', () => {
  const roots = chromeNativeMessagingProfileRoots('/tmp/home');
  const paths = roots.map((item) => item.profileRoot);
  assert.ok(paths.includes('/tmp/home/Library/Application Support/Google/Chrome'));
  assert.ok(paths.includes('/tmp/home/.config/google-chrome'));
  assert.ok(paths.includes('/tmp/home/.config/chromium'));
});
