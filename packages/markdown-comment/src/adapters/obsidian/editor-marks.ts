// 编辑视图（Live Preview / 源码模式）的评论高亮：CodeMirror 6 mark decoration。
// @codemirror/* 由 Obsidian 运行时提供（esbuild external），这里只用其类型与 API。
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

export interface EditorMark {
  /** CodeMirror 文档 offset。 */
  from: number;
  to: number;
  threadId: string;
  resolved: boolean;
  active: boolean;
}

const setMarks = StateEffect.define<EditorMark[]>();

function build(marks: EditorMark[], docLength: number): DecorationSet {
  const ranges = marks
    .filter((m) => m.from < m.to && m.to <= docLength)
    .map((m) => {
      const cls = ['mdc-mark', m.resolved ? 'resolved' : '', m.active ? 'active' : '']
        .filter(Boolean)
        .join(' ');
      return Decoration.mark({ class: cls, attributes: { 'data-thread-id': m.threadId } }).range(
        m.from,
        m.to,
      );
    });
  return Decoration.set(ranges, true);
}

export const editorMarksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setMarks)) {
        next = build(e.value, tr.state.doc.length);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function applyEditorMarks(cm: EditorView, marks: EditorMark[]): void {
  cm.dispatch({ effects: setMarks.of(marks) });
}
