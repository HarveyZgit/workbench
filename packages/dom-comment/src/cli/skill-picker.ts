import * as fs from 'node:fs';
import * as path from 'node:path';

export const OTHER_PATH_LABEL = '其他路径';
export const SKILL_PREFS_FILE = 'skill-prefs.json';
export const PICKER_HEADER = '把 Skill 装到哪些目录？↑↓ 移动，空格勾选，回车确认';

export interface SkillPrefs {
  targets: string[];
}

export type PickerStatus = 'picking' | 'confirmed' | 'aborted';

export interface PickerState {
  cursor: number;
  checked: boolean[];
  status: PickerStatus;
}

export type PickerKey = 'up' | 'down' | 'space' | 'enter' | 'esc';

const ESC = '\x1b';
const CTRL_C = '\x03';
const KEY_UP = `${ESC}[A`;
const KEY_DOWN = `${ESC}[B`;
const KEY_UP_APP = `${ESC}OA`;
const KEY_DOWN_APP = `${ESC}OB`;

export function skillPrefsPath(storageDir: string): string {
  return path.join(storageDir, SKILL_PREFS_FILE);
}

function readTargets(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || !('targets' in value)) {
    return [];
  }
  const { targets } = value;
  if (!Array.isArray(targets)) {
    return [];
  }
  const out: string[] = [];
  for (const item of targets) {
    if (typeof item === 'string' && item.length > 0) {
      out.push(item);
    }
  }
  return out;
}

export function loadSkillPrefs(storageDir: string): SkillPrefs {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(skillPrefsPath(storageDir), 'utf8'));
    return { targets: readTargets(raw) };
  } catch {
    return { targets: [] };
  }
}

export function saveSkillPrefs(storageDir: string, targets: string[]): void {
  fs.mkdirSync(storageDir, { recursive: true });
  const prefs: SkillPrefs = { targets: [...new Set(targets.filter((dir) => dir.length > 0))] };
  fs.writeFileSync(skillPrefsPath(storageDir), `${JSON.stringify(prefs, null, '  ')}\n`, 'utf8');
}

export function prechecked(found: string[], last: string[]): boolean[] {
  const remembered = new Set(last);
  return found.map((dir) => remembered.has(dir));
}

export function initialPickerState(found: string[], last: string[]): PickerState {
  return {
    cursor: 0,
    checked: [...prechecked(found, last), false],
    status: 'picking',
  };
}

export function decodePickerKey(chunk: string): PickerKey | undefined {
  if (chunk === KEY_UP || chunk === KEY_UP_APP || chunk === 'k') {
    return 'up';
  }
  if (chunk === KEY_DOWN || chunk === KEY_DOWN_APP || chunk === 'j') {
    return 'down';
  }
  if (chunk === ' ') {
    return 'space';
  }
  if (chunk === '\r' || chunk === '\n') {
    return 'enter';
  }
  if (chunk === ESC || chunk === CTRL_C) {
    return 'esc';
  }
  return undefined;
}

export function applyPickerKey(state: PickerState, key: string): PickerState {
  if (state.status !== 'picking' || state.checked.length === 0) {
    return state;
  }
  const lastIndex = state.checked.length - 1;
  switch (key) {
    case 'up':
    case 'k': {
      const cursor = state.cursor <= 0 ? lastIndex : state.cursor - 1;
      return { ...state, cursor };
    }
    case 'down':
    case 'j': {
      const cursor = state.cursor >= lastIndex ? 0 : state.cursor + 1;
      return { ...state, cursor };
    }
    case 'space': {
      const checked = state.checked.slice();
      checked[state.cursor] = !checked[state.cursor];
      return { ...state, checked };
    }
    case 'enter':
      return { ...state, status: 'confirmed' };
    case 'esc':
      return { ...state, status: 'aborted' };
    default:
      return state;
  }
}

export function renderPicker(found: string[], state: PickerState): string {
  const labels = [...found, OTHER_PATH_LABEL];
  const lines = [PICKER_HEADER];
  for (let i = 0; i < labels.length; i += 1) {
    const cursor = i === state.cursor ? '>' : ' ';
    const mark = state.checked[i] ? 'x' : ' ';
    lines.push(`${cursor}[${mark}] ${labels[i]}`);
  }
  return lines.join('\n');
}

export function collectCheckedRoots(found: string[], checked: boolean[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < found.length; i += 1) {
    if (checked[i]) {
      out.push(found[i]);
    }
  }
  return out;
}

export function isOtherChecked(checked: boolean[], foundCount: number): boolean {
  return Boolean(checked[foundCount]);
}

export const ANSI_HIDE_CURSOR = '\x1b[?25l';
export const ANSI_SHOW_CURSOR = '\x1b[?25h';
export const ANSI_CLEAR_DOWN = '\x1b[J';

export interface PickerIo {
  write: (text: string) => void;
  readChunk: () => Promise<string>;
  setRawMode: (enabled: boolean) => void;
}

export async function runPicker(found: string[], last: string[], io: PickerIo): Promise<PickerState> {
  let state = initialPickerState(found, last);
  io.setRawMode(true);
  io.write(ANSI_HIDE_CURSOR);
  try {
    let previousLines = 0;
    const paint = () => {
      const text = renderPicker(found, state);
      if (previousLines > 0) {
        io.write(`\x1b[${previousLines}A${ANSI_CLEAR_DOWN}`);
      }
      io.write(`${text}\n`);
      previousLines = text.split('\n').length;
    };
    paint();
    while (state.status === 'picking') {
      const key = decodePickerKey(await io.readChunk());
      if (!key) {
        continue;
      }
      state = applyPickerKey(state, key);
      if (state.status === 'picking') {
        paint();
      }
    }
  } finally {
    io.setRawMode(false);
    io.write(ANSI_SHOW_CURSOR);
  }
  io.write('\n');
  return state;
}

export function selectedSkillRoots(found: string[], checked: boolean[], extraPath = ''): string[] {
  const out = collectCheckedRoots(found, checked);
  if (isOtherChecked(checked, found.length) && extraPath.length > 0) {
    out.push(extraPath);
  }
  return [...new Set(out)];
}
