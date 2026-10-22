/// <reference lib="dom" />

/** Keep native copy and host shortcuts working for rendered text, without taking
 * over editing shortcuts in the comment composers. */
export function installSelectionCopy(copyText: (text: string) => void): void {
  const selectedText = (target: EventTarget | null): string | undefined => {
    const element = target instanceof Element ? target : document.activeElement;
    if (element?.closest('textarea, input, [contenteditable="true"]')) {
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      return;
    }
    const range = selection.getRangeAt(0);
    const start =
      range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    if (
      !start?.closest('#content, .mdc-body') ||
      !end?.closest('#content, .mdc-body') ||
      start.closest('.mdc-code-toolbar') ||
      end.closest('.mdc-code-toolbar')
    ) {
      return;
    }
    // Browser Selection preserves rendered line breaks and excludes user-select:none controls.
    return selection.toString() || undefined;
  };
  let contextRoot: Element | undefined;
  document.addEventListener('contextmenu', (event) => {
    // Set metadata before VS Code's window-level context menu listener reads it.
    contextRoot?.removeAttribute('data-vscode-context');
    contextRoot = undefined;
    const target = event.target instanceof Element ? event.target : null;
    const root = target?.closest('#content, .mdc-body');
    const text = selectedText(event.target);
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : undefined;
    if (
      !root ||
      !range ||
      !root.contains(range.commonAncestorContainer) ||
      !text ||
      text.length > 10 * 1024 * 1024
    ) {
      return;
    }
    root.setAttribute(
      'data-vscode-context',
      JSON.stringify({
        mdcHasSelection: true,
        mdcSelectedText: text,
        preventDefaultContextMenuItems: true,
      }),
    );
    contextRoot = root;
  });
  document.addEventListener('copy', (event) => {
    const text = selectedText(event.target);
    if (text === undefined || !event.clipboardData) {
      return;
    }
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    // Native menu commands may run in an unfocused iframe; use the same host
    // clipboard bridge as the shortcut in addition to the browser event payload.
    if (text.length <= 10 * 1024 * 1024) {
      copyText(text);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== 'c'
    ) {
      return;
    }
    const text = selectedText(event.target);
    if (text === undefined) {
      return;
    }
    if (text.length > 10 * 1024 * 1024) {
      return; // Above the host message bound, retain native clipboard handling.
    }
    // VS Code can route a webview shortcut to its editor command. Keep the gesture
    // in this webview and use the extension host clipboard rather than navigator permissions.
    event.preventDefault();
    event.stopPropagation();
    copyText(text);
  });
}
