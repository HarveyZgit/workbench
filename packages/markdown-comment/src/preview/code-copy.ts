/// <reference lib="dom" />

const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="5" y="5" width="8" height="9" rx="1"/><path d="M10 5V2H2v9h3"/></svg>';
const WRAP_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 3h12M2 7h9a3 3 0 0 1 0 6H8m2-2-2 2 2 2M2 11h3"/></svg>';

/** Keep controls outside the scrolling pre, with a dedicated toolbar that never covers code. */
export function addCodeCopyButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.parentElement?.classList.contains('mdc-code-block')) {
      return;
    }
    const block = document.createElement('div');
    block.className = 'mdc-code-block';
    // Keep top-level source blocks top-level: diff/selection/navigation use this boundary.
    if (pre.classList.contains('mdc-source-block')) {
      block.classList.add('mdc-source-block');
      pre.classList.remove('mdc-source-block');
      for (const attribute of ['data-line', 'data-end-line']) {
        const value = pre.getAttribute(attribute);
        if (value !== null) {
          block.setAttribute(attribute, value);
          pre.removeAttribute(attribute);
        }
      }
    }
    const toolbar = document.createElement('div');
    toolbar.className = 'mdc-code-toolbar';
    const label = document.createElement('span');
    label.className = 'mdc-code-language';
    label.textContent = code.dataset.codeLanguage || 'txt';
    const wrapButton = document.createElement('button');
    wrapButton.type = 'button';
    wrapButton.className = 'mdc-code-wrap';
    wrapButton.innerHTML = WRAP_ICON;
    wrapButton.setAttribute('aria-label', '自动换行');
    wrapButton.setAttribute('aria-pressed', 'false');
    wrapButton.title = '自动换行';
    wrapButton.addEventListener('click', () => {
      const wrapped = block.classList.toggle('mdc-code-wrap-enabled');
      wrapButton.setAttribute('aria-pressed', String(wrapped));
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mdc-code-copy';
    button.innerHTML = COPY_ICON;
    button.setAttribute('aria-label', '复制代码块');
    button.title = '复制代码块';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
      } catch {
        const selection = window.getSelection();
        if (!selection) {
          return;
        }
        const previousRanges = Array.from({ length: selection.rangeCount }, (_, index) =>
          selection.getRangeAt(index).cloneRange(),
        );
        const range = document.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
        let copied = false;
        try {
          copied = document.execCommand('copy');
        } catch {
          // Some webview/browser hosts disable the legacy clipboard fallback.
        } finally {
          selection.removeAllRanges();
          previousRanges.forEach((previous) => selection.addRange(previous));
        }
        if (!copied) {
          button.title = '复制失败，请选择代码后复制';
          return;
        }
      }
      button.setAttribute('aria-label', '已复制');
      button.title = '已复制';
      window.setTimeout(() => {
        button.setAttribute('aria-label', '复制代码块');
        button.title = '复制代码块';
      }, 1600);
    });
    toolbar.append(label, wrapButton, button);
    pre.before(block);
    block.append(toolbar, pre);
  });
}
