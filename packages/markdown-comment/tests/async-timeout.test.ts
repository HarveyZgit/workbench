import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withTimeout } from '../src/async-timeout.ts';

test('withTimeout returns undefined when the promise never resolves', async () => {
  const hanging = new Promise<string>(() => {
    /* never settles — Trae openTextDocument after tab replace */
  });
  const started = Date.now();
  const result = await withTimeout(hanging, 40);
  assert.equal(result, undefined);
  assert.ok(Date.now() - started < 400, 'must not wait forever on hanging openTextDocument');
});

test('withTimeout returns undefined when the promise rejects', async () => {
  const result = await withTimeout(Promise.reject(new Error('fs failed')), 200);
  assert.equal(result, undefined);
});

test('withTimeout returns the value when it resolves in time', async () => {
  const result = await withTimeout(Promise.resolve('ok'), 200);
  assert.equal(result, 'ok');
});
