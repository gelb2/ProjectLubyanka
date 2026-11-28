import { isDeepStrictEqual } from 'node:util';
import { evaluateOracle, findUnresolved, phases } from './engine.mjs';
import { git, runLab } from './lab.mjs';
import { hasText, json } from './project.mjs';
import { registeredDocument } from './sharashka.mjs';

export function checkMethodWriting(docs, basis) {
  if (basis?.version !== 1 || !Array.isArray(basis.requirements) || !Array.isArray(basis.incidents) ||
      basis.incidents.length === 0) throw new Error('검토 기준에 요구와 자아비판 사례를 기록하세요.');
  const issues = findUnresolved(docs.manifest);
  const rules = new Map(docs.manifest.requirements.map(rule => [rule.requirementId, rule]));
  const recorded = new Set();
  for (const item of basis.requirements) {
    const { id, basis: reference, approved, accept, reject } = item;
    const rule = rules.get(id);
    if (!rule || recorded.has(id) || !hasText(reference)) {
      issues.push(`정답지 출처 또는 중복 ID · ${id}`);
      continue;
    }
    recorded.add(id);
    for (const field of ['source', 'scope', 'inputs', 'expectedOrRule', 'comparator', 'assertion', 'requiredEvidence', 'phases']) {
      if (!isDeepStrictEqual(approved?.[field], rule[field])) issues.push(`독립 기준과 다른 정답지 서술 · ${id}/${field}`);
    }
    if (rule.comparator === 'manual') continue;
    try {
      if (!Object.hasOwn(item, 'accept') || !Object.hasOwn(item, 'reject')) throw new Error('합격값·반례 누락');
      const phase = rule.phases?.[0] ?? phases[1];
      const example = { schemaVersion: 1, requirements: [rule] };
      if (evaluateOracle(example, phase, { [id]: accept }).status !== 'pass' ||
          evaluateOracle(example, phase, { [id]: reject }).status !== 'fail') {
        issues.push(`정답지의 합격 예시 또는 반례를 구별하지 못함 · ${id}`);
      }
    } catch (error) {
      issues.push(`정답지 검산 실패 · ${id} · ${error.message}`);
    }
  }
  for (const id of rules.keys()) if (!recorded.has(id)) issues.push(`근거가 등록되지 않은 요구 · ${id}`);
  for (const incident of basis.incidents) {
    const doc = docs.critique.find(item => item.path === incident.path);
    const fields = ['reason', 'technicalCause', 'correction', 'verification'];
    const values = fields.map(field => incident[field]);
    if (!rules.has(incident.requirement) || !doc || new Set(values).size !== fields.length ||
        !values.every(value => hasText(value) && doc.content.includes(value.trim()))) {
      issues.push(`자아비판의 이유·기술 원인·교정·재검증 연결 누락 · ${incident.requirement}`);
    }
  }
  return { status: issues.length ? 'fail' : 'pass', issues, requirements: recorded.size, incidents: basis.incidents.length };
}

export function auditMethod(root, docs, baseline, tree, image) {
  const contract = registeredDocument(root, docs, baseline, 'methodAudit');
  if (!contract) return undefined;
  if (!contract.bytes.equals(git(root, ['show', `${tree}:${contract.path}`]))) {
    throw new Error('후보에서 자아비판·정답 검토 기준을 바꿀 수 없습니다.');
  }
  const report = checkMethodWriting(docs, contract.value);
  if (report.status !== 'pass') return report;
  const reviewer = contract.config.methodReview;
  if (!Array.isArray(reviewer) || !reviewer.length || !reviewer.every(hasText) ||
      !isDeepStrictEqual(reviewer, docs.config.methodReview)) {
    throw new Error('통합 브랜치에 자아비판·정답 서술 검토기를 등록하세요.');
  }
  const run = runLab(root, baseline, image, reviewer, undefined, {
    reportInput: { oracle: docs.manifest, critique: docs.critique, contract: docs.contract, basis: contract.value },
  });
  if (run.exitCode !== 0) throw new Error('독립 자아비판·정답 서술 검토 명령 실패 · ' + run.exitCode + ' · ' + run.stderr.trim().slice(-800));
  const review = json(run.stdout, '자아비판·정답 검토 결과');
  if (!Array.isArray(review?.reasons) || !review.reasons.length || !review.reasons.every(hasText) || review.accepted !== true) {
    return { ...report, status: 'fail', issues: review?.reasons ?? ['독립 검토 결과 누락'] };
  }
  return { ...report, review };
}
