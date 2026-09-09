// Preview HTML shell + shared CSS. VS Code panel and the local browser host share the same DOM.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const PREVIEW_STYLE = `
:root { color-scheme: light dark; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--mdc-preview-font-family, var(--vscode-font-family));
  font-size: var(--mdc-preview-font-size, var(--vscode-font-size, 14px));
  line-height: var(--mdc-preview-line-height, 1.7);
  color: var(--vscode-foreground);
}
#app { position: relative; display: flex; height: 100vh; }
#content { flex: 1; min-width: 0; overflow: auto; padding: 24px clamp(16px, 6%, 80px) 80px; box-sizing: border-box; }

/* 左侧大纲（飞书文档风格：无边框，干净树） */
#outline {
  width: 220px; flex: none; overflow: auto; box-sizing: border-box;
  border: none;
  background: transparent;
  display: flex; flex-direction: column; min-height: 0;
  transition: width .23s cubic-bezier(0.4, 0, 0.2, 1), opacity .23s ease, min-width .23s ease;
}
#outline-head {
  position: sticky; top: 0; z-index: 5;
  display: flex; justify-content: space-between; align-items: center; gap: 4px;
  padding: 8px 8px 4px 12px;
  background: transparent;
  border: none;
}
#outline-title {
  font-size: 0.82em; font-weight: 600; opacity: 0.85;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#mdc-toggle-outline { flex: none; opacity: 0.72; }
#outline-tree {
  flex: 1; min-height: 0; overflow: auto;
  padding: 4px 6px 16px;
  font-size: 0.86em;
}
#outline-tree:empty::before {
  content: '暂无标题';
  display: block; padding: 12px 8px; opacity: 0.5; font-size: 0.95em;
}
.outline-list { list-style: none; margin: 0; padding: 0; }
.outline-node { margin: 0; }
.outline-row {
  display: flex; align-items: center; gap: 2px;
  border-radius: 4px; min-height: 28px;
  padding-right: 6px;
}
.outline-row:hover { background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.12)); }
.outline-row.active {
  background: var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.18));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
}
.outline-row.active .outline-label { color: var(--vscode-textLink-foreground, #3794ff); font-weight: 600; }
.outline-twisty {
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; padding: 0; border: none; border-radius: 3px;
  background: transparent; color: var(--vscode-foreground); opacity: 0.55; cursor: pointer;
  outline: none;
}
.outline-twisty:focus,
.outline-twisty:focus-visible { outline: none; box-shadow: none; }
.outline-twisty:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
.outline-twisty[aria-hidden="true"] { visibility: hidden; pointer-events: none; }
.outline-twisty svg { display: block; transition: transform .22s cubic-bezier(0.4, 0, 0.2, 1); }
.outline-node.collapsed > .outline-row .outline-twisty svg { transform: rotate(-90deg); }
.outline-node > .outline-list {
  overflow: hidden;
  max-height: 2400px;
  opacity: 1;
  transition: max-height .24s cubic-bezier(0.4, 0, 0.2, 1), opacity .22s ease;
}
.outline-node.collapsed > .outline-list {
  max-height: 0;
  opacity: 0;
  pointer-events: none;
}
.outline-label {
  flex: 1; min-width: 0; padding: 4px 2px;
  color: inherit; text-decoration: none; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  line-height: 1.35;
  outline: none;
}
.outline-label:focus,
.outline-label:focus-visible { outline: none; box-shadow: none; }
.outline-label:hover { color: var(--vscode-textLink-foreground); }
/* 收起后不留细条：整栏隐藏，改用浮动 peek 图标 */
#app.outline-collapsed #outline {
  width: 0; min-width: 0; padding: 0; margin: 0; border: none;
  overflow: hidden; opacity: 0; pointer-events: none;
}

#sidebar {
  width: 320px; flex: none; overflow: auto; box-sizing: border-box;
  border-left: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  background: var(--vscode-sideBar-background, transparent);
  transition: width .23s cubic-bezier(0.4, 0, 0.2, 1), opacity .23s ease, min-width .23s ease, border-width .23s ease;
}

