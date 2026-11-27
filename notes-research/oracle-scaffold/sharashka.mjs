import { isDeepStrictEqual } from 'node:util';
import { git, runLab } from './lab.mjs';
import { readRegularFile } from './lifecycle.mjs';
import { configName, hasText, json } from './project.mjs';

const modes = new Set(['normal', 'opened', 'denied', 'boundary', 'failure', 'recovery', 'parallel', 'layout', 'performance', 'memory']);
const key = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;

export function registeredDocument(root, docs, baseline, field) {
  const config = json(git(root, ['show', `${baseline}:${configName}`]), configName);
  const path = config[field];
  if (docs.config[field] !== path) throw new Error(`통합 기준에 등록한 검증 범위를 후보에서 바꿀 수 없습니다 · ${field}`);
  if (path === undefined) return null;
  if (!hasText(path)) throw new Error(`검증 문서 경로가 필요합니다 · ${field}`);
  const bytes = git(root, ['show', `${baseline}:${path}`]);
  return { path, bytes, config, value: json(bytes, path) };
}

function contracts(matrix) {
  if (matrix?.version !== 1 || !Array.isArray(matrix.scenarios) || matrix.scenarios.length === 0) {
    throw new Error('샤라시카 원장에는 실행할 시나리오가 있어야 합니다.');
  }
  const expected = new Map();
  for (const item of matrix.scenarios) {
    const { id, mode, target, input, assertions } = item;
    if (!key.test(id ?? '') || expected.has(id) || !modes.has(mode) || !hasText(target) || !hasText(input) ||
        !Array.isArray(assertions) || assertions.length === 0) throw new Error(`시나리오 계약 오류 · ${id}`);
    const keys = new Set();
    for (const check of assertions) {
      if (!key.test(check.metric ?? '') || keys.has(check.metric) ||
          !['eq', 'gte', 'lte'].includes(check.operator) || !Object.hasOwn(check, 'expected') ||
          (check.operator !== 'eq' && !Number.isFinite(check.expected))) {
        throw new Error(`시나리오 관측 기준 오류 · ${id}/${check.metric}`);
      }
      keys.add(check.metric);
    }
    expected.set(id, item);
  }
  return expected;
}

export function judgeScenarios(matrix, run, target) {
  const expected = contracts(matrix);
  if (!isDeepStrictEqual(run?.target, target) || !Array.isArray(run?.observations)) {
    throw new Error('현재 작업·단계·Git 후보에 해당하는 시나리오 원본이 필요합니다.');
  }
  const rows = new Map();
  for (const row of run.observations) {
    if (!expected.has(row?.id) || rows.has(row.id)) throw new Error(`원장에 없거나 중복된 시나리오 · ${row?.id}`);
    rows.set(row.id, row);
  }
  const results = Array.from(expected, ([id, item]) => {
    const row = rows.get(id);
    if (!row || row.blocked !== undefined) {
      if (row && (!hasText(row.blocked) || !hasText(row.attempt))) throw new Error(`제약의 실제 시도를 기록하세요 · ${id}`);
      return { id, status: 'pending', reason: row?.blocked ?? '실행 관측 누락', attempt: row?.attempt };
    }
    if (row.mode !== item.mode || row.target !== item.target || !hasText(row.entry) ||
        !Array.isArray(row.actions) || !row.actions.length || !row.actions.every(hasText) ||
        !hasText(row.result) || !row.measurements || typeof row.measurements !== 'object' || Array.isArray(row.measurements)) {
      return { id, status: 'fail', reason: '실제 환경·진입·조작·결과·관측 기록 누락' };
    }
    const checks = item.assertions.map(({ metric, operator, expected }) => {
      const actual = row.measurements[metric];
      const equal = operator === 'eq' ? isDeepStrictEqual(actual, expected) :
        Number.isFinite(actual) && (operator === 'gte' ? actual >= expected : actual <= expected);
      return { metric, operator, expected, actual, ok: Object.hasOwn(row.measurements, metric) && equal };
    });
    return { id, status: checks.every(check => check.ok) ? 'pass' : 'fail', checks };
  });
  return {
    status: results.some(row => row.status === 'fail') ? 'fail' :
      results.some(row => row.status === 'pending') ? 'pending' : 'pass',
    results, observations: Array.from(rows.values()),
  };
}

export function scenarioContract(root, docs, state, tree) {
  const contract = registeredDocument(root, docs, state.baseline, 'scenarioInventory');
  if (!contract) return null;
  if (!contract.bytes.equals(git(root, ['show', `${tree}:${contract.path}`]))) {
    throw new Error('후보에서 샤라시카 시나리오 원장을 바꿀 수 없습니다.');
  }
  contracts(contract.value);
  return contract.value;
}

export async function executeScenarioGate(root, docs, state, phase, tree, image, file) {
  const matrix = scenarioContract(root, docs, state, tree);
  if (!matrix && !file) return undefined;
  if (!matrix) throw new Error('통합 브랜치에 시나리오 원장을 먼저 등록하세요.');
  if (phase === 'plan' && !file) return { status: 'planned', cases: matrix.scenarios.map(row => row.id) };
  if (!file) throw new Error('실제 시나리오 검증 원본을 --scenario-file로 제공하세요.');
  const { content } = await readRegularFile(file, '샤라시카 원본');
  const run = json(content, '샤라시카 원본');
  const verdict = judgeScenarios(matrix, run, { task: state.task, phase, tree });
  const config = json(git(root, ['show', `${state.baseline}:${configName}`]), configName);
  if (!Array.isArray(config.scenarioReview) || !config.scenarioReview.length || !config.scenarioReview.every(hasText) ||
      !isDeepStrictEqual(config.scenarioReview, docs.config.scenarioReview)) {
    throw new Error('통합 브랜치에 실제 시나리오 원본의 독립 검토기를 연결하세요.');
  }
  const result = runLab(root, state.baseline, image, config.scenarioReview, undefined, {reportInput: {matrix, run}});
  if (result.exitCode !== 0) throw new Error('독립 시나리오 검토 명령이 실패했습니다.');
  const review = json(result.stdout, '독립 시나리오 검토 결과');
  if (review?.accepted !== true || !Array.isArray(review.reasons) || !review.reasons.length || !review.reasons.every(hasText)) {
    throw new Error(`시나리오 원본과 보고한 관측이 일치하지 않습니다 · ${review?.reasons?.join(', ') ?? '근거 없음'}`);
  }
  return { ...verdict, review };
}
