import { isDeepStrictEqual } from 'node:util';

const comparators = ['exact', 'range', 'invariant', 'relation', 'manual'];
const requiredText = ['requirementId', 'source', 'scope', 'inputs', 'expectedOrRule'];

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTextList(value) {
  return Array.isArray(value) && value.every(nonEmptyText);
}

export function findUnresolved(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.requirements)) {
    throw new Error('schemaVersion은 1, requirements는 배열이어야 합니다.');
  }
  if (manifest.requirements.length === 0) return ['요구 항목이 없습니다.'];

  const issues = [];
  const ids = new Set();
  for (const [index, rule] of manifest.requirements.entries()) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`${index + 1}번째 요구 항목은 객체여야 합니다.`);
    }
    const id = nonEmptyText(rule.requirementId) ? rule.requirementId.trim() : null;
    const label = id ?? `${index + 1}번째 항목`;
    if (id !== null && ids.has(id)) throw new Error(`중복 요구 ID ${id}`);
    if (id !== null) ids.add(id);

    const missing = requiredText.filter(field => !nonEmptyText(rule[field]));
    if (!comparators.includes(rule.comparator)) missing.push('comparator');
    if (!isTextList(rule.requiredEvidence) || rule.requiredEvidence.length === 0) {
      missing.push('requiredEvidence');
    }
    if (!isTextList(rule.unresolved)) {
      throw new Error(`${label}의 unresolved는 빈 문자열이 없는 배열이어야 합니다.`);
    }
    if (rule.baseline !== undefined && typeof rule.baseline !== 'string') {
      throw new Error(`${label}의 baseline은 문자열이어야 합니다.`);
    }
    if (missing.length > 0) issues.push(`${label} 필수 항목 미기입 또는 미지원 ${missing.join(', ')}`);
    if (rule.unresolved.length > 0) {
      issues.push(`${label} 해결할 항목 ${rule.unresolved.length}개`);
    }
  }
  return issues;
}

export const phases = ['plan', 'feature', 'merge'];

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validateAssertion(rule) {
  const { assertion, comparator, requirementId: id } = rule;
  const object = assertion !== null && typeof assertion === 'object' && !Array.isArray(assertion);
  const bounds = object && [assertion.min, assertion.max].some(Number.isFinite) &&
    [assertion.min, assertion.max].every(value => value === undefined || Number.isFinite(value)) &&
    (assertion.min ?? -Infinity) <= (assertion.max ?? Infinity);
  const valid = comparator === 'invariant' || comparator === 'manual' ||
    (comparator === 'exact' && object && hasOwn(assertion, 'expected')) ||
    (comparator === 'range' && bounds) ||
    (comparator === 'relation' && object && ['eq', 'lte', 'gte', 'lt', 'gt'].includes(assertion.operator));
  if (!valid) throw new Error(`${id} 실행 가능한 판정 규칙이 필요합니다.`);
}

export function rulesForPhase(manifest, phase) {
  if (!phases.includes(phase)) throw new Error('시험 단계는 plan, feature, merge 중 하나여야 합니다.');
  const unresolved = findUnresolved(manifest);
  if (unresolved.length > 0) throw new Error(unresolved.join('\n'));

  const seen = new Set();
  const selected = [];
  for (const rule of manifest.requirements) {
    const id = rule.requirementId;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(id) || seen.has(id)) {
      throw new Error(`실행에 사용할 요구 ID가 유효하지 않습니다 · ${id}`);
    }
    seen.add(id);
    const applies = rule.phases ?? ['feature', 'merge'];
    if (!Array.isArray(applies) || applies.length === 0 || !applies.every(p => phases.includes(p)) ||
        new Set(applies).size !== applies.length) throw new Error(`${id}의 phases가 유효하지 않습니다.`);
    if (!applies.includes(phase)) continue;
    validateAssertion(rule);
    selected.push(rule);
  }
  if (selected.length === 0) throw new Error(`${phase} 단계에 연결한 요구가 없습니다.`);
  return selected;
}

function holds(rule, actual) {
  const { comparator, assertion } = rule;
  switch (comparator) {
    case 'exact':
      return isDeepStrictEqual(actual, assertion.expected);
    case 'range':
      return Number.isFinite(actual) && (assertion.min ?? -Infinity) <= actual && actual <= (assertion.max ?? Infinity);
    case 'invariant':
      return actual === true;
    case 'relation': {
      if (!Array.isArray(actual) || actual.length !== 2) return false;
      const [left, right] = actual;
      if (assertion.operator === 'eq') return isDeepStrictEqual(left, right);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      switch (assertion.operator) {
        case 'lte': return left <= right;
        case 'gte': return left >= right;
        case 'lt': return left < right;
        case 'gt': return left > right;
      }
    }
  }
  return false;
}

export function evaluateOracle(manifest, phase, observations) {
  if (!observations || typeof observations !== 'object' || Array.isArray(observations)) {
    throw new Error('실측은 요구 ID를 키로 가진 JSON 객체여야 합니다.');
  }
  const rules = rulesForPhase(manifest, phase);
  const expectedIds = new Set(rules.map(rule => rule.requirementId));
  const unexpected = Object.keys(observations).filter(id => !expectedIds.has(id));
  if (unexpected.length > 0) throw new Error(`이번 단계에 등록하지 않은 실측 · ${unexpected.join(', ')}`);

  const results = rules.map(rule => {
    const id = rule.requirementId;
    if (rule.comparator === 'manual') return { id, status: 'pending', reason: '사람의 판정이 필요합니다.' };
    if (!hasOwn(observations, id)) return { id, status: 'pending', reason: '실제 관측이 없습니다.' };
    return { id, status: holds(rule, observations[id]) ? 'pass' : 'fail', observed: observations[id] };
  });
  const status = results.some(result => result.status === 'fail') ? 'fail' :
    results.some(result => result.status === 'pending') ? 'pending' : 'pass';
  return { phase, status, results };
}
