import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  OTHER_PATH_LABEL,
  PICKER_HEADER,
  applyPickerKey,
  collectCheckedRoots,
  decodePickerKey,
  initialPickerState,
  isOtherChecked,
  loadSkillPrefs,
  prechecked,
  renderPicker,
  saveSkillPrefs,
  runPicker,
  selectedSkillRoots,
  skillPrefsPath,
} from '../src/cli/skill-picker.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dom-comment-prefs-'));
}

test('loadSkillPrefs returns empty when missing or invalid', () => {
  const dir = tmpDir();
  assert.deepEqual(loadSkillPrefs(dir), { targets: [] });
  fs.writeFileSync(skillPrefsPath(dir), '{not-json', 'utf8');
  assert.deepEqual(loadSkillPrefs(dir), { targets: [] });
  fs.writeFileSync(skillPrefsPath(dir), '{"targets":"nope"}\n', 'utf8');
  assert.deepEqual(loadSkillPrefs(dir), { targets: [] });
  fs.writeFileSync(skillPrefsPath(dir), '{"no":1}\n', 'utf8');
  assert.deepEqual(loadSkillPrefs(dir), { targets: [] });
});

test('saveSkillPrefs persists unique absolute paths', () => {
  const parent = tmpDir();
  const dir = path.join(parent, 'nested');
  const a = path.join(dir, 'a');
  const b = path.join(dir, 'b');
  saveSkillPrefs(dir, [a, b, a, '']);
  assert.deepEqual(loadSkillPrefs(dir), { targets: [a, b] });
  const raw: unknown = JSON.parse(fs.readFileSync(skillPrefsPath(dir), 'utf8'));
  assert.ok(raw && typeof raw === 'object' && 'targets' in raw);
  assert.deepEqual(raw.targets, [a, b]);
});

test('loadSkillPrefs ignores non-string targets', () => {
  const dir = tmpDir();
  fs.writeFileSync(skillPrefsPath(dir), '{"targets":["ok",1,null,""]}\n', 'utf8');
  assert.deepEqual(loadSkillPrefs(dir), { targets: ['ok'] });
});

test('prechecked only marks last-selected dirs that still exist in found', () => {
  const found = ['/home/u/.claude/skills', '/home/u/.agents/skills'];
  const last = ['/home/u/.claude/skills', '/missing/skills', '/custom'];
  assert.deepEqual(prechecked(found, last), [true, false]);
  assert.deepEqual(prechecked(found, []), [false, false]);
});

test('initialPickerState prechecks found dirs and leaves 其他路径 unchecked', () => {
  const found = ['/a/skills', '/b/skills'];
  const state = initialPickerState(found, ['/b/skills']);
  assert.equal(state.cursor, 0);
  assert.equal(state.status, 'picking');
  assert.deepEqual(state.checked, [false, true, false]);
});

test('applyPickerKey moves, toggles, confirms, and aborts', () => {
  const start = initialPickerState(['/a', '/b'], []);
  const down = applyPickerKey(start, 'down');
  assert.equal(down.cursor, 1);
  const wrapDown = applyPickerKey(applyPickerKey(down, 'down'), 'down');
  assert.equal(wrapDown.cursor, 0);
  const up = applyPickerKey(start, 'up');
  assert.equal(up.cursor, start.checked.length - 1);
  const viaJ = applyPickerKey(start, 'j');
  assert.equal(viaJ.cursor, 1);
  const viaK = applyPickerKey(viaJ, 'k');
  assert.equal(viaK.cursor, 0);
  const toggled = applyPickerKey(start, 'space');
  assert.deepEqual(toggled.checked, [true, false, false]);
  const confirmed = applyPickerKey(toggled, 'enter');
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(applyPickerKey(confirmed, 'space').checked[0], true);
  const aborted = applyPickerKey(start, 'esc');
  assert.equal(aborted.status, 'aborted');
  assert.equal(applyPickerKey(start, 'nope').cursor, 0);
  const empty = { cursor: 0, checked: [], status: 'picking' as const };
  assert.deepEqual(applyPickerKey(empty, 'down'), empty);
});

test('decodePickerKey maps arrows, k/j, space, enter, esc, ctrl-c', () => {
  assert.equal(decodePickerKey('\x1b[A'), 'up');
  assert.equal(decodePickerKey('\x1bOA'), 'up');
  assert.equal(decodePickerKey('k'), 'up');
  assert.equal(decodePickerKey('\x1b[B'), 'down');
  assert.equal(decodePickerKey('\x1bOB'), 'down');
  assert.equal(decodePickerKey('j'), 'down');
  assert.equal(decodePickerKey(' '), 'space');
  assert.equal(decodePickerKey('\r'), 'enter');
  assert.equal(decodePickerKey('\n'), 'enter');
  assert.equal(decodePickerKey('\x1b'), 'esc');
  assert.equal(decodePickerKey('\x03'), 'esc');
  assert.equal(decodePickerKey('x'), undefined);
});

test('renderPicker lists found dirs plus 其他路径', () => {
  const state = initialPickerState(['/tmp/.agents/skills'], ['/tmp/.agents/skills']);
  const view = renderPicker(['/tmp/.agents/skills'], state);
  assert.match(view, new RegExp(PICKER_HEADER));
  assert.match(view, />\[x\] \/tmp\/\.agents\/skills/);
  assert.match(view, new RegExp(` \\[ \\] ${OTHER_PATH_LABEL}`));
});

test('collectCheckedRoots and isOtherChecked', () => {
  const found = ['/a', '/b'];
  assert.deepEqual(collectCheckedRoots(found, [true, false, true]), ['/a']);
  assert.equal(isOtherChecked([true, false, true], found.length), true);
  assert.equal(isOtherChecked([true, false, false], found.length), false);
  assert.deepEqual(collectCheckedRoots(found, [false, false, false]), []);
});

test('selectedSkillRoots adds extra path only when 其他路径 is checked', () => {
  const found = ['/a', '/b'];
  assert.deepEqual(selectedSkillRoots(found, [true, false, true], '/custom'), ['/a', '/custom']);
  assert.deepEqual(selectedSkillRoots(found, [true, false, true], ''), ['/a']);
  assert.deepEqual(selectedSkillRoots(found, [false, false, false], '/custom'), []);
});

test('runPicker confirms space-selected rows and restores raw mode', async () => {
  const chunks = ['x', ' ', '\x1b[B', ' ', '\r'];
  let i = 0;
  const writes: string[] = [];
  const raw: boolean[] = [];
  const state = await runPicker(['/a', '/b'], ['/a'], {
    write: (text) => {
      writes.push(text);
    },
    readChunk: async () => chunks[i++],
    setRawMode: (enabled) => {
      raw.push(enabled);
    },
  });
  assert.equal(state.status, 'confirmed');
  assert.deepEqual(state.checked, [false, true, false]);
  assert.deepEqual(raw, [true, false]);
  assert.match(writes.join(''), /\/a/);
  assert.match(writes.join(''), /其他路径/);
});

test('runPicker aborts on esc without keeping later keys', async () => {
  const chunks = ['\x1b'];
  let i = 0;
  const state = await runPicker(['/a'], [], {
    write: () => undefined,
    readChunk: async () => chunks[i++],
    setRawMode: () => undefined,
  });
  assert.equal(state.status, 'aborted');
  assert.deepEqual(state.checked, [false, false]);
});
