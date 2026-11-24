import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateOracle } from './engine.mjs';

const rule = (id, comparator, assertion) => ({
  requirementId: id, source: '사용자 계약', scope: '시험 범위', inputs: '정해진 입력',
  expectedOrRule: '정해진 판정', requiredEvidence: ['실제 관측'], unresolved: [], comparator, assertion,
});
const manifest = { schemaVersion: 1, requirements: [
  rule('EXACT', 'exact', { expected: { output: 2 } }),
  rule('RANGE', 'range', { min: 0, max: 2 }),
  rule('INV', 'invariant'),
  rule('REL', 'relation', { operator: 'lte' }),
] };
const valid = { EXACT: { output: 2 }, RANGE: 2, INV: true, REL: [1, 2] };

test('정답지는 정확값·범위·불변식·관계를 실제 관측으로 판정한다', () => {
  assert.equal(evaluateOracle(manifest, 'feature', valid).status, 'pass');
  for (const [id, value] of [['EXACT', { output: '2' }], ['RANGE', 3], ['RANGE', '2'], ['INV', 1], ['REL', [2, 1]]]) {
    const report = evaluateOracle(manifest, 'feature', { ...valid, [id]: value });
    assert.equal(report.status, 'fail');
    assert.equal(report.results.find(result => result.id === id).status, 'fail');
  }
});

test('관측 누락과 사람 판정을 미판정으로 남기고 다른 단계 ID는 거부한다', () => {
  const missing = { ...valid };
  delete missing.RANGE;
  assert.equal(evaluateOracle(manifest, 'feature', missing).status, 'pending');
  assert.throws(() => evaluateOracle(manifest, 'feature', { ...valid, TYPO: true }), /등록하지 않은/);
  assert.throws(() => evaluateOracle(manifest, 'plan', {}), /연결한 요구가 없습니다/);
  const manual = { schemaVersion: 1, requirements: [rule('M', 'manual')] };
  assert.equal(evaluateOracle(manual, 'merge', { M: true }).status, 'pending');
});

test('빈 정답지·잘못된 범위·중복 단계·정답지 미해결 사항은 통과하지 않는다', () => {
  for (const entry of [
    rule('R', 'range', { min: 5, max: 1 }),
    rule('E', 'exact', {}),
    { ...rule('I', 'invariant'), phases: ['feature', 'feature'] },
    { ...rule('I', 'invariant'), unresolved: ['미확정 기대값'] },
  ]) assert.throws(() => evaluateOracle({ schemaVersion: 1, requirements: [entry] }, 'feature', { [entry.requirementId]: true }));
  assert.throws(() => evaluateOracle({ schemaVersion: 1, requirements: [] }, 'feature', {}), /요구 항목/);
});

test('관계 연산자는 경계 일치와 순서를 구분한다', () => {
  const cases = [
    ['eq', [{ value: 1 }, { value: 1 }], [1, '1']],
    ['lte', [2, 2], [3, 2]],
    ['gte', [2, 2], [1, 2]],
    ['lt', [1, 2], [2, 2]],
    ['gt', [2, 1], [2, 2]],
  ];
  for (const [operator, passing, failing] of cases) {
    const relational = { schemaVersion: 1, requirements: [rule('R', 'relation', { operator })] };
    assert.equal(evaluateOracle(relational, 'merge', { R: passing }).status, 'pass');
    assert.equal(evaluateOracle(relational, 'merge', { R: failing }).status, 'fail');
  }
});
