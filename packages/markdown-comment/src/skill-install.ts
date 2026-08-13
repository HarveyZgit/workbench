// Skill 安装/卸载的纯 node 实现（不依赖 vscode），供 VS Code 命令与将来的 core 复用。
//
// 设计：
//   - 真源（canonical）SKILL.md 写在稳定的 globalStorage 目录里，`{{CLI}}` 已解析为绝对 CLI 路径。
//     VS Code 扩展安装目录带版本号、升级即换名，所以不能把软链指向扩展目录。
//   - 各 Agent 的 skill 根目录下建 `<root>/markdown-comment` 软链指向真源目录。
//   - 已安装目标记录在 globalStorage/skill-install.json，卸载/对账只依据它，且只碰「我们管理的」软链。
//
// 安全原则（同 scripts/link-skills.sh）：只创建/删除我们自己建的软链；遇到真实文件/目录或指向别处的
// 外来软链一律跳过并报告，绝不删用户数据。
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
  | 'ours-stale' // 我们建的软链但指向别的（旧版本真源），可安全重指
  | 'foreign-link' // 外来软链，跳过
  | 'real-entry'; // 真实文件/目录，跳过

export interface LinkStatus {
  root: string;
  linkPath: string;
  kind: LinkKind;
  /** 软链当前指向（若是软链）。 */
  currentTarget?: string;
}

export interface InstallOutcome {
  installed: string[]; // 成功建/刷新软链的根目录
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
    // 只看隐藏目录（含指向目录的软链），Agent 配置目录约定以点开头。
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

  if (!lstat.isSymbolicLink()) {
    return { root: normalizedRoot, linkPath, kind: 'real-entry' };
  }

  const target = readLinkTarget(linkPath);
  if (target === null) {
    // 悬空软链：无法判断归属，保守当作外来。
    return { root: normalizedRoot, linkPath, kind: 'foreign-link' };
  }
  if (target === canonicalAbs) {
    return { root: normalizedRoot, linkPath, kind: 'ours', currentTarget: target };
  }
  // 指向别处的软链，只有当它落在我们的 canonical 家族（.../skill/markdown-comment）时才认作旧版本残留。
  if (path.basename(target) === SKILL_NAME && path.basename(path.dirname(target)) === 'skill') {
    return { root: normalizedRoot, linkPath, kind: 'ours-stale', currentTarget: target };
  }
  return { root: normalizedRoot, linkPath, kind: 'foreign-link', currentTarget: target };
}

/** 在某个根目录下建/刷新指向真源的软链。返回是否实际写入以及跳过原因。 */
export function installManagedLink(
  root: string,
  canonical: string,
): { ok: boolean; reason?: string; linkPath: string } {
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
      fs.rmSync(status.linkPath);
      fs.symlinkSync(canonicalAbs, status.linkPath);
      return { ok: true, linkPath: status.linkPath };
    case 'foreign-link':
      return { ok: false, reason: '已存在指向别处的软链，未改动', linkPath: status.linkPath };
    case 'real-entry':
      return { ok: false, reason: '已存在同名文件/目录，未改动', linkPath: status.linkPath };
  }
}

/** 删除某个根目录下我们管理的软链。只删「我们的」，其余跳过。 */
export function removeManagedLink(
  root: string,
  canonical: string,
): { ok: boolean; reason?: string; linkPath: string } {
  const status = linkStatus(root, canonical);
  switch (status.kind) {
    case 'ours':
    case 'ours-stale':
      fs.rmSync(status.linkPath);
      return { ok: true, linkPath: status.linkPath };
    case 'missing':
      return { ok: true, reason: '软链不存在（已清理）', linkPath: status.linkPath };
    case 'foreign-link':
      return { ok: false, reason: '指向别处的软链，未删除', linkPath: status.linkPath };
    case 'real-entry':
      return { ok: false, reason: '同名文件/目录，未删除', linkPath: status.linkPath };
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
  fs.writeFileSync(stateFilePath(globalStorageDir), JSON.stringify(normalized, null, 2) + '\n', 'utf8');
}

// ─── 组合操作 ──────────────────────────────────────────────────────

/** 安装到多个根目录：写真源 → 逐个建软链 → 更新记录。roots 应已解析 `{{CLI}}` 的 body。 */
export function installSkill(globalStorageDir: string, roots: string[], skillBody: string): InstallOutcome {
  const canonical = writeCanonicalSkill(globalStorageDir, skillBody);
  const outcome: InstallOutcome = { installed: [], skipped: [] };
  const state = readState(globalStorageDir);
  const recorded = new Set(state.roots);

  for (const raw of roots) {
    const root = normalizeRoot(raw);
    const result = installManagedLink(root, canonical);
    if (result.ok) {
      outcome.installed.push(root);
      recorded.add(root);
    } else {
      outcome.skipped.push({ root, reason: result.reason ?? '未知原因' });
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
      outcome.skipped.push({ root, reason: result.reason ?? '未知原因' });
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
 *   - 我们的且指向旧真源 → 重指到当前真源（处理版本升级换目录）。
 *   - 记录里但落点已被用户换成真实文件/外来软链 → 从记录剔除（不动磁盘）。
 *   - 悬空/缺失 → 重建指向当前真源。
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
          // 该目标暂时不可写，保留记录待下次对账，不 push 会丢记录，故仍保留。
          survivors.push(root);
        }
        break;
      case 'foreign-link':
      case 'real-entry':
        // 用户把落点换成了别的东西，剔出记录，绝不覆盖。
        break;
    }
  }

  writeState(globalStorageDir, { version: STATE_VERSION, roots: survivors });
}
