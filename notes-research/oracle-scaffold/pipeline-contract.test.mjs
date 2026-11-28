import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGost, validateScope, validateVerdict } from './pipeline-contract.mjs';

const gost = { version: 1, method_locks: ['기준 보존'], forbidden_shortcuts: [],
  protected_paths: ['tests/reference.json'], visual_tokens: {} };
const scope = { write: ['src/a.js'], read: [], snapshots: [], intentional_constraints: [] };

test('공통 계약은 상위 보호 규칙을 완화하거나 판정 근거를 생략할 수 없다', () => {
  assert.equal(validateGost(gost), gost);
  assert.equal(validateScope(scope, gost), scope);
  for (const path of ['tests', 'Tests/reference.json', 'tests/reference.json/x', '../out', '.Git/HEAD']) {
    assert.throws(() => validateScope({ ...scope, write: [path] }, gost));
  }
  assert.throws(() => validateScope({ ...scope, protected_paths: [] }, gost));
  assert.throws(() => validateGost({ ...gost, version: 2 }));
  const pass = { verdict: 'PASS', category: 'NONE', evidence: 'src/a.js:1' };
  assert.equal(validateVerdict(pass), pass);
  for (const change of [{ evidence: '' }, { category: 'CHEAT' }, { verdict: 'REJECT' }]) {
    assert.throws(() => validateVerdict({ ...pass, ...change }));
  }
});
