/* eslint-disable require-await -- Async API doubles intentionally resolve immediately. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareVersions,
  createApi,
  decideRelease,
  inspectRelease,
  publishRelease,
  releaseIdentity,
} from './markdown-comment-release.mjs';

const identity = releaseIdentity('1.7.1');
const sha = 'a'.repeat(40);
const draft = {
  id: 1,
  tag_name: identity.tag,
  draft: true,
  target_commitish: sha,
  body: `Changes\n<!-- markdown-comment:${sha} -->`,
  assets: [],
  upload_url: 'https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}',
};

test('accepts only stable versions and creates conventional tag/filename', () => {
  assert.deepEqual(identity, {
    version: '1.7.1',
    tag: 'markdown-comment-v1.7.1',
    asset: 'vscode-markdown-comment-1.7.1.vsix',
  });
  for (const value of ['1.2', '01.2.3', '1.2.3-rc.1', '1.2.3+meta', '1.2.3\n', '$(id)']) {
    assert.throws(() => releaseIdentity(value));
  }
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
});

test('existing tags/releases are never overwritten; only our same-commit draft resumes', () => {
  assert.equal(decideRelease(sha, null, false), 'create');
  assert.equal(decideRelease(sha, null, true), 'skip');
  assert.equal(decideRelease(sha, { draft: false }, true), 'skip');
  assert.equal(decideRelease(sha, draft, true), 'resume');
  assert.throws(() => decideRelease('b'.repeat(40), draft, true));
  assert.throws(() => decideRelease(sha, { ...draft, body: 'manual draft' }, false));
});

test('draft lookup paginates when tag endpoint returns 404', async () => {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path === 'releases?per_page=100&page=1') {
      return Array(100).fill({ tag_name: 'other' });
    }
    if (path === 'releases?per_page=100&page=2') {
      return [draft];
    }
    return null;
  };
  assert.equal((await inspectRelease(api, identity, sha)).action, 'resume');
  assert.ok(calls.includes('releases?per_page=100&page=2'));
});

test('only 404 means absent; authentication/rate/server errors fail closed', async () => {
  for (const status of [401, 403, 429, 500]) {
    const api = createApi('test', 'owner/repo', async () => ({ status, ok: false }));
    await assert.rejects(api('releases/tags/test', { missing: true }), /HTTP/);
  }
  const api = createApi('test', 'owner/repo', async () => ({ status: 404, ok: false }));
  assert.equal(await api('releases/tags/test', { missing: true }), null);
});

function fakeApi({ exists = false, uploadFails = false, latest = null } = {}) {
  const writes = [];
  const api = async (path, options = {}) => {
    if (!options.method) {
      if (path === 'releases/latest') {
        return latest;
      }
      if (path.startsWith('releases/tags/')) {
        return null;
      }
      if (path.startsWith('releases?')) {
        return exists ? [{ ...draft, assets: [{ id: 2, name: identity.asset }] }] : [];
      }
      if (path.startsWith('git/ref/')) {
        return null;
      }
    }
    writes.push({ path, ...options });
    if (path === 'releases') {
      return draft;
    }
    if (path.startsWith('https://uploads.')) {
      if (uploadFails) {
        throw new Error('Upload failed');
      }
      return { state: 'uploaded', size: 4 };
    }
    return null;
  };
  return { api, writes };
}

test('draft first, verified asset second, stable Latest last', async () => {
  const { api, writes } = fakeApi();
  assert.equal(await publishRelease(api, identity, sha, Buffer.from('vsix'), 'Actual change'), 'published');
  assert.equal(writes[0].body.draft, true);
  assert.equal(writes[0].body.target_commitish, sha);
  assert.match(writes[0].body.body, /Actual change/);
  assert.equal(writes[1].binary, true);
  assert.deepEqual(writes[2].body, { draft: false, prerelease: false, make_latest: 'true' });
});

test('upload failure does not publish; rerun resumes only matching draft', async () => {
  const first = fakeApi({ uploadFails: true });
  await assert.rejects(publishRelease(first.api, identity, sha, Buffer.from('vsix'), 'Changes'));
  assert.equal(
    first.writes.some((entry) => entry.method === 'PATCH'),
    false,
  );
  const retry = fakeApi({ exists: true });
  await publishRelease(retry.api, identity, sha, Buffer.from('vsix'), 'Changes');
  assert.equal(retry.writes[0].method, 'DELETE');
  assert.equal(
    retry.writes.some((entry) => entry.path === 'releases'),
    false,
  );
});

test('an older delayed release does not displace a newer Latest', async () => {
  const { api, writes } = fakeApi({ latest: { tag_name: 'markdown-comment-v1.8.0' } });
  await publishRelease(api, identity, sha, Buffer.from('vsix'), 'Changes');
  assert.equal(writes.at(-1).body.make_latest, 'false');
});

test('draft recovery validates lightweight and annotated tag commit before any write', async () => {
  for (const annotated of [false, true]) {
    for (const matches of [false, true]) {
      const resolved = { type: 'commit', sha: matches ? sha : 'b'.repeat(40) };
      const api = async (path, options = {}) => {
        assert.equal(options.method, undefined, 'No mutation before tag validation');
        if (path.startsWith('releases/tags/')) {
          return draft;
        }
        if (path.startsWith('git/ref/')) {
          return { object: annotated ? { type: 'tag', sha: 'c'.repeat(40) } : resolved };
        }
        if (path.startsWith('git/tags/')) {
          return { object: resolved };
        }
        throw new Error(`Unexpected path: ${path}`);
      };
      if (matches) {
        assert.equal((await inspectRelease(api, identity, sha)).action, 'resume');
      } else {
        await assert.rejects(
          publishRelease(api, identity, sha, Buffer.from('vsix'), 'Changes'),
          /does not point/,
        );
      }
    }
  }
});
