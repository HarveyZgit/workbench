#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = join(repoRoot, 'packages/markdown-comment');
const cliPath = join(repoRoot, 'packages/markdown-comment/dist/cli.js');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'markdown-comment-install-'));

function run(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  execFileSync('node', ['esbuild.mjs', '--production'], {
    cwd: packageRoot,
    stdio: 'ignore',
  });

  const missingSingle = run(['init', '--no-extension', '--skill-dir']);
  assert(missingSingle.status !== 0, '--skill-dir without a value must fail');
  assert(missingSingle.stderr.includes('--skill-dir 缺少目录参数'), 'missing --skill-dir error must be explicit');

  const missingMany = run(['init', '--no-extension', '--skill-dirs']);
  assert(missingMany.status !== 0, '--skill-dirs without a value must fail');
  assert(missingMany.stderr.includes('--skill-dirs 缺少目录参数'), 'missing --skill-dirs error must be explicit');

  for (const flag of ['--skill-dir', '--skill-dirs', '--no-skill', '--no-extension']) {
    const duplicateArgs = flag.startsWith('--no-')
      ? [flag, flag]
      : [flag, join(temporaryDirectory, 'one'), flag, join(temporaryDirectory, 'two')];
    const duplicate = run(['init', '--no-extension', ...duplicateArgs]);
    assert(duplicate.status !== 0, `${flag} repeated must fail`);
    assert(duplicate.stderr.includes(`${flag} 只能传一次`), `${flag} duplicate error must be explicit`);
  }

  const optionAsValue = run(['init', '--no-extension', '--skill-dir', '--no-skill']);
  assert(optionAsValue.status !== 0, 'a following option must not be accepted as a directory value');
  assert(optionAsValue.stderr.includes('--skill-dir 缺少目录参数'), 'option-as-value error must be explicit');

  const conflict = run([
    'init',
    '--no-extension',
    '--skill-dir',
    join(temporaryDirectory, 'single'),
    '--skill-dirs',
    join(temporaryDirectory, 'roots'),
  ]);
  assert(conflict.status !== 0, 'conflicting skill directory flags must fail');
  assert(conflict.stderr.includes('不能同时使用'), 'conflicting flags error must be explicit');

  const noSkillConflict = run([
    'init',
    '--no-extension',
    '--no-skill',
    '--skill-dir',
    join(temporaryDirectory, 'ignored'),
  ]);
  assert(noSkillConflict.status !== 0, '--no-skill with a directory flag must fail');
  assert(noSkillConflict.stderr.includes('--no-skill 不能与'), 'no-skill conflict error must be explicit');

  const emptyMany = run(['init', '--no-extension', '--skill-dirs', ',,']);
  assert(emptyMany.status !== 0, 'empty --skill-dirs must fail');
  assert(emptyMany.stderr.includes('至少需要一个非空目录'), 'empty roots error must be explicit');

  const pathWithSpace = join(temporaryDirectory, 'root with space');
  const secondRoot = join(temporaryDirectory, 'second root');
  const many = run(['init', '--no-extension', '--skill-dirs', `${pathWithSpace},${secondRoot}`]);
  assert(many.status === 0, `explicit roots failed: ${many.stderr}`);
  assert(existsSync(join(pathWithSpace, 'markdown-comment', 'SKILL.md')), 'path with spaces must be preserved');
  assert(existsSync(join(secondRoot, 'markdown-comment', 'SKILL.md')), 'second root must be installed');

  const unknown = run(['init', '--no-extension', '--no-skill', '--unknown']);
  assert(unknown.status !== 0, 'unknown init flags must fail');
  assert(unknown.stderr.includes('未知参数'), 'unknown flag error must be explicit');

  const positional = run(['init', '--no-extension', '--no-skill', 'extra-positional']);
  assert(positional.status !== 0, 'extra positional args must fail');
  assert(positional.stderr.includes('不支持的位置参数'), 'positional error must be explicit');

  const packageWithSpaceAndQuote = join(temporaryDirectory, "package with space and 'quote'");
  cpSync(join(packageRoot, 'dist'), join(packageWithSpaceAndQuote, 'dist'), { recursive: true });
  const copiedCli = join(packageWithSpaceAndQuote, 'dist', 'cli.js');
  const copiedTarget = join(temporaryDirectory, 'copied-skill');
  const copied = spawnSync(process.execPath, [copiedCli, 'init', '--no-extension', '--skill-dir', copiedTarget], {
    cwd: repoRoot,
    env: { ...process.env, PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  });
  assert(copied.status === 0, `copied CLI install failed: ${copied.stderr}`);
  const copiedSkill = readFileSync(join(copiedTarget, 'SKILL.md'), 'utf8');
  const commandLine = copiedSkill.split(/\r?\n/).find((line) => line.includes(' list [file]'));
  assert(commandLine, 'generated skill must contain the fallback CLI command');
  const commandEnd = commandLine.indexOf(' list [file]') + ' list'.length;
  const command = commandLine.slice(0, commandEnd);
  const execution = spawnSync('/bin/sh', ['-c', command], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      MARKDOWN_COMMENT_STORAGE_DIR: temporaryDirectory,
    },
    encoding: 'utf8',
  });
  assert(execution.status === 0, `quoted fallback CLI is not executable through /bin/sh: ${execution.stderr}`);

  console.log('markdown-comment skill install tests passed');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
