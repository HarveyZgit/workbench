// Skill 安装/卸载的纯 node 实现（不依赖 vscode），供 VS Code 命令与将来的 core 复用。
//
// 设计：
//   - 真源（canonical）SKILL.md 写在稳定的 globalStorage 目录里，`{{CLI}}` 已解析为绝对 CLI 路径。
//     VS Code 扩展安装目录带版本号、升级即换名，所以不能把软链指向扩展目录。
//   - 各 Agent 的 skill 根目录下建 `<root>/markdown-comment` 软链指向真源目录。
//   - 已安装目标记录在 globalStorage/skill-install.json，卸载/对账只依据它，且只碰「我们管理的」软链。
//
// 历史兼容：旧版本（非软链方案）直接把解析后的 SKILL.md 写进目标目录，或把软链指向源码仓/旧扩展目录。
// 这些旧实例通过检测 SKILL.md 的 frontmatter（`name: markdown-comment`）判定归属，迁移时备份旧目录/旧软链，
// 替换为指向 globalStorage 真源的软链。
//
// 安全原则（同 scripts/link-skills.sh）：只创建/删除/迁移我们自己管理的落点；遇到同名真实文件/目录但非本 skill 的，
// 一律跳过并报告，绝不删用户数据。
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 每个 Agent skill 根目录下创建的子目录名 = skill 名。 */
export const SKILL_NAME = 'markdown-comment';

/** globalStorage 里存放真源 SKILL.md 的相对目录。 */
const CANONICAL_SUBDIR = path.join('skill', SKILL_NAME);
/** 已安装目标记录文件（记录 skill 根目录列表）。 */
const STATE_FILE = 'skill-install.json';
const STATE_VERSION = 1 as const;

interface InstallState {
  version: number;
  /** 已安装的 skill 根目录（软链父目录），存原始输入路径，展示更友好。 */
  roots: string[];
}

/** 软链相对某个 skill 根目录的落点判定结果。 */
export type LinkKind =
  | 'missing' // 什么都没有，可安全创建
  | 'ours' // 我们建的软链且指向当前真源
  | 'ours-stale' // 我们（含旧版 CLI/软链方案）建的，需要迁移/重指到当前真源
  | 'foreign-link' // 外来软链，跳过
  | 'foreign-real'; // 真实文件/目录且不是本 skill 历史实例，跳过

export interface LinkStatus {
  root: string;
  linkPath: string;
  kind: LinkKind;
  /** 软链当前指向（若是软链）。 */
  currentTarget?: string;
}

export interface InstallOutcome {
  installed: string[]; // 新建软链的根目录
  migrated: string[]; // 从旧安装（直接写 SKILL.md / 旧软链）迁移过来的根目录
  refreshed: string[]; // 已是正确软链，内容随真源更新到最新
  skipped: Array<{ root: string; reason: string }>; // 跳过的根目录及原因
}

export interface RemoveOutcome {
  removed: string[]; // 删掉软链的根目录
  skipped: Array<{ root: string; reason: string }>; // 跳过的根目录及原因
}

/** 展开开头的 `~`，其余交给 path.resolve。 */
export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') {
    return os.homedir();
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/** 归一化 skill 根目录为绝对路径（不 realpath，保留用户可读形态）。 */
export function normalizeRoot(input: string): string {
  return path.resolve(expandHome(input));
}

/** 真源目录：globalStorage/skill/markdown-comment。 */
export function canonicalDir(globalStorageDir: string): string {
  return path.join(globalStorageDir, CANONICAL_SUBDIR);
}

/** 真源 SKILL.md 完整路径。 */
export function canonicalSkillFile(globalStorageDir: string): string {
  return path.join(canonicalDir(globalStorageDir), 'SKILL.md');
}

/**
 * 探测本机已存在的 Agent skill 根目录：主目录下形如 `~/.<something>/skills` 的目录。
 * 只返回真实存在的目录，不猜宿主、不含厂商字面量。
 */
