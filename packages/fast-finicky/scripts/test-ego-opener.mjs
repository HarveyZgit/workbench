// Run the actual Swift-embedded script against native API mocks. No browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const swift = await readFile(new URL('../Sources/FastFinickyCore/EgoBrowserLauncher.swift', import.meta.url), 'utf8');
const template = swift.match(/return """\n([\s\S]*?)\n        """/)[1];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const input = { url: 'https://example.com/?q=";evil()//&x=$HOME#中文', profileId: 'Profile "1"\n\\中文' };
function script(value = input) { return new AsyncFunction('ego', template.replace('\\(json)', JSON.stringify(value))); }
function fixture(entries = [{ id: 7, name: 'Work', profileId: input.profileId, ownership: 'user' }]) {
  const spaces = structuredClone(entries), calls = [];
  const ego = {
    listTaskSpaces: async () => { calls.push(['list']); return { taskSpaces: structuredClone(spaces) }; },
    claimTaskSpace: async id => { calls.push(['claim', id]); const s = spaces.find(s => s.id === id); s.ownership = 'agent'; return { id }; },
    useTaskSpace: id => { calls.push(['use', id]); return id; },
    createTab: async url => { calls.push(['open', url]); return { targetId: 'new-tab' }; },
    completeTaskSpace: async () => { calls.push(['complete']); return 'completed'; },
    createTaskSpace: () => assert.fail('must not create a Space'),
    closeTaskSpace: () => assert.fail('must not close a Space'),
    takeOverTaskSpace: () => assert.fail('must not take over a task')
  };
  return { ego, spaces, calls };
}
const actions = calls => calls.filter(([op]) => op !== 'list');
test('exact profile, safely encoded URL, existing Space and native completion', async () => {
  const f = fixture(); await script()(f.ego);
  assert.deepEqual(f.calls, [['list'], ['list'], ['claim', 7], ['list'], ['use', 7], ['open', input.url], ['complete']]);
});
test('multiple user Spaces chooses first in API order, not lowest ID', async () => {
  const f = fixture([42, 3].map(id => ({ id, name: 'Space', profileId: input.profileId, ownership: 'user' })));
  await script()(f.ego); assert.equal(actions(f.calls)[0][1], 42);
});
test('agent, delegated, unknown ownership and other profile excluded', async () => {
  const f = fixture([
    ...['agent', 'agentDelegatedToUser', undefined, 'future'].map((ownership, id) => ({ id, profileId: input.profileId, ownership })),
    { id: 5, profileId: 'different', ownership: 'user' },
    { id: 6, name: 'User', profileId: input.profileId, ownership: 'user' }
  ]); await script()(f.ego); assert.equal(actions(f.calls)[0][1], 6);
});
for (const entries of [[], [{ id: 7, profileId: input.profileId, ownership: 'agent' }], [{ id: 7, profileId: 'other', ownership: 'user' }]]) {
  test(`no eligible Space fails without actions: ${JSON.stringify(entries)}`, async () => {
    const f = fixture(entries); await assert.rejects(script()(f.ego), /no existing user-owned/); assert.deepEqual(actions(f.calls), []);
  });
}
test('profile IDs are case-sensitive', async () => {
  const f = fixture([{ id: 7, profileId: 'Profile X', ownership: 'user' }]);
  await assert.rejects(script({ ...input, profileId: 'profile x' })(f.ego), /no existing user-owned/);
});
for (const changed of [{ ownership: 'agent' }, { ownership: 'agentDelegatedToUser' }, { profileId: 'other' }, { name: 'Changed' }]) {
  test(`preclaim change aborts: ${JSON.stringify(changed)}`, async () => {
    const f = fixture(); let count = 0; const list = f.ego.listTaskSpaces;
    f.ego.listTaskSpaces = async () => { if (++count === 2) Object.assign(f.spaces[0], changed); return list(); };
    await assert.rejects(script()(f.ego), /changed before opening/); assert.deepEqual(actions(f.calls), []);
  });
}
test('postclaim user takeover stops before URL or cleanup', async () => {
  const f = fixture(); const claim = f.ego.claimTaskSpace;
  f.ego.claimTaskSpace = async id => { const result = await claim(id); f.spaces[0].ownership = 'user'; return result; };
  await assert.rejects(script()(f.ego), /changed after claiming/); assert.deepEqual(actions(f.calls), [['claim', 7]]);
});
for (const operation of ['listTaskSpaces', 'claimTaskSpace', 'createTab', 'completeTaskSpace']) {
  for (const rejected of [false, true]) {
    test(`${operation} ${rejected ? 'rejection' : 'error object'} stops without retry`, async () => {
      const f = fixture(); let count = 0;
      f.ego[operation] = async () => { count++; const error = { error: 'user control', error_code: 'EGO_TASK_SPACE_USER_IN_CONTROL' }; if (rejected) throw Object.assign(new Error(error.error), error); return error; };
      await assert.rejects(script()(f.ego), error => error.error_code === 'EGO_TASK_SPACE_USER_IN_CONTROL');
      assert.equal(count, 1);
      if (operation !== 'completeTaskSpace') assert.ok(!actions(f.calls).some(([op]) => op === 'complete'));
    });
  }
}
test('invalid listing and locator fail closed', async () => {
  const f = fixture(); f.ego.listTaskSpaces = async () => ({});
  await assert.rejects(script()(f.ego), /invalid listTaskSpaces/);
  const g = fixture([{ id: '7', profileId: input.profileId, ownership: 'user' }]);
  await assert.rejects(script()(g.ego), /invalid numeric ID/); assert.deepEqual(actions(g.calls), []);
});
test('unexpected claim result stops without selection or cleanup', async () => {
  const f = fixture(); f.ego.claimTaskSpace = async () => ({ id: 999 });
  await assert.rejects(script()(f.ego), /unexpected Space/); assert.deepEqual(actions(f.calls), []);
});
test('uncertain createTab result is never retried or completed', async () => {
  const f = fixture(); f.ego.createTab = async () => ({});
  await assert.rejects(script()(f.ego), /outcome uncertain/); assert.ok(!actions(f.calls).some(([op]) => op === 'complete'));
});
test('file URL is forwarded intact, no shell path or page-load wait', async () => {
  const f = fixture(); const file = { ...input, url: 'file:///tmp/a%20b%22%E4%B8%AD%E6%96%87.html' };
  await script(file)(f.ego); assert.ok(f.calls.some(([op, url]) => op === 'open' && url === file.url));
  assert.ok(!template.includes('.goto('));
});
test('Space disappearance before claim does not select a replacement', async () => {
  const f = fixture(); let count = 0; const list = f.ego.listTaskSpaces;
  f.ego.listTaskSpaces = async () => { if (++count === 2) f.spaces.splice(0); return list(); };
  await assert.rejects(script()(f.ego), /changed before opening/); assert.deepEqual(actions(f.calls), []);
});
test('profile change after claim stops without URL opening', async () => {
  const f = fixture(); const claim = f.ego.claimTaskSpace;
  f.ego.claimTaskSpace = async id => { const result = await claim(id); f.spaces[0].profileId = 'other'; return result; };
  await assert.rejects(script()(f.ego), /changed after claiming/); assert.deepEqual(actions(f.calls), [['claim', 7]]);
});
test('selection error stops before opening or completion', async () => {
  const f = fixture(); f.ego.useTaskSpace = () => ({ error: 'not found', error_code: 'EGO_TASK_SPACE_NOT_FOUND' });
  await assert.rejects(script()(f.ego), error => error.error_code === 'EGO_TASK_SPACE_NOT_FOUND');
  assert.deepEqual(actions(f.calls), [['claim', 7]]);
});
test('malformed completion outcome is failure and not retried', async () => {
  const f = fixture(); let count = 0; f.ego.completeTaskSpace = async () => { count++; return undefined; };
  await assert.rejects(script()(f.ego), /completion outcome uncertain/); assert.equal(count, 1);
});

