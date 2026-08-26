import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  SKILL_NAME,
  canonicalDir,
  canonicalSkillFile,
  detectAgentSkillRoots,
  expandHome,
  installSkill,
  linkStatus,
  normalizeRoot,
  readState,
  reconcile,
  removeManagedLink,
  removeSkill,
  resolveSkillBody,
  writeCanonicalSkill,
  writeState,
} from '../src/skill-install.ts';

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(file: string, body: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

const LEGACY_SKILL = ['---', 'name: markdown-comment', 'description: legacy', '---', '', '# old'].join('\n');

test('SKILL_NAME and path helpers', () => {
  assert.equal(SKILL_NAME, 'markdown-comment');
  assert.equal(canonicalDir('/gs'), path.join('/gs', 'skill', SKILL_NAME));
  assert.equal(canonicalSkillFile('/gs'), path.join('/gs', 'skill', SKILL_NAME, 'SKILL.md'));
  assert.equal(expandHome('~'), os.homedir());
  assert.equal(expandHome('~/skills'), path.join(os.homedir(), 'skills'));
  assert.equal(expandHome('~\\skills'), path.join(os.homedir(), 'skills'));
  assert.equal(expandHome('  /abs/root  '), '/abs/root');
  assert.equal(normalizeRoot('~/x'), path.resolve(path.join(os.homedir(), 'x')));
});

test('detectAgentSkillRoots only finds dot-folder skills dirs', () => {
  const home = tmp('mdc-home-');
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(home, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(home, '.plain'), { recursive: true });
  write(path.join(home, '.filehome', 'skills'), 'not-a-dir');
  const found = detectAgentSkillRoots(home);
  assert.deepEqual(
    found,
    [path.join(home, '.claude', 'skills'), path.join(home, '.codex', 'skills')].sort(),
  );
  assert.equal(detectAgentSkillRoots(path.join(home, 'missing-home')).length, 0);
});

test('resolveSkillBody replaces CLI placeholders', () => {
  const file = path.join(tmp('mdc-skill-'), 'SKILL.md');
  write(file, 'use {{CLI}} then {{CLI}} again');
  assert.equal(resolveSkillBody(file, 'mdc'), 'use mdc then mdc again');
});

test('writeCanonicalSkill does not rewrite mtime when body is unchanged', () => {
  const gs = tmp('mdc-gs-');
  const dir = writeCanonicalSkill(gs, '# v1\n');
  const file = canonicalSkillFile(gs);
  assert.equal(dir, canonicalDir(gs));
  assert.equal(fs.readFileSync(file, 'utf8'), '# v1\n');
  const first = fs.statSync(file).mtimeMs;
  const past = first - 60_000;
  fs.utimesSync(file, past / 1000, past / 1000);
  const frozen = fs.statSync(file).mtimeMs;
  writeCanonicalSkill(gs, '# v1\n');
  assert.equal(fs.statSync(file).mtimeMs, frozen);
  writeCanonicalSkill(gs, '# v2\n');
  assert.notEqual(fs.readFileSync(file, 'utf8'), '# v1\n');
});

test('installSkill covers installed refreshed skipped and migrated outcomes', () => {
  const gs = tmp('mdc-gs-');
  const installedRoot = path.join(tmp('mdc-root-'), 'skills');
  const refreshRoot = path.join(tmp('mdc-root-'), 'skills');
  const foreignLinkRoot = path.join(tmp('mdc-root-'), 'skills');
  const foreignRealRoot = path.join(tmp('mdc-root-'), 'skills');
  const legacyRoot = path.join(tmp('mdc-root-'), 'skills');

  const first = installSkill(gs, [installedRoot], '# body\n');
  assert.deepEqual(first.installed, [path.resolve(installedRoot)]);
  assert.equal(fs.lstatSync(path.join(installedRoot, SKILL_NAME)).isSymbolicLink(), true);

  const again = installSkill(gs, [installedRoot], '# body\n');
  assert.deepEqual(again.refreshed, [path.resolve(installedRoot)]);
  assert.equal(again.installed.length, 0);

  fs.mkdirSync(refreshRoot, { recursive: true });
  fs.symlinkSync(canonicalDir(gs), path.join(refreshRoot, SKILL_NAME));
  const refreshed = installSkill(gs, [refreshRoot], '# body\n');
  assert.ok(refreshed.refreshed.includes(path.resolve(refreshRoot)));

  fs.mkdirSync(foreignLinkRoot, { recursive: true });
  fs.symlinkSync(os.tmpdir(), path.join(foreignLinkRoot, SKILL_NAME));
  const skipLink = installSkill(gs, [foreignLinkRoot], '# body\n');
  assert.equal(skipLink.skipped[0]?.root, path.resolve(foreignLinkRoot));
  assert.match(skipLink.skipped[0]?.reason ?? '', /其他内容占用/);

  fs.mkdirSync(path.join(foreignRealRoot, SKILL_NAME), { recursive: true });
  write(path.join(foreignRealRoot, SKILL_NAME, 'SKILL.md'), '---\nname: other\n---\n');
  const skipReal = installSkill(gs, [foreignRealRoot], '# body\n');
  assert.equal(skipReal.skipped[0]?.root, path.resolve(foreignRealRoot));
  assert.match(skipReal.skipped[0]?.reason ?? '', /同名文件/);

  write(path.join(legacyRoot, SKILL_NAME, 'SKILL.md'), LEGACY_SKILL);
  const migrated = installSkill(gs, [legacyRoot], '# body\n');
  assert.deepEqual(migrated.migrated, [path.resolve(legacyRoot)]);
  assert.equal(fs.lstatSync(path.join(legacyRoot, SKILL_NAME)).isSymbolicLink(), true);
  assert.ok(fs.readdirSync(legacyRoot).some((name) => name.startsWith(`${SKILL_NAME}.bak-`)));
});

test('linkStatus classifies ours stale foreign and missing', () => {
  const gs = tmp('mdc-gs-');
  const canonical = writeCanonicalSkill(gs, '# c\n');
  const missingRoot = path.join(tmp('mdc-root-'), 'skills');
  assert.equal(linkStatus(missingRoot, canonical).kind, 'missing');

  const oursRoot = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(oursRoot, { recursive: true });
  fs.symlinkSync(canonical, path.join(oursRoot, SKILL_NAME));
  const ours = linkStatus(oursRoot, canonical);
  assert.equal(ours.kind, 'ours');
  assert.equal(ours.currentTarget, path.resolve(canonical));

  const staleDirRoot = path.join(tmp('mdc-root-'), 'skills');
  write(path.join(staleDirRoot, SKILL_NAME, 'SKILL.md'), LEGACY_SKILL);
  assert.equal(linkStatus(staleDirRoot, canonical).kind, 'ours-stale');

  const danglingRoot = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(danglingRoot, { recursive: true });
  fs.symlinkSync(path.join(tmp('mdc-gone-'), SKILL_NAME), path.join(danglingRoot, SKILL_NAME));
  assert.equal(linkStatus(danglingRoot, canonical).kind, 'ours-stale');

  const oldFamily = tmp('mdc-old-');
  const oldCanonical = path.join(oldFamily, 'skill', SKILL_NAME);
  fs.mkdirSync(oldCanonical, { recursive: true });
  const staleLinkRoot = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(staleLinkRoot, { recursive: true });
  fs.symlinkSync(oldCanonical, path.join(staleLinkRoot, SKILL_NAME));
  assert.equal(linkStatus(staleLinkRoot, canonical).kind, 'ours-stale');

  const legacyTarget = path.join(tmp('mdc-old-'), SKILL_NAME);
  write(path.join(legacyTarget, 'SKILL.md'), LEGACY_SKILL);
  const legacyLinkRoot = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(legacyLinkRoot, { recursive: true });
  fs.symlinkSync(legacyTarget, path.join(legacyLinkRoot, SKILL_NAME));
  assert.equal(linkStatus(legacyLinkRoot, canonical).kind, 'ours-stale');

  const foreignLinkRoot = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(foreignLinkRoot, { recursive: true });
  fs.symlinkSync(os.tmpdir(), path.join(foreignLinkRoot, SKILL_NAME));
  assert.equal(linkStatus(foreignLinkRoot, canonical).kind, 'foreign-link');

  const foreignRealRoot = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(path.join(foreignRealRoot, SKILL_NAME), { recursive: true });
  write(path.join(foreignRealRoot, SKILL_NAME, 'notes.md'), 'nope');
  assert.equal(linkStatus(foreignRealRoot, canonical).kind, 'foreign-real');
});

test('removeSkill and removeManagedLink skip foreign content', () => {
  const gs = tmp('mdc-gs-');
  const ours = path.join(tmp('mdc-root-'), 'skills');
  const foreign = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(path.join(foreign, SKILL_NAME), { recursive: true });
  write(path.join(foreign, SKILL_NAME, 'keep.txt'), 'user');
  const installed = installSkill(gs, [ours], '# body\n');
  assert.equal(installed.installed.length, 1);

  const skip = removeSkill(gs, [foreign]);
  assert.equal(skip.skipped[0]?.root, path.resolve(foreign));
  assert.equal(fs.existsSync(path.join(foreign, SKILL_NAME, 'keep.txt')), true);

  const missing = removeManagedLink(path.join(tmp('mdc-root-'), 'none'), canonicalDir(gs));
  assert.equal(missing.ok, true);
  assert.match(missing.reason ?? '', /没有安装/);

  const foreignLinkRoot = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(foreignLinkRoot, { recursive: true });
  fs.symlinkSync(os.tmpdir(), path.join(foreignLinkRoot, SKILL_NAME));
  const skipLink = removeManagedLink(foreignLinkRoot, canonicalDir(gs));
  assert.equal(skipLink.ok, false);

  const removed = removeSkill(gs, [ours]);
  assert.deepEqual(removed.removed, [path.resolve(ours)]);
  assert.equal(fs.existsSync(canonicalDir(gs)), false);
  assert.deepEqual(readState(gs).roots, []);
});

test('writeState dedupes roots and readState is tolerant', () => {
  const gs = tmp('mdc-gs-');
  writeState(gs, { version: 9, roots: ['/a', '/a', '/b', '/a'] });
  assert.deepEqual(readState(gs), { version: 1, roots: ['/a', '/b'] });
  write(path.join(gs, 'skill-install.json'), '{"roots":[1,"/ok",null,"/ok"]}');
  assert.deepEqual(readState(gs).roots, ['/ok']);
  write(path.join(gs, 'skill-install.json'), '{"no":"roots"}');
  assert.deepEqual(readState(gs).roots, []);
  write(path.join(gs, 'skill-install.json'), 'not-json');
  assert.deepEqual(readState(gs).roots, []);
  assert.deepEqual(readState(path.join(gs, 'missing')).roots, []);
});

test('reconcile no-ops on empty, reinstalls missing ours, drops foreign-real roots', () => {
  const gs = tmp('mdc-gs-');
  reconcile(gs, '# unused\n');
  assert.equal(fs.existsSync(canonicalSkillFile(gs)), false);

  const ours = path.join(tmp('mdc-root-'), 'skills');
  const foreign = path.join(tmp('mdc-root-'), 'skills');
  fs.mkdirSync(path.join(foreign, SKILL_NAME), { recursive: true });
  write(path.join(foreign, SKILL_NAME, 'other.md'), 'x');
  installSkill(gs, [ours, foreign], '# body\n');
  fs.rmSync(path.join(ours, SKILL_NAME), { force: true });
  assert.equal(linkStatus(ours, canonicalDir(gs)).kind, 'missing');

  reconcile(gs, '# newer\n');
  const state = readState(gs);
  assert.ok(state.roots.includes(path.resolve(ours)));
  assert.equal(state.roots.includes(path.resolve(foreign)), false);
  assert.equal(linkStatus(ours, canonicalDir(gs)).kind, 'ours');
  assert.equal(fs.readFileSync(canonicalSkillFile(gs), 'utf8'), '# newer\n');
});
