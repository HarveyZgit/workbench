import type { HeadingNode } from './heading';
import { buildHeadingTree, buildHeadingTreeFromDom } from './heading';

const ICON_OUTLINE_TWISTY =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
/** Same chevron button look as comments sidebar collapse, mirrored for left panel. */
const ICON_OUTLINE_COLLAPSE =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4l-4 4 4 4"/></svg>';

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export interface OutlineUiOptions {
  app: HTMLElement | null;
  content: HTMLElement | null;
  outlineTree: HTMLElement | null;
  toggleBtn: HTMLElement | null;
  peekBtn?: HTMLElement | null;
  getCollapsed: () => boolean;
  setCollapsedPersist: (collapsed: boolean) => void;
  getCollapsedIds: () => Set<string>;
  setCollapsedIds: (ids: Set<string>) => void;
  getSourceText: () => string;
}

export function createOutlineUi(options: OutlineUiOptions): {
  setCollapsed: (collapsed: boolean, persist?: boolean) => void;
  refresh: () => void;
  updateSpy: () => void;
} {
  const { app, content, outlineTree, toggleBtn, peekBtn } = options;

  function setActiveOutlineId(id: string | null): void {
    outlineTree?.querySelectorAll('.outline-row.active').forEach((el) => el.classList.remove('active'));
    if (!id || !outlineTree) {
      return;
    }
    const matched = Array.from(outlineTree.querySelectorAll<HTMLElement>('.outline-row[data-id]')).find(
      (el) => el.dataset.id === id,
    );
    matched?.classList.add('active');
  }

  function setCollapsed(collapsed: boolean, persist = true): void {
    app?.classList.toggle('outline-collapsed', collapsed);
    if (toggleBtn) {
      // Header toggle only visible while expanded; always shows collapse chevron.
      toggleBtn.setAttribute('data-tip', '收起目录');
      toggleBtn.setAttribute('aria-label', '收起目录');
      toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggleBtn.innerHTML = ICON_OUTLINE_COLLAPSE;
    }
    if (peekBtn) {
      peekBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      peekBtn.setAttribute('data-tip', '展开目录');
      peekBtn.setAttribute('aria-label', '展开目录');
    }
    if (persist) {
      options.setCollapsedPersist(collapsed);
    }
  }

  function scrollToHeadingId(id: string): void {
    if (!content || !id) {
      return;
    }
    let target: HTMLElement | null = null;
    try {
      target = content.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    } catch {
      target = null;
    }
    if (!target) {
      target = Array.from(content.querySelectorAll<HTMLElement>('[id]')).find((el) => el.id === id) ?? null;
    }
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveOutlineId(id);
  }

  function renderOutlineTree(nodes: HeadingNode[]): void {
    if (!outlineTree) {
      return;
    }
    const collapsedIds = options.getCollapsedIds();
    const indentFor = (level: number) => Math.max(0, level - 1) * 12;

    const renderNodes = (list: HeadingNode[]): string => {
      if (list.length === 0) {
        return '';
      }
      return `<ul class="outline-list">${list
        .map((node) => {
          const hasKids = node.children.length > 0;
          const collapsed = hasKids && collapsedIds.has(node.id);
          const twisty = hasKids
            ? `<button type="button" class="outline-twisty" data-outline-twisty="${esc(node.id)}" aria-label="展开/折叠" aria-expanded="${collapsed ? 'false' : 'true'}">${ICON_OUTLINE_TWISTY}</button>`
            : `<button type="button" class="outline-twisty" aria-hidden="true" tabindex="-1">${ICON_OUTLINE_TWISTY}</button>`;
          return `<li class="outline-node${collapsed ? ' collapsed' : ''}" data-outline-id="${esc(node.id)}">
  <div class="outline-row" data-id="${esc(node.id)}" style="padding-left:${indentFor(node.level)}px">
    ${twisty}
    <a class="outline-label" href="#${esc(node.id)}" data-outline-link="${esc(node.id)}" title="${esc(node.text)}">${esc(node.text) || '(untitled)'}</a>
  </div>
  ${hasKids ? renderNodes(node.children) : ''}
</li>`;
        })
        .join('')}</ul>`;
    };

    outlineTree.innerHTML = renderNodes(nodes);
  }

  function updateSpy(): void {
    if (!content || !outlineTree) {
      return;
    }
    const headings = Array.from(
      content.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'),
    );
    if (headings.length === 0) {
      setActiveOutlineId(null);
      return;
    }
    const rootTop = content.getBoundingClientRect().top;
    const offset = 12;
    let active: HTMLElement | null = headings[0];
    for (const heading of headings) {
      const top = heading.getBoundingClientRect().top - rootTop;
      if (top <= offset) {
        active = heading;
      } else {
        break;
      }
    }
    setActiveOutlineId(active?.id ?? null);
  }

  function refresh(): void {
    let tree: HeadingNode[] = [];
    if (content) {
      tree = buildHeadingTreeFromDom(content);
    }
    if (tree.length === 0) {
      const source = options.getSourceText();
      if (source) {
        tree = buildHeadingTree(source);
      }
    }
    renderOutlineTree(tree);
    updateSpy();
  }

  setCollapsed(options.getCollapsed(), false);

  toggleBtn?.addEventListener('click', () => {
    setCollapsed(true);
  });

  peekBtn?.addEventListener('click', () => {
    setCollapsed(false);
  });

  outlineTree?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const twisty = target.closest<HTMLElement>('[data-outline-twisty]');
    if (twisty && outlineTree.contains(twisty)) {
      event.preventDefault();
      const id = twisty.getAttribute('data-outline-twisty');
      if (!id) {
        return;
      }
      const node = twisty.closest<HTMLElement>('.outline-node');
      if (!node) {
        return;
      }
      const nextCollapsed = !node.classList.contains('collapsed');
      node.classList.toggle('collapsed', nextCollapsed);
      twisty.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      const ids = options.getCollapsedIds();
      if (nextCollapsed) {
        ids.add(id);
      } else {
        ids.delete(id);
      }
      options.setCollapsedIds(ids);
      return;
    }
    const link = target.closest<HTMLElement>('[data-outline-link]');
    if (link && outlineTree.contains(link)) {
      event.preventDefault();
      const id = link.getAttribute('data-outline-link');
      if (id) {
        scrollToHeadingId(id);
      }
      link.blur();
    }
  });

  content?.addEventListener(
    'scroll',
    () => {
      updateSpy();
    },
    { passive: true },
  );

  return { setCollapsed, refresh, updateSpy };
}