h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 600; }
h1 { font-size: 1.9em; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25)); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2)); padding-bottom: 0.25em; }
p, ul, ol, blockquote, table, pre { margin: 0.7em 0; }
a { color: var(--vscode-textLink-foreground); }
code {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 0.92em;
  background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.15));
  border-radius: 3px;
  padding: 0.15em 0.35em;
}
pre { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12)); padding: 12px 14px; border-radius: 6px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin-left: 0; padding: 0.2em 1em; border-left: 3px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,0.4)); color: var(--vscode-descriptionForeground); }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); padding: 6px 12px; }
th { background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.12)); }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); margin: 1.6em 0; }
ul.contains-task-list,
ol.contains-task-list { list-style: none; padding-left: 1.2em; }
.task-list-item { list-style: none; }
.task-list-item-checkbox {
  margin: 0 0.5em 0 0;
  vertical-align: middle;
  pointer-events: none;
}
.mdc-alert,
.markdown-alert {
  border-left: 0.25em solid var(--vscode-textBlockQuote-border, rgba(128,128,128,0.45));
  padding: 0.5em 1em;
  margin: 1em 0;
  background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.08));
}
.mdc-alert-note, .markdown-alert-note { border-left-color: #0969da; }
.mdc-alert-tip, .markdown-alert-tip { border-left-color: #1a7f37; }
.mdc-alert-important, .markdown-alert-important { border-left-color: #8250df; }
.mdc-alert-warning, .markdown-alert-warning { border-left-color: #9a6700; }
.mdc-alert-caution, .markdown-alert-caution { border-left-color: #cf222e; }
.mdc-alert-title,
.markdown-alert-title {
  font-weight: 600;
  margin: 0 0 0.35em;
}
.footnotes-sep { margin-top: 2em; }
.footnotes { font-size: 0.92em; opacity: 0.92; }
.footnote-ref { font-size: 0.85em; }
.footnote-backref { text-decoration: none; margin-left: 0.25em; }

/* 高亮 */
mark.mdc-hl { background: rgba(255, 209, 102, 0.28); border-radius: 2px; cursor: pointer; color: inherit; transition: background-color .15s, box-shadow .15s; }
mark.mdc-hl.resolved { background: rgba(140, 140, 140, 0.20); }
mark.mdc-hl.active { background: rgba(255, 167, 38, 0.5); box-shadow: 0 0 0 1px rgba(255, 167, 38, 0.55); }
.mdc-block-hl { background: rgba(255, 209, 102, 0.12); cursor: pointer; transition: background-color .15s; }
.mdc-block-hl.active { background: rgba(255, 167, 38, 0.20); }

/* 侧栏 */
#sidebar-head {
  position: sticky; top: 0; z-index: 5;
  display: flex; justify-content: space-between; align-items: center; gap: 4px; padding: 8px 6px 8px 4px;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
}
#mdc-tabs {
  display: flex; gap: 1px; min-width: 0; flex: 1; flex-wrap: nowrap; overflow-x: auto;
  scrollbar-width: none;
}
#mdc-tabs::-webkit-scrollbar { display: none; }
.mdc-tab {
  display: inline-flex; align-items: center; gap: 3px; flex: none; white-space: nowrap;
  font-size: 0.82em; padding: 3px 6px; border: none; border-radius: 999px; cursor: pointer;
  background: transparent; color: var(--vscode-foreground); opacity: 0.65;
}
.mdc-tab:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15)); }
.mdc-tab.active { opacity: 1; font-weight: 600; background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.22)); }
.mdc-tab-n {
  display: none; min-width: 16px; padding: 0 5px; border-radius: 999px;
  font-size: 0.88em; line-height: 16px; text-align: center; font-weight: 600;
  background: var(--vscode-badge-background, rgba(128,128,128,0.35)); color: var(--vscode-badge-foreground, inherit);
}
.mdc-tab-n.show { display: inline-block; }
#mdc-head-actions { display: flex; align-items: center; gap: 2px; flex: none; }
#mdc-head-actions .mdc-icon { flex: none; opacity: 0.72; }
#mdc-head-actions .mdc-icon:hover { opacity: 1; }
#mdc-copy-skill:disabled {
  opacity: 0.32; cursor: default;
}
#mdc-copy-skill:disabled:hover { opacity: 0.32; background: transparent; }
#mdc-toggle-sidebar { flex: none; opacity: 0.72; }
#app.sidebar-collapsed #sidebar {
  width: 0; min-width: 0; padding: 0; margin: 0; border: none;
  overflow: hidden; opacity: 0; pointer-events: none;
}
#sidebar-inner { padding: 12px; }

