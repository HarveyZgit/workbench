import { expect, test } from '@rstest/core';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

test('build output contains a loadable Chrome extension', async () => {
  const outputRoot = path.resolve(process.cwd(), 'dist');
  const manifest = JSON.parse(await readFile(path.join(outputRoot, 'manifest.json'), 'utf8'));

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.background.service_worker).toBe('background.js');
  expect(manifest.content_scripts[0].js).toEqual(['lib/turndown.js', 'content.js']);

  await Promise.all([
    access(path.join(outputRoot, 'background.js')),
    access(path.join(outputRoot, 'content.js')),
    access(path.join(outputRoot, 'lib', 'turndown.js')),
  ]);
});
