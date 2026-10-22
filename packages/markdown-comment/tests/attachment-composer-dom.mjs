/** Focused composer DOM regression checks. Run with JSDOM_MODULE pointing to an
 * installed jsdom module. FileReader completion is controlled to exercise races. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.JSDOM_MODULE || 'jsdom');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundled = await build({
  entryPoints: [path.join(packageRoot, 'src/preview/attachment-composer.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'attachmentComposer',
  write: false,
});
const code = bundled.outputFiles[0].text;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, initial = []) {
  const dom = new JSDOM('<div id="form"><textarea></textarea></div>', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const reads = [];
  window.FileReader = class {
    readAsDataURL(file) {
      this.file = file;
      reads.push(this);
    }
    finish() {
      this.result = `data:${this.file.type};base64,AQID`;
      this.onload();
    }
    fail() {
      this.onerror();
    }
    abort() {
      this.onabort();
    }
  };
  window.eval(`${code}\nwindow.attachmentComposer = attachmentComposer;`);
  const form = window.document.getElementById('form');
  const input = form.querySelector('textarea');
  const composer = window.attachmentComposer.createAttachmentComposer(form, initial);
  const file = (name, type = 'image/png', size = 3) => {
    const result = new window.File(['img'], name, { type });
    Object.defineProperty(result, 'size', { value: size });
    return result;
  };
  const paste = (files = [], text = '', prevented = false) => {
    const event = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: files.map((image) => ({ kind: 'file', getAsFile: () => image })),
        files,
        getData: (type) => (type === 'text/plain' ? text : ''),
      },
    });
    if (prevented) {
      event.preventDefault();
    }
    input.dispatchEvent(event);
    return event;
  };
  const names = () => Array.from(composer.inputs(), (item) => item.name ?? item.id);
  const error = () => form.querySelector('[role="alert"]').textContent;
  const click = (label) => {
    const button = form.querySelector(`button[aria-label="${label}"]`);
    assert.ok(button, label);
    button.click();
  };
  return { composer, form, input, reads, file, paste, names, error, click };
}

test('composer removes external hint, keeps accessible limits, and leaves text paste native', async (t) => {
  const f = fixture(t);
  assert.equal(f.form.querySelector('input[type="file"], button'), null);
  assert.equal(f.form.querySelector('.mdc-attachment-hint'), null);
  assert.equal(f.input.getAttribute('aria-label'), '评论');
  assert.match(f.input.getAttribute('aria-description'), /最多 10 张，每张 10 MiB/);
  assert.match(f.input.title, /可粘贴图片/);
  f.input.value = 'draft';
  assert.equal(f.paste([], 'normal text').defaultPrevented, false);
  assert.equal(f.paste([], '![image](https://example.com/image.png)').defaultPrevented, false);
  assert.equal(f.paste([f.file('notes.txt', 'text/plain')], 'notes').defaultPrevented, false);
  await tick();
  assert.equal(f.input.value, 'draft');
  assert.equal(f.reads.length, 0);
  assert.equal(f.composer.count(), 0);
  assert.equal(f.composer.isBusy(), false);
});

test('mixed text and image paste retains text behavior and adds the image', async (t) => {
  const f = fixture(t);
  assert.equal(f.paste([f.file('mixed.png')], 'caption').defaultPrevented, false);
  assert.equal(f.composer.isBusy(), true);
  await tick();
  f.reads[0].finish();
  await tick();
  assert.deepEqual(f.names(), ['mixed.png']);
  assert.equal(f.composer.isBusy(), false);
});

test('image-only paste preserves multiple batches and read order, with removal and movement', async (t) => {
  const f = fixture(t, [{ id: 'old', name: 'old.png', mime: 'image/png', size: 3 }]);
  assert.equal(f.paste([f.file('first.png'), f.file('second.png')]).defaultPrevented, true);
  f.paste([f.file('third.png')]);
  assert.equal(f.composer.isBusy(), true);
  f.click('删除 old.png');
  assert.deepEqual(f.names(), ['old'], 'attachment controls are locked while reading');
  await tick();
  assert.deepEqual(
    f.reads.map((read) => read.file.name),
    ['first.png', 'second.png'],
  );
  f.reads[1].finish();
  await tick();
  assert.deepEqual(f.names(), ['old'], 'a batch is added atomically');
  f.reads[0].finish();
  await tick();
  assert.equal(f.reads[2].file.name, 'third.png');
  f.reads[2].finish();
  await tick();
  assert.deepEqual(f.names(), ['old', 'first.png', 'second.png', 'third.png']);
  assert.equal(f.composer.isBusy(), false);
  f.click('前移 third.png');
  f.click('删除 first.png');
  assert.deepEqual(f.names(), ['old', 'third.png', 'second.png']);
});

test('pending images reserve the count and aggregate size limits', async (t) => {
  const f = fixture(
    t,
    Array.from({ length: 8 }, (_, i) => ({ id: `old-${i}`, name: `${i}.png`, mime: 'image/png', size: 3 })),
  );
  f.paste([f.file('ninth.png'), f.file('tenth.png')]);
  f.paste([f.file('eleventh.png')]);
  assert.match(f.error(), /最多 10 张/);
  await tick();
  assert.equal(f.reads.length, 2);
  f.reads.forEach((read) => read.finish());
  await tick();
  assert.equal(f.composer.count(), 10);
  assert.match(f.error(), /最多 10 张/, 'later validation errors survive earlier read completion');

  f.composer.clear();
  f.paste([f.file('a.png', 'image/png', 10 * 1024 * 1024), f.file('b.png', 'image/png', 10 * 1024 * 1024)]);
  f.paste([f.file('c.png', 'image/png', 10 * 1024 * 1024)]);
  f.paste([f.file('over.png')]);
  assert.match(f.error(), /总大小不得超过 30 MiB/);
  await tick();
  assert.equal(f.reads.length, 4);
});

test('unsupported, empty and oversized images report validation errors without reading', async (t) => {
  const f = fixture(t);
  f.paste([f.file('vector.svg', 'image/svg+xml')]);
  assert.match(f.error(), /仅支持 PNG、JPEG、GIF 和 WebP/);
  f.paste([f.file('empty.png', 'image/png', 0)]);
  assert.match(f.error(), /1 字节至 10 MiB/);
  f.paste([f.file('big.png', 'image/png', 10 * 1024 * 1024 + 1)]);
  assert.match(f.error(), /1 字节至 10 MiB/);
  await tick();
  assert.equal(f.reads.length, 0);
  assert.equal(f.composer.isBusy(), false);
});

test('busy, disabled, read-only and already handled paste cannot modify attachments', async (t) => {
  const f = fixture(t, [{ id: 'old', name: 'old.png', mime: 'image/png', size: 3 }]);
  f.composer.setBusy(true);
  f.paste([f.file('busy.png')]);
  f.click('删除 old.png');
  f.composer.setBusy(false);
  f.input.disabled = true;
  f.paste([f.file('disabled.png')]);
  f.input.disabled = false;
  f.input.readOnly = true;
  f.paste([f.file('readonly.png')]);
  f.input.readOnly = false;
  f.paste([f.file('handled.png')], '', true);
  await tick();
  assert.equal(f.reads.length, 0);
  assert.deepEqual(f.names(), ['old']);
  f.paste([f.file('active.png')]);
  await tick();
  f.reads[0].finish();
  await tick();
  assert.deepEqual(f.names(), ['old', 'active.png']);
});

test('failed and aborted batches are atomic and do not block a later paste', async (t) => {
  const f = fixture(t);
  f.paste([f.file('first.png'), f.file('broken.png')]);
  f.paste([f.file('after-failure.png')]);
  await tick();
  f.reads[0].finish();
  f.reads[1].fail();
  await tick();
  assert.deepEqual(f.names(), []);
  assert.match(f.error(), /图片读取失败/);
  assert.equal(f.reads[2].file.name, 'after-failure.png');
  f.reads[2].abort();
  await tick();
  assert.equal(f.composer.isBusy(), false);
  f.paste([f.file('retry.png')]);
  assert.equal(f.error(), '');
  await tick();
  f.reads[3].finish();
  await tick();
  assert.deepEqual(f.names(), ['retry.png']);
});

test('clear invalidates late reads and queued batches without changing the new draft', async (t) => {
  const f = fixture(t);
  f.paste([f.file('old-read.png')]);
  f.paste([f.file('old-queued.png')]);
  await tick();
  f.composer.clear();
  assert.equal(f.composer.isBusy(), false);
  f.paste([f.file('new-draft.png')]);
  await tick();
  assert.deepEqual(
    f.reads.map((read) => read.file.name),
    ['old-read.png', 'new-draft.png'],
  );
  f.reads[0].finish();
  await tick();
  assert.deepEqual(f.names(), []);
  assert.equal(f.composer.isBusy(), true, 'late completion cannot clear the new loading state');
  f.reads[1].finish();
  await tick();
  assert.deepEqual(f.names(), ['new-draft.png']);
  assert.equal(f.composer.isBusy(), false);
  assert.equal(f.reads.length, 2, 'the cleared queued batch never starts reading');
});
