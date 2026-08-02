#!/usr/bin/env node
// review-and-commit telemetry logger.
//
// Appends one JSONL record per run to ~/.trae/review-and-commit/runs.jsonl so we
// can later observe what size/type of change this skill is actually used on, and
// decide thresholds for an automated gate (e.g. a PreToolUse hook on git commit).
//
// The script computes change size itself from git. By default it measures the
// working tree against HEAD. Pass --before <ref> to instead measure a completed
// commit range (<before>..HEAD) — use this after committing, since the working
// tree is clean by then.
//
// Usage:
//   node log-run.mjs --verdict clean --fix-rounds 0 --committed true \
//     --commit <hash> --before <pre-commit-HEAD>
//
// Flags (all optional except where noted):
//   --verdict   clean | fixed_then_clean | aborted | skipped   (default: unknown)
//   --fix-rounds <N>            number of fix/re-review rounds  (default: 0)
//   --committed true|false      whether a commit was made       (default: false)
//   --commit <hash>             commit hash if committed         (default: "")
//   --before <ref>              pre-commit HEAD; measures <ref>..HEAD range
//   --sensitive <globs>         comma-separated extra sensitive path prefixes
//   --dry-run                   print the record, do not write

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';

const LOG_PATH = join(homedir(), '.trae', 'review-and-commit', 'runs.jsonl');

// Path prefixes that mark a change as touching risk-sensitive surface. Kept in
// sync (conceptually) with the future gate; extend via --sensitive. Matched as
// path segments (see hitsSensitive), so "src/" also matches "packages/x/src/".
const DEFAULT_SENSITIVE = [
  'src/',
  '.github/',
  'infra/git-hooks/',
  '.trae/',
  'scripts/',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'dry-run') {
      args['dry-run'] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

// Read a string flag, defaulting when it was missing or passed without a value
// (in which case parseArgs stored boolean `true`).
function strArg(args, key, fallback = '') {
  return typeof args[key] === 'string' ? args[key] : fallback;
}

// Read a non-negative integer flag. A missing value (boolean `true`) or an
// unparseable value falls back rather than silently becoming 1.
function intArg(args, key, fallback = 0) {
  if (typeof args[key] !== 'string') return fallback;
  const n = Number(args[key]);
  return Number.isFinite(n) ? n : fallback;
}

// All git calls run in this dir. Set to the repo toplevel once known so that
// `ls-files`/`diff` paths are relative to the repo root (consistent with how we
// resolve untracked paths), regardless of the caller's cwd.
let gitCwd = process.cwd();

// Run git with core.quotepath disabled so non-ASCII (e.g. Chinese) paths come
// back as raw UTF-8 instead of C-style "\344\270\255" escapes — otherwise
// downstream file reads and path matching break.
function git(cwdArgs) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...cwdArgs], {
      encoding: 'utf8',
      cwd: gitCwd,
    }).trim();
  } catch {
    return '';
  }
}

// Count added lines in a new (untracked) file. Binary files are detected via a
// NUL byte in the first chunk and counted as 0 (they have no meaningful line
// count). We read the file directly rather than shelling out to `wc`, which
// avoids quoting issues and miscounting binaries.
function countNewFileLines(absPath) {
  try {
    const buf = readFileSync(absPath);
    if (buf.includes(0)) return 0; // binary
    if (buf.length === 0) return 0;
    let lines = 0;
    for (const byte of buf) {
      if (byte === 0x0a) lines += 1;
    }
    // Count a final line with no trailing newline.
    if (buf[buf.length - 1] !== 0x0a) lines += 1;
    return lines;
  } catch {
    return 0;
  }
}

function computeStats(before, repoRoot) {
  // Choose the diff scope: committed range vs working tree.
  // --numstat lines: "<added>\t<deleted>\t<path>"
  let numstat;
  if (before) {
    numstat = git(['diff', '--numstat', `${before}..HEAD`]);
  } else {
    // Working tree vs HEAD, including staged changes. Untracked files are added
    // separately below since --numstat does not list them.
    numstat = git(['diff', '--numstat', 'HEAD']);
  }

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  const paths = [];

  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const [add, del, ...rest] = line.split('\t');
    const path = rest.join('\t');
    filesChanged += 1;
    // Binary files show "-" for counts.
    insertions += add === '-' ? 0 : Number(add) || 0;
    deletions += del === '-' ? 0 : Number(del) || 0;
    if (path) paths.push(path);
  }

  // Untracked files only matter for the working-tree measurement.
  if (!before) {
    const untracked = git(['ls-files', '--others', '--exclude-standard']);
    for (const path of untracked.split('\n')) {
      if (!path.trim()) continue;
      filesChanged += 1;
      paths.push(path);
      // git returns repo-relative paths; resolve against the repo root to read.
      const absPath = isAbsolute(path) ? path : join(repoRoot, path);
      insertions += countNewFileLines(absPath);
    }
  }

  return { filesChanged, insertions, deletions, paths };
}

// Does a repo-relative path touch a sensitive surface? Match by path segment,
// not raw substring, so "src/" matches "packages/x/src/a.ts" but not
// "transcripts/x" or "mysrc/y".
function hitsSensitive(paths, extra) {
  const prefixes = [...DEFAULT_SENSITIVE, ...extra];
  return paths.filter((p) => {
    const probe = `/${p}`;
    return prefixes.some((pref) => probe.includes(`/${pref}`));
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const repo = git(['rev-parse', '--show-toplevel']) || process.cwd();
  // Pin all subsequent git calls to the repo root so ls-files/diff paths are
  // repo-relative and stay consistent with join(repo, path) below.
  gitCwd = repo;
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
  const before = strArg(args, 'before');

  const extraSensitive = strArg(args, 'sensitive')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const { filesChanged, insertions, deletions, paths } = computeStats(before, repo);
  const sensitiveHits = hitsSensitive(paths, extraSensitive);

  const record = {
    ts: new Date().toISOString(),
    repo,
    branch,
    verdict: strArg(args, 'verdict', 'unknown'),
    fix_rounds: intArg(args, 'fix-rounds', 0),
    committed: args.committed === 'true' || args.committed === true,
    commit: strArg(args, 'commit'),
    files_changed: filesChanged,
    insertions,
    deletions,
    total_lines: insertions + deletions,
    sensitive: sensitiveHits.length > 0,
    sensitive_paths: sensitiveHits,
    measured: before ? `${before}..HEAD` : 'worktree-vs-HEAD',
  };

  const line = JSON.stringify(record);

  if (args['dry-run']) {
    process.stdout.write(`[dry-run] ${LOG_PATH}\n${line}\n`);
    return;
  }

  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, `${line}\n`, 'utf8');
  process.stdout.write(`logged -> ${LOG_PATH}\n`);
}

main();