export function detectAgentSkillRoots(homeDir: string = os.homedir()): string[] {
  const found: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(homeDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.name.startsWith('.')) {
      continue;
    }
    const skillsDir = path.join(homeDir, entry.name, 'skills');
    try {
      if (fs.statSync(skillsDir).isDirectory()) {
        found.push(skillsDir);
      }
    } catch {
      // 该目录下没有 skills/，跳过。
    }
  }
  return found.sort();
}

/** 读取 bundled SKILL.md 并把 `{{CLI}}` 占位符替换成实际 CLI 命令。 */
export function resolveSkillBody(bundledSkillPath: string, cliCommand: string): string {
  return fs.readFileSync(bundledSkillPath, 'utf8').replaceAll('{{CLI}}', cliCommand);
}

/** 写入真源 SKILL.md（内容变化才写，避免无谓的 mtime 抖动触发外部 watch）。 */
export function writeCanonicalSkill(globalStorageDir: string, body: string): string {
  const dir = canonicalDir(globalStorageDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = canonicalSkillFile(globalStorageDir);
  let current: string | null = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    // 尚未写过。
  }
  if (current !== body) {
    fs.writeFileSync(file, body, 'utf8');
  }
  return dir;
}

/** 软链当前指向（绝对化后返回），非软链或读取失败返回 null。 */
function readLinkTarget(linkPath: string): string | null {
  try {
    const raw = fs.readlinkSync(linkPath);
    return path.resolve(path.dirname(linkPath), raw);
  } catch {
    return null;
  }
}

/** 读取一个目录里的 SKILL.md 头部，判断是否是 markdown-comment 旧安装（frontmatter 含 `name: markdown-comment`）。 */
function isLegacySkillDir(dirPath: string): boolean {
  try {
    if (!fs.statSync(dirPath).isDirectory()) {
      return false;
    }
    const skillFile = path.join(dirPath, 'SKILL.md');
    const head = fs.readFileSync(skillFile, 'utf8').split(/\r?\n/).slice(0, 12).join('\n');
    return /^name:\s*markdown-comment\s*$/m.test(head);
  } catch {
    return false;
  }
}

/** 判定某个 skill 根目录下的落点属于哪种情况。 */
export function linkStatus(root: string, canonical: string): LinkStatus {
  const normalizedRoot = normalizeRoot(root);
  const linkPath = path.join(normalizedRoot, SKILL_NAME);
  const canonicalAbs = path.resolve(canonical);

  let lstat: fs.Stats;
  try {
    lstat = fs.lstatSync(linkPath);
  } catch {
    return { root: normalizedRoot, linkPath, kind: 'missing' };
  }

  if (lstat.isSymbolicLink()) {
    const target = readLinkTarget(linkPath);
    if (target === null) {
      return { root: normalizedRoot, linkPath, kind: 'foreign-link' };
    }
    if (target === canonicalAbs) {
      return { root: normalizedRoot, linkPath, kind: 'ours', currentTarget: target };
    }
    // 软链指向其他位置：若其目标是 markdown-comment 旧版真源（.../skill/markdown-comment）或旧 CLI 目录
    // （如源码仓 dist/、旧扩展目录），视为 ours-stale 可迁移；否则为外来软链。
    const targetBase = path.basename(target);
    if (targetBase === SKILL_NAME) {
      // 目标也是个同名目录：如果目标不存在（悬空），或者目标是个 markdown-comment skill 目录（含 SKILL.md name 匹配），
      // 或其父目录名是 'skill'（我们自己真源家族），都视作 stale。
      const targetParent = path.basename(path.dirname(target));
      if (!fs.existsSync(target) || targetParent === 'skill' || isLegacySkillDir(target)) {
        return { root: normalizedRoot, linkPath, kind: 'ours-stale', currentTarget: target };
      }
    }
    return { root: normalizedRoot, linkPath, kind: 'foreign-link', currentTarget: target };
  }

  // 真实文件/目录：若目录里是 markdown-comment 旧安装（早前版本直接写入），视为 ours-stale 可迁移。
  if (lstat.isDirectory() && isLegacySkillDir(linkPath)) {
    return { root: normalizedRoot, linkPath, kind: 'ours-stale' };
  }
  return { root: normalizedRoot, linkPath, kind: 'foreign-real' };
}

