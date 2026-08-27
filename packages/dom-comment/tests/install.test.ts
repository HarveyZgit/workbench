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

test('npm pack then npm install --global --prefix exposes the CLI', () => {
  const executable = 0o755;
  const prefix = tmpDir();
  const pkg = tmpDir();
  const pkgJson = {
    name: 'dom-comment',
    version: '0.0.0-test',
    bin: { 'dom-comment': './dist/cli.js' },
    files: ['dist/cli.js'],
  };
  fs.writeFileSync(path.join(pkg, 'package.json'), `${JSON.stringify(pkgJson)}\n`);
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'dist', 'cli.js'), '#!/usr/bin/env node\nconsole.log("ok")\n');
  fs.chmodSync(path.join(pkg, 'dist', 'cli.js'), executable);
  const packed = spawnSync('npm', ['pack'], { cwd: pkg, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const tgzName = packed.stdout.trim().split('\n').pop() ?? '';
  const tgz = path.join(pkg, tgzName);
  assert.ok(fs.existsSync(tgz), packed.stdout);
  const installed = spawnSync('npm', ['install', '-g', '--prefix', prefix, tgz], {
    encoding: 'utf8',
  });
  assert.equal(installed.status, 0, installed.stderr);
  const bin = path.join(prefix, 'bin', 'dom-comment');
  assert.ok(fs.existsSync(bin));
  const ran = spawnSync(bin, [], { encoding: 'utf8' });
  assert.equal(ran.status, 0, ran.stderr);
  assert.match(ran.stdout, /ok/);
});

test('pack-release.sh emits dist/dom-comment-*.tgz', () => {
  const root = packageRoot();
  const dist = path.join(root, 'dist');
  const cliJs = path.join(dist, 'cli.js');
  const manifest = path.join(dist, 'chrome-mv3', 'manifest.json');
  if (!fs.existsSync(cliJs) || !fs.existsSync(manifest)) {
    const built = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-node.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(built.status, 0, built.stderr);
  }
  const script = path.join(root, 'scripts', 'pack-release.sh');
  const packed = spawnSync('bash', [script], { cwd: root, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr + packed.stdout);
  const printed = packed.stdout.trim().split('\n').pop() ?? '';
  assert.match(printed, /dom-comment-.*\.tgz$/);
  assert.ok(fs.existsSync(printed));
  assert.ok(fs.statSync(printed).size > 0);
});

test('chromeNativeMessagingProfileRoots includes macOS and Linux user dirs', () => {
  const roots = chromeNativeMessagingProfileRoots('/tmp/home');
  const paths = roots.map((item) => item.profileRoot);
  assert.ok(paths.includes('/tmp/home/Library/Application Support/Google/Chrome'));
  assert.ok(paths.includes('/tmp/home/.config/google-chrome'));
  assert.ok(paths.includes('/tmp/home/.config/chromium'));
});