/* 收起后的浮动 peek 按钮（目录 / 评论）——置顶，visibility+opacity 淡入淡出 */
.mdc-peek {
  position: absolute; z-index: 40;
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; padding: 0; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, #252526));
  color: var(--vscode-foreground);
  box-shadow: 0 2px 12px rgba(0,0,0,0.28);
  visibility: hidden; opacity: 0; pointer-events: none;
  transform: scale(0.88);
  transition: opacity .22s ease, transform .22s cubic-bezier(0.4, 0, 0.2, 1), visibility .22s;
}
.mdc-peek:hover { background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
.mdc-peek svg { display: block; }
#mdc-peek-outline { left: 12px; top: 10px; }
#mdc-peek-sidebar { right: 12px; top: 10px; }
#app.outline-collapsed #mdc-peek-outline,
#app.sidebar-collapsed #mdc-peek-sidebar {
  visibility: visible; opacity: 0.94; pointer-events: auto; transform: scale(1);
}
#app.outline-collapsed #mdc-peek-outline:hover,
#app.sidebar-collapsed #mdc-peek-sidebar:hover { opacity: 1; }
#mdc-peek-outline.mdc-tip::after,
#mdc-peek-outline.mdc-tip:hover::after {
  left: calc(100% + 8px); right: auto; top: 50%; margin-top: 0;
  transform: translateY(-50%);
}
#mdc-peek-sidebar.mdc-tip::after,
#mdc-peek-sidebar.mdc-tip:hover::after {
  right: calc(100% + 8px); left: auto; top: 50%; margin-top: 0;
  transform: translateY(-50%);
}
.mdc-empty { opacity: 0.6; padding: 16px 6px; font-size: 0.9em; }
.mdc-card {
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  border-radius: 8px; padding: 10px; margin-bottom: 10px; cursor: pointer;
  background: var(--vscode-editor-background, transparent);
}
.mdc-card { transition: border-color .15s, box-shadow .15s; }
.mdc-card.resolved { opacity: 0.6; }
.mdc-card.active { opacity: 1; border-color: var(--vscode-focusBorder); box-shadow: inset 3px 0 0 var(--vscode-focusBorder); }
.mdc-card.orphaned { opacity: 0.7; }
.mdc-orphaned-tag {
  display: inline-block; font-size: 0.75em; padding: 1px 6px; border-radius: 3px;
  background: var(--vscode-inputValidation-warningBackground, rgba(255,204,0,0.15));
  color: var(--vscode-inputValidation-warningForeground, #cc0);
  vertical-align: middle; margin-right: 4px;
}
.mdc-card-head { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 8px; }
.mdc-card-quote {
  flex: 1; min-width: 0; font-size: 0.8em; opacity: 0.75; padding-left: 6px; line-height: 22px;
  border-left: 2px solid var(--vscode-textBlockQuote-border, rgba(128,128,128,0.4));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mdc-card-tools { flex: none; display: flex; gap: 2px; }
.mdc-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0; border: none; border-radius: 4px;
  background: transparent; color: var(--vscode-foreground); opacity: 0.55; cursor: pointer;
}
.mdc-icon:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.18)); }
.mdc-icon svg { display: block; }
.mdc-icon.resolve.on { color: var(--vscode-charts-green, #3fb950); opacity: 0.95; }

/* 图标悬浮提示 */
.mdc-tip { position: relative; }
.mdc-tip::after {
  content: attr(data-tip); position: absolute; top: 100%; right: 0; margin-top: 5px;
  padding: 3px 7px; border-radius: 4px; font-size: 11px; line-height: 1.3; white-space: nowrap;
  background: var(--vscode-editorHoverWidget-background, #252526);
  color: var(--vscode-editorHoverWidget-foreground, #cccccc);
  border: 1px solid var(--vscode-editorHoverWidget-border, rgba(128,128,128,0.3));
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  opacity: 0; transform: translateY(2px); pointer-events: none; transition: opacity .12s, transform .12s; z-index: 50;
}
.mdc-tip:hover::after { opacity: 1; transform: translateY(0); }

.mdc-cmt { position: relative; margin: 8px 0; font-size: 0.9em; word-break: break-word; }
.mdc-cmt-head { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
.mdc-author { font-weight: 600; }
.mdc-author.agent { color: var(--vscode-charts-green, #4caf50); }
.mdc-time { font-size: 0.82em; opacity: 0.5; }
.mdc-cmt-tools { margin-left: auto; flex: none; display: flex; gap: 2px; }
.mdc-cmt-tools .mdc-icon { width: 20px; height: 20px; opacity: 0; }
.mdc-cmt:hover .mdc-cmt-tools .mdc-icon { opacity: 0.5; }
.mdc-cmt-tools .mdc-icon:hover { opacity: 1 !important; }
.mdc-body { white-space: pre-wrap; }
.mdc-edit { margin: 4px 0 2px; }
.mdc-edit .mdc-card-actions { margin-top: 6px; }

.mdc-card-reply { position: relative; margin-top: 8px; }
textarea.mdc-reply, textarea.mdc-draft-input, textarea.mdc-edit-input {
  width: 100%; box-sizing: border-box; resize: vertical; font-family: inherit;
  font-size: 0.9em; line-height: 1.5; padding: 6px; border-radius: 4px;
  background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
}
textarea.mdc-edit-input { min-height: 56px; }
textarea.mdc-reply { min-height: 34px; padding-right: 36px; }
/* 发送按钮：输入框有内容（非 placeholder 态）才显示 */
.mdc-icon.mdc-send {
  position: absolute; right: 6px; bottom: 7px; width: 26px; height: 26px; display: none; opacity: 0.95;
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
}
.mdc-icon.mdc-send:hover { opacity: 1; background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
.mdc-reply:not(:placeholder-shown) ~ .mdc-icon.mdc-send { display: inline-flex; }

/* 新建评论草稿卡（在侧栏顶部，独立于线程列表，刷新不冲掉） */
#sidebar-draft:not(:empty) { padding: 12px 12px 0; }
.mdc-draft { border: 1px solid var(--vscode-focusBorder); border-radius: 8px; padding: 10px; background: var(--vscode-editor-background, transparent); }
textarea.mdc-draft-input { min-height: 76px; margin: 8px 0; }
.mdc-card-actions { display: flex; gap: 6px; justify-content: flex-end; }
.mdc-card-actions button {
  font-size: 0.85em; padding: 3px 12px; border: none; border-radius: 4px; cursor: pointer;
  background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.2));
  color: var(--vscode-button-secondaryForeground, inherit);
}
.mdc-card-actions button[data-act="submit"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.mdc-browser-only { display: none !important; }
`;

/** Fallback VS Code-like tokens so the shared CSS works in a system browser. */
export const BROWSER_THEME_STYLE = `
:root {
  color-scheme: light dark;
  --vscode-font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --vscode-font-size: 14px;
  --vscode-foreground: #1f1f1f;
  --vscode-editor-background: #ffffff;
  --vscode-editor-foreground: #1f1f1f;
  --vscode-sideBar-background: #f3f3f3;
  --vscode-widget-border: rgba(0,0,0,0.12);
  --vscode-textLink-foreground: #0b57d0;
  --vscode-textCodeBlock-background: rgba(0,0,0,0.05);
  --vscode-textBlockQuote-border: rgba(0,0,0,0.25);
  --vscode-textBlockQuote-background: rgba(0,0,0,0.04);
  --vscode-descriptionForeground: #5f6368;
  --vscode-input-background: #ffffff;
  --vscode-input-foreground: #1f1f1f;
  --vscode-input-border: rgba(0,0,0,0.18);
  --vscode-button-background: #0b57d0;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #0842a0;
  --vscode-button-secondaryBackground: rgba(0,0,0,0.08);
  --vscode-button-secondaryForeground: #1f1f1f;
  --vscode-toolbar-hoverBackground: rgba(0,0,0,0.08);
  --vscode-focusBorder: #0b57d0;
  --vscode-badge-background: #e3e3e3;
  --vscode-badge-foreground: #1f1f1f;
  --vscode-list-hoverBackground: rgba(0,0,0,0.06);
  --vscode-list-activeSelectionBackground: rgba(11,87,208,0.16);
  --vscode-list-activeSelectionForeground: #1f1f1f;
  --vscode-editorHoverWidget-background: #ffffff;
  --vscode-editorHoverWidget-foreground: #1f1f1f;
  --vscode-editorHoverWidget-border: rgba(0,0,0,0.16);
  --vscode-editorWidget-background: #ffffff;
  --vscode-inputValidation-warningBackground: rgba(255,204,0,0.18);
  --vscode-inputValidation-warningForeground: #8a6d00;
  --vscode-charts-green: #188038;
}
@media (prefers-color-scheme: dark) {
  :root {
    --vscode-foreground: #cccccc;
    --vscode-editor-background: #1e1e1e;
    --vscode-editor-foreground: #d4d4d4;
    --vscode-sideBar-background: #252526;
    --vscode-widget-border: rgba(255,255,255,0.12);
    --vscode-textLink-foreground: #3794ff;
    --vscode-textCodeBlock-background: rgba(255,255,255,0.06);
    --vscode-textBlockQuote-border: rgba(255,255,255,0.22);
    --vscode-textBlockQuote-background: rgba(255,255,255,0.04);
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-input-background: #3c3c3c;
    --vscode-input-foreground: #cccccc;
    --vscode-input-border: transparent;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-secondaryBackground: rgba(255,255,255,0.12);
    --vscode-button-secondaryForeground: #cccccc;
    --vscode-toolbar-hoverBackground: rgba(255,255,255,0.1);
    --vscode-focusBorder: #007fd4;
    --vscode-badge-background: #4d4d4d;
    --vscode-badge-foreground: #ffffff;
    --vscode-list-hoverBackground: rgba(255,255,255,0.08);
    --vscode-list-activeSelectionBackground: rgba(0,122,204,0.28);
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-editorHoverWidget-background: #252526;
    --vscode-editorHoverWidget-foreground: #cccccc;
    --vscode-editorHoverWidget-border: rgba(255,255,255,0.16);
    --vscode-editorWidget-background: #252526;
    --vscode-inputValidation-warningBackground: rgba(255,204,0,0.15);
    --vscode-inputValidation-warningForeground: #cca700;
    --vscode-charts-green: #3fb950;
  }
}

.mdc-browser-only { display: none !important; }
body.mdc-browser .mdc-browser-only { display: inline-flex !important; }
#mdc-save-sync {
  font-size: 0.78em; padding: 3px 8px; border: none; border-radius: 4px; cursor: pointer;
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  opacity: 1; width: auto; height: auto; gap: 4px;
}
#mdc-save-sync:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
#mdc-save-sync:disabled { opacity: 0.45; cursor: default; }
#mdc-sync-status {
  font-size: 0.75em; opacity: 0.7; white-space: nowrap; max-width: 10em;
  overflow: hidden; text-overflow: ellipsis;
}
body.mdc-browser #mdc-sync-status { display: inline !important; }
`;

export function previewAppMarkup(): string {
  return `<div id="app">
  <aside id="outline">
    <div id="outline-head">
      <span id="outline-title">大纲</span>
      <button id="mdc-toggle-outline" class="mdc-icon mdc-tip" data-tip="收起目录" aria-label="收起目录" aria-expanded="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4l-4 4 4 4"/></svg></button>
    </div>
    <nav id="outline-tree" aria-label="大纲"></nav>
  </aside>
  <button type="button" id="mdc-peek-outline" class="mdc-peek mdc-tip" data-tip="展开目录" aria-label="展开目录" title="展开目录"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M3 8h10M3 11.5h7"/><path d="M3 4.5v7"/></svg></button>
  <main id="content"></main>
  <button type="button" id="mdc-peek-sidebar" class="mdc-peek mdc-tip" data-tip="展开评论" aria-label="展开评论" title="展开评论"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 3h9A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H8.2L5 13.5V11H3.5A1.5 1.5 0 0 1 2 9.5v-5A1.5 1.5 0 0 1 3.5 3z"/></svg></button>
  <aside id="sidebar">
    <div id="sidebar-head">
      <div id="mdc-tabs">
        <button class="mdc-tab active" data-tab="open">未解决<span class="mdc-tab-n"></span></button>
        <button class="mdc-tab" data-tab="resolved">已解决<span class="mdc-tab-n"></span></button>
        <button class="mdc-tab" data-tab="all">全部<span class="mdc-tab-n"></span></button>
      </div>
      <div id="mdc-head-actions">
        <span id="mdc-sync-status" class="mdc-browser-only" aria-live="polite"></span>
        <button type="button" id="mdc-save-sync" class="mdc-browser-only mdc-tip" data-tip="立即写入本地评论存储" aria-label="保存评论" title="保存">保存</button>
        <button type="button" id="mdc-add-doc" class="mdc-icon mdc-tip" data-tip="全文评论" aria-label="全文评论" title="全文评论"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h5.5L12.5 5.5V13.5H4z"/><path d="M9.5 2.5V5.5h3"/><path d="M6 8h4.5M6 10.5h3"/><circle cx="11.2" cy="11.2" r="2.3"/><path d="M11.2 10.2v2M10.2 11.2h2"/></svg></button>
        <button type="button" id="mdc-copy-skill" class="mdc-icon mdc-tip" data-tip="复制 Skill 提示" aria-label="复制 Skill 提示" title="复制 Skill 提示"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="3" width="7" height="9" rx="1.2"/><path d="M4 5.5H3.5A1.5 1.5 0 0 0 2 7v5.5A1.5 1.5 0 0 0 3.5 14H9"/><path d="M7.5 6.5h3M7.5 9h3"/></svg></button>
        <button id="mdc-toggle-sidebar" class="mdc-icon mdc-tip" data-tip="收起评论" aria-label="收起评论" aria-expanded="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg></button>
      </div>
    </div>
    <div id="sidebar-draft"></div>
    <div id="sidebar-inner"></div>
  </aside>
</div>`;
}

export interface PreviewHtmlOptions {
  title: string;
  scriptUri: string;
  styleUri: string;
  csp?: string;
  nonce?: string;
  extraHead?: string;
  bodyClass?: string;
  includeBrowserTheme?: boolean;
}

export function buildPreviewHtml(options: PreviewHtmlOptions): string {
  const title = escapeHtml(options.title);
  const csp = options.csp
    ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(options.csp)}" />\n`
    : '';
  const nonceAttr = options.nonce ? ` nonce="${options.nonce}"` : '';
  const theme = options.includeBrowserTheme ? `<style>${BROWSER_THEME_STYLE}</style>\n` : '';
  const extra = options.extraHead ?? '';
  const bodyClass = options.bodyClass ? ` class="${escapeHtml(options.bodyClass)}"` : '';
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
${csp}<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<link rel="stylesheet" href="${escapeHtml(options.styleUri)}" />
${theme}<style>${PREVIEW_STYLE}</style>
${extra}</head>
<body${bodyClass}>
${previewAppMarkup()}
<script${nonceAttr} src="${escapeHtml(options.scriptUri)}"></script>
</body>
</html>`;
}