/** 迁移旧安装：把现存落点改名到 .bak-时间戳，再建软链到真源。只在 ours-stale 时调用。 */
function migrateToSymlink(linkPath: string, canonicalAbs: string): void {
  const bak = `${linkPath}.bak-${Date.now()}`;
  fs.renameSync(linkPath, bak);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(canonicalAbs, linkPath);
}

/** 在某个根目录下建/刷新/迁移指向真源的软链。 */
export function installManagedLink(
  root: string,
  canonical: string,
): { ok: boolean; reason?: string; linkPath: string; migrated?: boolean } {
  const canonicalAbs = path.resolve(canonical);
  const status = linkStatus(root, canonicalAbs);
  switch (status.kind) {
    case 'ours':
      return { ok: true, linkPath: status.linkPath };
    case 'missing':
      fs.mkdirSync(status.root, { recursive: true });
      fs.symlinkSync(canonicalAbs, status.linkPath);
      return { ok: true, linkPath: status.linkPath };
    case 'ours-stale':
      migrateToSymlink(status.linkPath, canonicalAbs);
      return { ok: true, linkPath: status.linkPath, migrated: true };
    case 'foreign-link':
      return { ok: false, reason: '该位置已被其他内容占用，未改动', linkPath: status.linkPath };
    case 'foreign-real':
      return {
        ok: false,
        reason: '该位置已存在同名文件/目录且不是本 Skill，未改动',
        linkPath: status.linkPath,
      };
    default: {
      const unexpected: never = status.kind;
      throw new Error(`unexpected link status: ${JSON.stringify(unexpected)}`);
    }
  }
}

/** 删除某个根目录下我们管理的软链（含旧版直接写的真实目录/旧软链）。 */
export function removeManagedLink(
  root: string,
  canonical: string,
): { ok: boolean; reason?: string; linkPath: string } {
  const status = linkStatus(root, canonical);
  switch (status.kind) {
    case 'ours':
    case 'ours-stale':
      fs.rmSync(status.linkPath, { recursive: true, force: true });
      return { ok: true, linkPath: status.linkPath };
    case 'missing':
      return { ok: true, reason: '该位置原本没有安装，无需清理', linkPath: status.linkPath };
    case 'foreign-link':
      return { ok: false, reason: '该位置不是本 Skill 创建的内容，未删除', linkPath: status.linkPath };
    case 'foreign-real':
      return { ok: false, reason: '该位置不是本 Skill 创建的内容，未删除', linkPath: status.linkPath };
    default: {
      const unexpected: never = status.kind;
      throw new Error(`unexpected link status: ${JSON.stringify(unexpected)}`);
    }
  }
}

// ─── 安装记录 ──────────────────────────────────────────────────────

function stateFilePath(globalStorageDir: string): string {
  return path.join(globalStorageDir, STATE_FILE);
}

export function readState(globalStorageDir: string): InstallState {
  try {
    const data = JSON.parse(fs.readFileSync(stateFilePath(globalStorageDir), 'utf8'));
    if (data && Array.isArray(data.roots)) {
      const roots = [...new Set((data.roots as unknown[]).filter((r): r is string => typeof r === 'string'))];
      return { version: STATE_VERSION, roots };
    }
  } catch {
    // 尚无记录。
  }
  return { version: STATE_VERSION, roots: [] };
}

