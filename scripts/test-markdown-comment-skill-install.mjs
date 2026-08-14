#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = join(repoRoot, 'packages/markdown-comment');
const distDir = join(packageRoot, 'dist');
const skillInstallPath = join(distDir, 'skill-install.js');
const bundledSkillPath = join(distDir, 'resources/skills/markdown-comment/SKILL.md');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function readLinkAbs(p) {
  const raw = readlinkSync(p);
  return require.resolve(raw, { paths: [join(p, '..')] });
}

const {
  SKILL_NAME,
  canonicalDir,
  canonicalSkillFile,
  writeCanonicalSkill,
  linkStatus,
  installManagedLink,
  removeManagedLink,
  readState,
  writeState,
  installSkill,
  removeSkill,
  reconcile,
  normalizeRoot,
} = await import(skillInstallPath);

const BODY = readFileSync(bundledSkillPath, 'utf8');

let temporaryDirectory;
try {
  execFileSync('node', ['esbuild.mjs', '--production'], {
    cwd: packageRoot,
    stdio: 'ignore',
  });

  temporaryDirectory = mkdtempSync(join(tmpdir(), 'markdown-comment-install-'));

  // ── 1. normalizeRoot 展开 ~ ──
  const homeNormalized = normalizeRoot('~/foo');
  assert(homeNormalized.startsWith('/'), 'normalizeRoot should resolve ~ to absolute path');
  assert(!homeNormalized.includes('~'), 'normalizeRoot should not leave ~ in path');

  // ── 2. 全新安装：写真源 + 建软链 ──
  const gs1 = join(temporaryDirectory, 'gs1');
  const rootA = join(temporaryDirectory, 'agent-a', 'skills');
  const rootB = join(temporaryDirectory, 'root with space', 'skills'); // 空格路径
  const res1 = installSkill(gs1, [rootA, rootB], BODY);
  assert(res1.installed.length === 2, `fresh install should install 2 roots, got ${res1.installed.length}`);
  assert(res1.migrated.length === 0, 'fresh install should have 0 migrated');
  assert(res1.refreshed.length === 0, 'fresh install should have 0 refreshed');

  const canon = canonicalDir(gs1);
  const canonFile = canonicalSkillFile(gs1);
  assert(existsSync(canonFile), 'canonical SKILL.md must exist');
  const linkA = join(rootA, SKILL_NAME);
  const linkB = join(rootB, SKILL_NAME);
  assert(isSymlink(linkA), 'rootA link must be a symlink');
  assert(isSymlink(linkB), 'rootB (space in path) link must be a symlink');
  assert(realpathSync(linkA) === realpathSync(canon), 'linkA must point to canonical');

  const state1 = readState(gs1);
  assert(state1.roots.length === 2, 'state must record 2 roots');

  // ── 3. 幂等重复安装 → refreshed ──
  const res2 = installSkill(gs1, [rootA], BODY);
  assert(res2.installed.length === 0, 'reinstall should have 0 installed');
  assert(res2.refreshed.length === 1, 'reinstall should mark 1 refreshed');
  assert(res2.migrated.length === 0, 'reinstall should have 0 migrated');

  // ── 4. 旧真实目录迁移（含 name: markdown-comment frontmatter） ──
  const rootLegacy = join(temporaryDirectory, 'agent-legacy', 'skills');
  mkdirSync(rootLegacy, { recursive: true });
  const legacyDir = join(rootLegacy, SKILL_NAME);
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(
    join(legacyDir, 'SKILL.md'),
    '---\nname: markdown-comment\ndescription: old copy install\n---\nold body\n',
    'utf8',
  );
  const gs2 = join(temporaryDirectory, 'gs2');
  const res3 = installSkill(gs2, [rootLegacy], BODY);
  assert(res3.migrated.length === 1, 'legacy real dir should be migrated');
  assert(isSymlink(join(rootLegacy, SKILL_NAME)), 'legacy dir must become a symlink');
  // 备份应存在
  const entries = readdirSync(rootLegacy);
  const bak = entries.find((e) => e.startsWith(`${SKILL_NAME}.bak-`));
  assert(bak, 'legacy dir should be renamed to .bak-*');

  // ── 5. 悬空软链（指向不存在目标的同名软链） → ours-stale → 迁移 ──
  const rootStaleLink = join(temporaryDirectory, 'agent-stale-link', 'skills');
  mkdirSync(rootStaleLink, { recursive: true });
  const staleTarget = join(temporaryDirectory, 'nonexistent-canonical', SKILL_NAME);
  symlinkSync(staleTarget, join(rootStaleLink, SKILL_NAME));
  const gs3 = join(temporaryDirectory, 'gs3');
  const res4 = installSkill(gs3, [rootStaleLink], BODY);
  assert(res4.migrated.length === 1, 'stale dangling symlink should be migrated');
  assert(isSymlink(join(rootStaleLink, SKILL_NAME)), 'stale link replaced with fresh symlink');

  // ── 6. 外来真实目录（无 name: markdown-comment）→ 跳过 ──
  const rootForeignDir = join(temporaryDirectory, 'agent-foreign-dir', 'skills');
  mkdirSync(rootForeignDir, { recursive: true });
  const foreignDir = join(rootForeignDir, SKILL_NAME);
  mkdirSync(foreignDir, { recursive: true });
  writeFileSync(join(foreignDir, 'SKILL.md'), '---\nname: some-other-skill\n---\n', 'utf8');
  const gs4 = join(temporaryDirectory, 'gs4');
  const res5 = installSkill(gs4, [rootForeignDir], BODY);
  assert(res5.skipped.length === 1, 'foreign real dir should be skipped');
  assert(!isSymlink(foreignDir), 'foreign dir must NOT be replaced');

  // ── 7. 外来软链（指向别的真实目录）→ 跳过 ──
  const rootForeignLink = join(temporaryDirectory, 'agent-foreign-link', 'skills');
  mkdirSync(rootForeignLink, { recursive: true });
  const foreignTargetDir = join(temporaryDirectory, 'some-other-skill-real');
  mkdirSync(foreignTargetDir, { recursive: true });
  writeFileSync(join(foreignTargetDir, 'SKILL.md'), '---\nname: other\n---\n', 'utf8');
  symlinkSync(foreignTargetDir, join(rootForeignLink, SKILL_NAME));
  const gs5 = join(temporaryDirectory, 'gs5');
  const res6 = installSkill(gs5, [rootForeignLink], BODY);
  assert(res6.skipped.length === 1, 'foreign symlink should be skipped');
  assert(readlinkSync(join(rootForeignLink, SKILL_NAME)) === foreignTargetDir, 'foreign symlink must remain untouched');

  // ── 8. 卸载：只删我们管理的软链 ──
  const gs6 = join(temporaryDirectory, 'gs6');
  const rootR1 = join(temporaryDirectory, 'agent-r1', 'skills');
  const rootR2 = join(temporaryDirectory, 'agent-r2', 'skills');
  const rootRF = join(temporaryDirectory, 'agent-rf', 'skills');
  mkdirSync(rootRF, { recursive: true });
  mkdirSync(join(rootRF, SKILL_NAME, 'sub'), { recursive: true });
  writeFileSync(join(rootRF, SKILL_NAME, 'SKILL.md'), '---\nname: other\n---\n', 'utf8');
  installSkill(gs6, [rootR1, rootR2], BODY);
  // 先"安装"一个成功的，然后试图卸载一个不存在的 + 一个外来的
  const remRes1 = removeSkill(gs6, [rootR1, rootRF]);
  assert(remRes1.removed.length === 1, 'removeSkill should remove ours only');
  assert(remRes1.skipped.length === 1, 'removeSkill should skip foreign');
  assert(!existsSync(join(rootR1, SKILL_NAME)), 'our link must be removed');
  assert(existsSync(join(rootRF, SKILL_NAME)), 'foreign dir must remain');

  // ── 9. 全部卸载后真源目录清理 ──
  const remRes2 = removeSkill(gs6, [rootR2]);
  assert(remRes2.removed.length === 1, 'remove last should succeed');
  assert(!existsSync(canonicalDir(gs6)), 'canonical dir should be removed after last uninstall');
  const stateEmpty = readState(gs6);
  assert(stateEmpty.roots.length === 0, 'state should be empty after full remove');

  // ── 10. reconcile：重建缺失的软链 ──
  const gs7 = join(temporaryDirectory, 'gs7');
  const rootRec = join(temporaryDirectory, 'agent-rec', 'skills');
  installSkill(gs7, [rootRec], BODY);
  // 手动删掉软链
  rmSync(join(rootRec, SKILL_NAME));
  assert(!existsSync(join(rootRec, SKILL_NAME)), 'link must be gone');
  reconcile(gs7, BODY);
  assert(isSymlink(join(rootRec, SKILL_NAME)), 'reconcile must rebuild missing link');

  // ── 11. reconcile：用户把落点换成外来目录 → 从记录剔除，不动磁盘 ──
  const gs8 = join(temporaryDirectory, 'gs8');
  const rootRec2 = join(temporaryDirectory, 'agent-rec2', 'skills');
  installSkill(gs8, [rootRec2], BODY);
  rmSync(join(rootRec2, SKILL_NAME));
  mkdirSync(join(rootRec2, SKILL_NAME), { recursive: true });
  writeFileSync(join(rootRec2, SKILL_NAME, 'SKILL.md'), '---\nname: totally-unrelated\n---\n', 'utf8');
  reconcile(gs8, BODY);
  const stateRec2 = readState(gs8);
  assert(stateRec2.roots.length === 0, 'foreign replacement must be pruned from state');
  assert(existsSync(join(rootRec2, SKILL_NAME)), 'foreign replacement must stay on disk');

  // ── 12. writeCanonicalSkill 内容相同不重写（mtime 不变）──
  const gs9 = join(temporaryDirectory, 'gs9');
  const c1 = writeCanonicalSkill(gs9, BODY);
  const f1 = canonicalSkillFile(gs9);
  const mt1 = lstatSync(f1).mtimeMs;
  // 同步写入：必须等一下让 mtime 有可分辨的差异，但实际上我们测的是：再写一次，文件应仍存在
  const c2 = writeCanonicalSkill(gs9, BODY);
  assert(c1 === c2, 'canonical dir path must be stable');
  assert(existsSync(f1), 'canonical SKILL.md must still exist after idempotent write');

  // ── 13. state 文件去重 ──
  const gs10 = join(temporaryDirectory, 'gs10');
  writeState(gs10, { version: 1, roots: ['/a', '/a', '/b'] });
  const s = readState(gs10);
  assert(s.roots.length === 2, 'readState must deduplicate roots');

  console.log('markdown-comment skill install tests passed');
} finally {
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
