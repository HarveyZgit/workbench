import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const packagePath = 'packages/markdown-comment';
const prefix = 'markdown-comment-v';
export function compareVersions(left, right) {
  const a = releaseIdentity(left).version.split('.').map(BigInt);
  const b = releaseIdentity(right).version.split('.').map(BigInt);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] > b[i] ? 1 : -1;
    }
  }
  return 0;
}

export function releaseIdentity(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`Expected a stable x.y.z version, got ${version}`);
  }
  return { version, tag: `${prefix}${version}`, asset: `vscode-markdown-comment-${version}.vsix` };
}

export function decideRelease(sha, release, tagExists) {
  if (release && !release.draft) {
    return 'skip';
  }
  if (release) {
    if (release.target_commitish !== sha || !release.body?.includes(`<!-- markdown-comment:${sha} -->`)) {
      throw new Error('Existing draft belongs to another commit or was not created by this workflow');
    }
    return 'resume';
  }
  return tagExists ? 'skip' : 'create';
}

export function createApi(token, repository, transport = fetch) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('Missing token or invalid repository');
  }
  return async (path, { method = 'GET', body, binary = false, missing = false } = {}) => {
    const url = path.startsWith('https://uploads.github.com/')
      ? path
      : `https://api.github.com/repos/${repository}/${path}`;
    const response = await transport(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': binary ? 'application/octet-stream' : 'application/json',
      },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    });
    if (missing && response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    }
    return response.status === 204 ? null : response.json();
  };
}

export async function inspectRelease(api, identity, sha) {
  let release = await api(`releases/tags/${identity.tag}`, { missing: true });
  // The tag endpoint only guarantees published releases. Search authenticated drafts too.
  if (!release) {
    for (let page = 1; ; page += 1) {
      const releases = await api(`releases?per_page=100&page=${page}`);
      release = releases.find((entry) => entry.tag_name === identity.tag);
      if (release || releases.length < 100) {
        break;
      }
    }
  }
  const tag = await api(`git/ref/tags/${identity.tag}`, { missing: true });
  const action = decideRelease(sha, release, Boolean(tag));
  if (action === 'resume' && tag) {
    let { object } = tag;
    const seen = new Set();
    while (object?.type === 'tag') {
      if (seen.has(object.sha)) {
        throw new Error('Circular annotated tag');
      }
      seen.add(object.sha);
      object = (await api(`git/tags/${object.sha}`)).object;
    }
    if (object?.type !== 'commit' || object.sha !== sha) {
      throw new Error('Existing draft tag does not point to the triggering commit');
    }
  }
  return { release, action };
}

export async function publishRelease(api, identity, sha, bytes, notes) {
  const state = await inspectRelease(api, identity, sha);
  let { release } = state;
  const { action } = state;
  if (action === 'skip') {
    return 'skip';
  }
  if (!bytes.length) {
    throw new Error('Empty VSIX');
  }
  if (action === 'create') {
    release = await api('releases', {
      method: 'POST',
      body: {
        tag_name: identity.tag,
        target_commitish: sha,
        name: `Markdown Comment ${identity.version}`,
        body: `${notes}\n\n<!-- markdown-comment:${sha} -->`,
        draft: true,
        prerelease: false,
      },
    });
  }
  // Only replace an asset in our own unpublished draft. Published releases are immutable here.
  for (const asset of release.assets ?? []) {
    if (asset.name === identity.asset) {
      await api(`releases/assets/${asset.id}`, { method: 'DELETE' });
    }
  }
  const uploadUrl = release.upload_url?.split('{')[0];
  if (!uploadUrl?.startsWith('https://uploads.github.com/repos/')) {
    throw new Error('Invalid upload URL');
  }
  const upload = await api(`${uploadUrl}?name=${identity.asset}`, {
    method: 'POST',
    body: bytes,
    binary: true,
  });
  if (upload.state !== 'uploaded' || upload.size !== bytes.length) {
    throw new Error('VSIX upload incomplete');
  }
  const latest = await api('releases/latest', { missing: true });
  const latestVersion = latest?.tag_name?.startsWith(prefix) ? latest.tag_name.slice(prefix.length) : null;
  const newer = latestVersion && compareVersions(latestVersion, identity.version) > 0;
  await api(`releases/${release.id}`, {
    method: 'PATCH',
    body: { draft: false, prerelease: false, make_latest: newer ? 'false' : 'true' },
  });
  return 'published';
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

async function main() {
  const identity = releaseIdentity(JSON.parse(readFileSync(`${packagePath}/package.json`, 'utf8')).version);
  const sha = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || git('rev-parse', 'HEAD') !== sha) {
    throw new Error('Checkout must match the triggering commit');
  }
  const api = createApi(process.env.GITHUB_TOKEN, process.env.GITHUB_REPOSITORY);
  const { action } = await inspectRelease(api, identity, sha);
  if (process.argv[2] === 'prepare') {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `publish=${action !== 'skip'}\nversion=${identity.version}\nasset=${identity.asset}\n`,
    );
    console.log(`${identity.tag}: ${action}`);
  } else if (process.argv[2] === 'publish') {
    // Scope notes to this package, not unrelated monorepo releases.
    const previous = git('tag', '--merged', sha, '--list', `${prefix}*`, '--sort=-version:refname')
      .split('\n')
      .find((tag) => tag !== identity.tag && /^markdown-comment-v\d+\.\d+\.\d+$/.test(tag));
    const range = previous ? `${previous}..${sha}` : sha;
    const changes = git('log', '--format=- %s (%h)', range, '--', packagePath);
    const notes = `## 更新内容\n\n${changes || '- 构建并发布当前版本。'}\n\n## 安装\n\n下载 ${identity.asset}，在 VS Code 中使用“从 VSIX 安装”。`;
    console.log(
      await publishRelease(api, identity, sha, readFileSync(`release-assets/${identity.asset}`), notes),
    );
  } else {
    throw new Error('Usage: node scripts/markdown-comment-release.mjs prepare|publish');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