export function writeState(globalStorageDir: string, state: InstallState): void {
  fs.mkdirSync(globalStorageDir, { recursive: true });
  const normalized: InstallState = {
    version: STATE_VERSION,
    roots: [...new Set(state.roots)],
  };
  fs.writeFileSync(stateFilePath(globalStorageDir), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
}

// ─── 组合操作 ──────────────────────────────────────────────────────

/** 安装到多个根目录：写真源 → 逐个建/迁移软链 → 更新记录。roots 应已解析 `{{CLI}}` 的 body。 */
export function installSkill(globalStorageDir: string, roots: string[], skillBody: string): InstallOutcome {
  const canonical = writeCanonicalSkill(globalStorageDir, skillBody);
  const outcome: InstallOutcome = { installed: [], migrated: [], refreshed: [], skipped: [] };
  const state = readState(globalStorageDir);
  const recorded = new Set(state.roots);

  for (const raw of roots) {
    const root = normalizeRoot(raw);
    const preStatus = linkStatus(root, canonical);
    const result = installManagedLink(root, canonical);
    if (result.ok) {
      recorded.add(root);
      if (result.migrated) {
        outcome.migrated.push(root);
      } else if (preStatus.kind === 'missing') {
        outcome.installed.push(root);
      } else {
        outcome.refreshed.push(root);
      }
    } else {
      outcome.skipped.push({ root, reason: result.reason ?? '未处理' });
    }
  }

  writeState(globalStorageDir, { version: STATE_VERSION, roots: [...recorded] });
  return outcome;
}

/** 从多个根目录移除软链：只删我们的 → 更新记录 → 若无剩余则删真源目录。 */
export function removeSkill(globalStorageDir: string, roots: string[]): RemoveOutcome {
  const canonical = canonicalDir(globalStorageDir);
  const outcome: RemoveOutcome = { removed: [], skipped: [] };
  const state = readState(globalStorageDir);
  const recorded = new Set(state.roots);

  for (const raw of roots) {
    const root = normalizeRoot(raw);
    const result = removeManagedLink(root, canonical);
    if (result.ok) {
      outcome.removed.push(root);
      recorded.delete(root);
    } else {
      outcome.skipped.push({ root, reason: result.reason ?? '未处理' });
    }
  }

  writeState(globalStorageDir, { version: STATE_VERSION, roots: [...recorded] });

  if (recorded.size === 0) {
    try {
      fs.rmSync(canonical, { recursive: true, force: true });
    } catch {
      // 真源不存在或删除失败，忽略。
    }
  }
  return outcome;
}

/**
 * 对账（activate 时调用）：刷新真源内容，并修复/剪除已记录的软链。
 *   - 我们的且指向旧真源/旧目录 → 迁移重指到当前真源（处理版本升级换目录、旧版直接写 SKILL.md 的实例）。
 *   - 记录里但落点已被用户换成非本 skill 的真实文件/外来软链 → 从记录剔除（不动磁盘）。
 *   - 缺失 → 重建指向当前真源。
 * 全程不新增未记录的目标，不打断激活。
 */
export function reconcile(globalStorageDir: string, skillBody: string): void {
  const state = readState(globalStorageDir);
  if (state.roots.length === 0) {
    return;
  }
  const canonical = writeCanonicalSkill(globalStorageDir, skillBody);
  const survivors: string[] = [];

  for (const raw of state.roots) {
    const root = normalizeRoot(raw);
    const status = linkStatus(root, canonical);
    switch (status.kind) {
      case 'ours':
        survivors.push(root);
        break;
      case 'ours-stale':
      case 'missing':
        try {
          const result = installManagedLink(root, canonical);
          if (result.ok) {
            survivors.push(root);
          }
        } catch {
          survivors.push(root);
        }
        break;
      case 'foreign-link':
      case 'foreign-real':
        // 用户把落点换成了别的东西，剔出记录，绝不覆盖。
        break;
      default: {
        const unexpected: never = status.kind;
        throw new Error(`unexpected link status: ${JSON.stringify(unexpected)}`);
      }
    }
  }

  writeState(globalStorageDir, { version: STATE_VERSION, roots: survivors });
}
