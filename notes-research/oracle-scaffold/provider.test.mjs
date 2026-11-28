import test from 'node:test';
import assert from 'node:assert/strict';
import { assign, Unavailable } from './provider.mjs';

test('역할 배정은 서비스 실행 불가에서만 바뀐다', () => {
  for (const [primary, alternate] of [['codex','claude'],['claude','codex']]) {
    const result = assign(primary, name => {
      if (name === primary) throw new Unavailable('service');
      return { verdict:'REJECT' };
    });
    assert.equal(result.provider, alternate);
    assert.equal(result.fallback, 'service');
    assert.equal(result.response.verdict,'REJECT');
    let calls = 0;
    assert.throws(() => assign(primary, () => { calls++; throw new SyntaxError('bad json'); }), SyntaxError);
    assert.equal(calls, 1);
    assert.equal(assign(primary, () => ({verdict:'REJECT'})).provider, primary);
    assert.throws(() => assign(primary, () => { throw new Unavailable('both'); }), Unavailable);
  }
});
