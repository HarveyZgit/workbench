import type MarkdownIt from 'markdown-it';

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i;

/**
 * Minimal GFM alert / admonition support for `> [!NOTE]` style blockquotes.
 * Emits class names only — no raw HTML injection.
 */
export function gfmAlertsPlugin(markdown: MarkdownIt): void {
  markdown.core.ruler.after('block', 'gfm_alerts', (state) => {
    const { tokens } = state;
    for (let index = 0; index < tokens.length; index += 1) {
      const open = tokens[index];
      if (open.type !== 'blockquote_open') {
        continue;
      }

      let depth = 1;
      let closeIndex = index + 1;
      for (; closeIndex < tokens.length; closeIndex += 1) {
        if (tokens[closeIndex].type === 'blockquote_open') {
          depth += 1;
        } else if (tokens[closeIndex].type === 'blockquote_close') {
          depth -= 1;
          if (depth === 0) {
            break;
          }
        }
      }
      if (closeIndex >= tokens.length) {
        continue;
      }

      let inlineIndex = -1;
      for (let cursor = index + 1; cursor < closeIndex; cursor += 1) {
        if (tokens[cursor].type === 'inline') {
          inlineIndex = cursor;
          break;
        }
      }
      if (inlineIndex < 0) {
        continue;
      }

      const inline = tokens[inlineIndex];
      const match = ALERT_RE.exec(inline.content);
      if (!match) {
        continue;
      }

      const kind = match[1].toLowerCase();
      open.attrJoin('class', `markdown-alert markdown-alert-${kind} mdc-alert mdc-alert-${kind}`);
      open.attrSet('data-alert', kind);
      inline.content = inline.content.slice(match[0].length);

      const label = kind.charAt(0).toUpperCase() + kind.slice(1);
      const titleOpen = new state.Token('paragraph_open', 'p', 1);
      titleOpen.attrJoin('class', 'mdc-alert-title markdown-alert-title');
      const titleInline = new state.Token('inline', '', 0);
      titleInline.content = label;
      titleInline.children = [];
      const titleClose = new state.Token('paragraph_close', 'p', -1);
      tokens.splice(index + 1, 0, titleOpen, titleInline, titleClose);
      // Skip past inserted title + original open on next loop iteration.
      index += 3;
    }
  });
}
