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
  let loading = false;
  const root = document.createElement('div');
  root.className = 'mdc-attachment-composer';
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.accept = 'image/png,image/jpeg,image/gif,image/webp';
  picker.hidden = true;
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = '添加图片';
  const hint = document.createElement('span');
  hint.className = 'mdc-attachment-hint';
  hint.textContent = '最多 10 张 · 每张 10 MiB';
  const list = document.createElement('div');
  list.className = 'mdc-attachment-list';
  const error = document.createElement('div');
  error.className = 'mdc-composer-error';
  error.setAttribute('role', 'alert');
  root.append(picker, add, hint, list, error);
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
        button.disabled =
          busy || loading || (delta !== 0 && (index + delta < 0 || index + delta >= items.length));
        button.addEventListener('click', () => {
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
    add.disabled = busy || loading || items.length >= MAX_COUNT;
    container.classList.toggle('mdc-has-attachments', items.length > 0);
  }
  add.addEventListener('click', () => picker.click());
  picker.addEventListener('change', async () => {
    const files = Array.from(picker.files ?? []);
    picker.value = '';
    error.textContent = '';
    try {
      validateDraftFiles(items, files);
      loading = true;
      render();
      const selected = await Promise.all(
        files.map(
          (file) =>
            new Promise<DraftAttachment>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error('图片读取失败，请重试。'));
              reader.onload = () => {
                const uri = String(reader.result);
                resolve({
                  name: file.name,
                  mime: file.type,
                  size: file.size,
                  data: uri.slice(uri.indexOf(',') + 1),
                  uri,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );
      items.push(...selected);
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : '图片读取失败。';
    } finally {
      loading = false;
      render();
    }
  });
  render();
  return {
    count: () => items.length,
    inputs: () => attachmentInputs(items),
    isBusy: () => busy || loading,
    setBusy(value) {
      busy = value;
      render();
    },
    error(message) {
      error.textContent = message;
    },
    clear() {
      items = [];
      error.textContent = '';
      render();
    },
  };
}
