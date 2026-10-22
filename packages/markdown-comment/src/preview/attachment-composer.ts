/** Draft images stay in webview memory. Only an explicit submit sends bytes to storage. */
export type DraftAttachment =
  | { id: string; name: string; mime: string; size: number; uri?: string }
  | { name: string; mime: string; size: number; data: string; uri: string };
export type AttachmentInput = { id: string } | { name: string; mime: string; data: string };
const MAX_COUNT = 10;
const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 30 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function validateDraftFiles(
  existing: readonly { size: number }[],
  files: readonly { size: number; type: string }[],
): void {
  if (existing.length + files.length > MAX_COUNT) {
    throw new Error('每条评论最多 10 张图片。');
  }
  if (files.some((file) => !TYPES.has(file.type))) {
    throw new Error('仅支持 PNG、JPEG、GIF 和 WebP 图片。');
  }
  if (files.some((file) => file.size <= 0 || file.size > MAX_FILE)) {
    throw new Error('每张图片必须为 1 字节至 10 MiB。');
  }
  if ([...existing, ...files].reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL) {
    throw new Error('每条评论图片总大小不得超过 30 MiB。');
  }
}
export function moveAttachment<T>(items: T[], index: number, delta: number): void {
  const destination = index + delta;
  if (index < 0 || index >= items.length || destination < 0 || destination >= items.length) {
    return;
  }
  [items[index], items[destination]] = [items[destination], items[index]];
}
export function attachmentInputs(items: readonly DraftAttachment[]): AttachmentInput[] {
  return items.map((item) =>
    'id' in item ? { id: item.id } : { name: item.name, mime: item.mime, data: item.data },
  );
}
/** Clipboard items and files often describe the same image. Prefer items, then fall back. */
export function clipboardImageFiles(clipboard: Pick<DataTransfer, 'items' | 'files'>): File[] {
  const items = Array.from(clipboard.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file && file.type.startsWith('image/'));
  return items.length
    ? items
    : Array.from(clipboard.files ?? []).filter((file) => file.type.startsWith('image/'));
}

function readImage(file: File): Promise<DraftAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reader.onabort = () => reject(new Error('图片读取失败，请重试。'));
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:')) {
        reject(new Error('图片读取失败，请重试。'));
        return;
      }
      const uri = reader.result;
      resolve({
        name: file.name,
        mime: file.type,
        size: file.size,
        data: uri.slice(uri.indexOf(',') + 1),
        uri,
      });
    };
    reader.readAsDataURL(file);
  });
}

export interface AttachmentComposer {
  count: () => number;
  inputs: () => AttachmentInput[];
  setBusy: (busy: boolean) => void;
  error: (message: string) => void;
  clear: () => void;
  isBusy: () => boolean;
}
export function createAttachmentComposer(
  container: HTMLElement,
  initial: DraftAttachment[] = [],
): AttachmentComposer {
  let items = [...initial];
  let busy = false;
  let pendingFiles: File[] = [];
  let queue = Promise.resolve();
  let generation = 0;
  const isBusy = (): boolean => busy || pendingFiles.length > 0;
  const root = document.createElement('div');
  root.className = 'mdc-attachment-composer';
  const list = document.createElement('div');
  list.className = 'mdc-attachment-list';
  const error = document.createElement('div');
  error.className = 'mdc-composer-error';
  error.setAttribute('role', 'alert');
  root.append(list, error);
  container.append(root);
  root.addEventListener('click', (event) => event.stopPropagation());
  function render(): void {
    list.replaceChildren();
    items.forEach((item, index) => {
      const tile = document.createElement('div');
      tile.className = 'mdc-attachment-tile';
      const image = document.createElement('img');
      image.alt = item.name;
      if (item.uri) {
        image.src = item.uri;
      }
      const name = document.createElement('span');
      name.textContent = `${index + 1}. ${item.name}`;
      name.title = item.name;
      const actions = document.createElement('div');
      for (const [label, delta] of [
        ['前移', -1],
        ['后移', 1],
        ['删除', 0],
      ] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.setAttribute('aria-label', `${label} ${item.name}`);
        button.disabled = isBusy() || (delta !== 0 && (index + delta < 0 || index + delta >= items.length));
        button.addEventListener('click', () => {
          if (isBusy()) {
            return;
          }
          if (delta) {
            moveAttachment(items, index, delta);
          } else {
            items.splice(index, 1);
          }
          render();
        });
        actions.append(button);
      }
      tile.append(image, name, actions);
      list.append(tile);
    });
    container.classList.toggle('mdc-has-attachments', items.length > 0);
  }
  const input = container.querySelector<HTMLTextAreaElement>('textarea');
  if (input) {
    const imageHelp = '可粘贴图片，最多 10 张，每张 10 MiB';
    if (!input.hasAttribute('aria-label')) {
      input.setAttribute('aria-label', input.placeholder || '评论');
    }
    input.setAttribute('aria-description', imageHelp);
    input.title = imageHelp;
  }
  input?.addEventListener('paste', (event) => {
    const clipboard = event.clipboardData;
    if (!clipboard || event.defaultPrevented || busy || input.disabled || input.readOnly) {
      return;
    }
    const files = clipboardImageFiles(clipboard);
    if (!files.length) {
      return; // Ordinary text (including Markdown image links) keeps native paste behavior.
    }
    if (!clipboard.getData('text/plain')) {
      event.preventDefault();
    }
    try {
      // Reserve limits immediately, before another paste can enqueue more files.
      validateDraftFiles([...items, ...pendingFiles], files);
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : '图片读取失败。';
      return;
    }
    error.textContent = '';
    pendingFiles.push(...files);
    const currentGeneration = generation;
    render();
    // Serial batches preserve clipboard order even if individual reads complete out of order.
    queue = queue.then(async () => {
      if (currentGeneration !== generation) {
        return;
      }
      try {
        const selected = await Promise.all(files.map(readImage));
        if (currentGeneration === generation) {
          items.push(...selected);
        }
      } catch (reason) {
        if (currentGeneration === generation) {
          error.textContent = reason instanceof Error ? reason.message : '图片读取失败。';
        }
      } finally {
        if (currentGeneration === generation) {
          pendingFiles.splice(0, files.length);
          render();
        }
      }
    });
  });
  render();
  return {
    count: () => items.length,
    inputs: () => attachmentInputs(items),
    isBusy,
    setBusy(value) {
      busy = value;
      render();
    },
    error(message) {
      error.textContent = message;
    },
    clear() {
      // Late reads from a cleared draft must not repopulate it or affect a new paste.
      generation += 1;
      pendingFiles = [];
      queue = Promise.resolve();
      items = [];
      error.textContent = '';
      render();
    },
  };
}