for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, undefined, NaN, Infinity]) {
  test(`invalid Space ID ${String(id)} never claims`, async () => {
    const f = fixture([{ id, profileId: input.profileId, ownership: 'user' }]);
    await assert.rejects(script()(f.ego), /invalid numeric ID/);
    assert.deepEqual(actions(f.calls), []);
  });
}
for (const phase of [2, 3]) {
  for (const response of [null, {}, { taskSpaces: null }, { error: 'lost access' }]) {
    test(`listing fails closed at read ${phase}: ${JSON.stringify(response)}`, async () => {
      const f = fixture(); let count = 0; const list = f.ego.listTaskSpaces;
      f.ego.listTaskSpaces = async () => ++count === phase ? response : list();
      await assert.rejects(script()(f.ego), /invalid listTaskSpaces|lost access/);
      assert.deepEqual(actions(f.calls), phase === 2 ? [] : [['claim', 7]]);
    });
  }
}
for (const changed of [{ ownership: 'agentDelegatedToUser' }, { ownership: 'future' }, { name: 'Renamed' }]) {
  test(`postclaim change never opens or cleans up: ${JSON.stringify(changed)}`, async () => {
    const f = fixture(); const claim = f.ego.claimTaskSpace;
    f.ego.claimTaskSpace = async id => { const result = await claim(id); Object.assign(f.spaces[0], changed); return result; };
    await assert.rejects(script()(f.ego), /changed after claiming/);
    assert.deepEqual(actions(f.calls), [['claim', 7]]);
  });
}
for (const response of [null, {}, { id: '7' }, { id: 8 }]) {
  test(`malformed claim outcome stops: ${JSON.stringify(response)}`, async () => {
    const f = fixture(); let claims = 0;
    f.ego.claimTaskSpace = async () => { claims++; return response; };
    await assert.rejects(script()(f.ego), /unexpected Space/);
    assert.equal(claims, 1); assert.deepEqual(actions(f.calls), []);
  });
}
for (const response of [null, '7', 8, undefined]) {
  test(`wrong selected Space ${String(response)} never opens`, async () => {
    const f = fixture(); f.ego.useTaskSpace = () => response;
    await assert.rejects(script()(f.ego), /could not select/);
    assert.deepEqual(actions(f.calls), [['claim', 7]]);
  });
}
for (const response of [null, { targetId: '' }, { targetId: 7 }]) {
  test(`malformed tab result is not completed: ${JSON.stringify(response)}`, async () => {
    const f = fixture(); let opens = 0;
    f.ego.createTab = async () => { opens++; return response; };
    await assert.rejects(script()(f.ego), /outcome uncertain/);
    assert.equal(opens, 1);
    assert.deepEqual(actions(f.calls), [['claim', 7], ['use', 7]]);
  });
}
test('synchronous selection exception is preserved without cleanup', async () => {
  const f = fixture(); const error = new Error('selection lost');
  f.ego.useTaskSpace = () => { throw error; };
  await assert.rejects(script()(f.ego), thrown => thrown === error);
  assert.deepEqual(actions(f.calls), [['claim', 7]]);
});
test('null and primitive list entries are ignored before eligible Space', async () => {
  const f = fixture([null, 4, 'space', { id: 7, name: 'Work', profileId: input.profileId, ownership: 'user' }]);
  // The native mock's mutation also needs to tolerate malformed unrelated rows.
  f.ego.claimTaskSpace = async id => { f.calls.push(['claim', id]); f.spaces.find(s => s?.id === id).ownership = 'agent'; return { id }; };
  await script()(f.ego);
  assert.deepEqual(actions(f.calls), [['claim', 7], ['use', 7], ['open', input.url], ['complete']]);
});
