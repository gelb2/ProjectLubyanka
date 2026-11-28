import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCandidate } from './npm-candidate.mjs';

test('only the latest maintainer approval for these exact bytes is effective', () => {
  const pass = { context: 'release/installed-candidate', creator: { id: 42 }, description: 'sha512-first', state: 'success' };
  const check = rows => checkCandidate(rows, 'sha512-first', 42);
  check([pass]);
  for (const change of [{ creator: { id: 7 } }, { description: 'sha512-other' }, { state: 'pending' }, { state: 'failure' }]) {
    assert.throws(() => check([{ ...pass, ...change }, pass]));
  }
  assert.throws(() => check([]));
  assert.throws(() => check([{ ...pass, context: 'another-test' }]));
});
