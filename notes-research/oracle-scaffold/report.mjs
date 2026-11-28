import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { rulesForPhase } from './engine.mjs';
import { command, git, gitText, runLab } from './lab.mjs';
import { readRegularFile, resolveDocument } from './lifecycle.mjs';
import { configName, hasText, hash, json, projectOracle } from './project.mjs';

const kinds = new Set([
  'source', 'reference-source', 'screenshot', 'motion', 'interaction', 'delivery',
  'skill-run', 'inventory', 'artifact', 'recovery', 'measurement',
]);
const namePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const maxAttachments = 14 * 1024 * 1024;

function reportCases(manifest, phase) {
  return rulesForPhase(manifest, phase).flatMap(rule => {
    const entries = Object.entries(rule.reportCases ?? {});
    if (!entries.length || Array.isArray(rule.reportCases) ||
        entries.some(([name, required]) => !namePattern.test(name) || !Array.isArray(required) ||
          !required.length || new Set(required).size !== required.length || !required.every(kind => kinds.has(kind)))) {
      throw new Error(`${rule.requirementId}의 reportCases에 반드시 검사할 동선·조건과 증거 종류를 지정하세요.`);
    }
    return entries.map(([name, required]) => ({ id: rule.requirementId, name, required }));
  });
}

export function reportPolicy(root, docs, baseline, phase) {
  const baselineConfig = json(git(root, ['show', `${baseline}:${configName}`]), configName);
  const verifier = baselineConfig.reportReview;
  if (!Array.isArray(verifier) || !verifier.length || !verifier.every(hasText) ||
      !isDeepStrictEqual(verifier, docs.config.reportReview) || baselineConfig.image !== docs.config.image) {
    throw new Error('통합 브랜치에 독립 종료 검토 명령을 먼저 등록하세요. 후보에서 검토기를 교체할 수 없습니다.');
  }
  const checks = docs.config.checks?.[phase];
  if (!Array.isArray(checks) ||
      !baselineConfig.checks?.[phase]?.every(args => checks.some(candidate => isDeepStrictEqual(args, candidate)))) {
    throw new Error(`통합 기준의 시험 명령을 후보에서 누락할 수 없습니다 · ${phase}`);
  }
  const checkSources = baselineConfig.checkSources ?? [];
  if (!Array.isArray(checkSources) || !checkSources.every(hasText) ||
      !isDeepStrictEqual(checkSources, docs.config.checkSources ?? [])) {
    throw new Error('후보에서 통합 기준의 독립 시험 소스 목록을 바꿀 수 없습니다.');
  }
  if (docs.config.selfCritiqueFollowup !== baselineConfig.selfCritiqueFollowup ||
      (docs.config.selfCritiqueFollowup !== undefined && !checkSources.includes(docs.config.selfCritiqueFollowup))) {
    throw new Error('통합 기준의 종료 확장 모듈과 검사 소스를 등록하세요.');
  }
  if (baselineConfig.oracleProfile !== docs.config.oracleProfile) throw new Error('후보에서 실행 정답 범위를 교체할 수 없습니다.');
  const baselineManifest = projectOracle(json(git(root, ['show', `${baseline}:${baselineConfig.oracle}`]), '통합 브랜치 정답지'), baselineConfig.oracleProfile);
  const cases = reportCases(docs.manifest, phase);
  for (const previous of reportCases(baselineManifest, phase)) {
    const current = cases.find(item => item.id === previous.id && item.name === previous.name);
    if (!current || !previous.required.every(kind => current.required.includes(kind))) {
      throw new Error(`통합 기준의 요구·증거를 후보에서 누락할 수 없습니다 · ${previous.id}/${previous.name}`);
    }
  }
  return { verifier, cases, checkSources };
}

function source(root, tree, path) {
  const entry = gitText(root, ['ls-tree', tree, '--', `:(literal)${path}`]);
  if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(entry)) {
    throw new Error(`후보 트리의 일반 소스 파일을 지정하세요 · ${path}`);
  }
  return git(root, ['show', `${tree}:${path}`]);
}

export function checkHarness(root, docs, baseline, phase, tree) {
  const { checkSources } = reportPolicy(root, docs, baseline, phase);
  for (const path of checkSources) {
    if (!source(root, baseline, path).equals(source(root, tree, path))) {
      throw new Error(`후보에서 등록된 독립 시험 소스를 바꿀 수 없습니다 · ${path}`);
    }
  }
}

export async function checkFinishExtension(root, directory, docs, state, review, phase, tree) {
  const entry = docs.config.selfCritiqueFollowup;
  if (entry === undefined) return undefined;
  const { checkSources } = reportPolicy(root, docs, state.baseline, phase);
  for (const path of checkSources) {
    const content = source(root, tree, path);
    await attachment(root, tree, { kind: 'source', path, sha256: hash(content) });
  }
  const module = await resolveDocument(root, entry);
  const { requireFollowup } = await import(pathToFileURL(module.path).href);
  if (typeof requireFollowup !== 'function') throw new Error('종료 확장에 requireFollowup 함수가 필요합니다.');
  return requireFollowup(root, state, review, docs, directory);
}

async function attachment(root, tree, item) {
  if (!kinds.has(item?.kind) || !/^[a-f0-9]{64}$/.test(item?.sha256 ?? '') ||
      !hasText(item.path) || item.path.split('/').some(part => ['.git', 'node_modules'].includes(part))) {
    throw new Error('근거마다 종류, 저장소 내부 경로와 기록 당시 SHA-256이 필요합니다.');
  }
  const file = await resolveDocument(root, item.path);
  if (file.name !== item.path) throw new Error(`증거 경로가 바뀌었습니다 · ${item.path}`);
  const { content } = await readRegularFile(file.path, item.path);
  if (!content.length || hash(content) !== item.sha256 ||
      (item.kind === 'source' && !content.equals(source(root, tree, item.path)))) {
    throw new Error(`최종 후보에서 증거가 비어 있거나 바뀌었습니다 · ${item.path}`);
  }
  return content;
}

export async function verifyReport(root, docs, state, review, receipt, { failed = false, manual = false } = {}) {
  const { phase, tree, image, verdict } = receipt;
  const baseline = state.baseline;
  const policy = reportPolicy(root, docs, baseline, phase);
  const rules = rulesForPhase(docs.manifest, phase);
  const ids = new Set(rules.filter(rule => !manual || rule.comparator === 'manual').map(rule => rule.requirementId));
  const cases = policy.cases.filter(item => ids.has(item.id));
  const claims = review.claims;
  if (!cases.length || !isDeepStrictEqual(review.target, { task: state.task, phase, tree }) ||
      !Array.isArray(claims) || claims.length !== cases.length) {
    throw new Error('현재 작업·단계·후보 지문과 정답지 전체의 종료 주장이 필요합니다.');
  }
  const validated = [];
  const files = new Map();
  let size = 0;
  for (const { id, name, required } of cases) {
    const matches = claims.filter(item => item?.id === id && item.case === name);
    const claim = matches[0];
    if (matches.length !== 1 || ![claim?.statement, claim?.target].every(hasText) ||
        !Array.isArray(claim.evidence) || !claim.evidence.length ||
        (failed ? !['verified', 'failed', 'blocked'].includes(claim.outcome) : claim.outcome !== 'verified')) {
      throw new Error(`현재 후보의 주장·대상·판정·원본 증거가 필요합니다 · ${id}/${name}`);
    }
    if (!required.every(kind => claim.evidence.some(item => item?.kind === kind))) {
      throw new Error(`이 주장을 입증하는 증거 종류가 빠졌습니다 · ${id}/${name}`);
    }
    const paths = new Set();
    for (const item of claim.evidence) {
      if (paths.has(item?.path)) throw new Error(`한 파일로 이 사례의 여러 종류를 대신할 수 없습니다 · ${id}/${name}`);
      const content = await attachment(root, tree, item);
      paths.add(item.path);
      const existing = files.get(item.path);
      if (existing && (existing.kind !== item.kind || existing.sha256 !== item.sha256)) {
        throw new Error(`같은 파일을 서로 다른 근거 종류나 판본으로 쓰고 있습니다 · ${item.path}`);
      }
      if (!existing) {
        size += content.length;
        if (size > maxAttachments) throw new Error('종료 검토 증거 원본이 14 MiB를 넘습니다.');
        files.set(item.path, { ...item, content });
      }
    }
    validated.push(claim);
  }
  const recovery = review.recovery;
  if (failed && (claims.every(claim => claim.outcome === 'verified') || !hasText(recovery?.blocker))) {
    throw new Error('실패 보고는 미충족 조건과 실제로 진행을 막는 제약을 기록해야 합니다.');
  }
  if (!manual && (failed || state.recoveryRequired || review.selfCritique?.status === 'updated')) {
    if (![recovery?.reason, recovery?.technicalCause, recovery?.action].every(hasText) ||
        recovery.reason.trim() === recovery.technicalCause.trim() ||
        review.selfCritique?.status !== 'updated' ||
        ![recovery.reason, recovery.technicalCause].every(value => docs.critique[0].content.includes(value.trim())) ||
        !claims.some(claim => claim.evidence.some(item => item.kind === 'recovery'))) {
      throw new Error('자아비판문에 이유와 기술 원인을 기록하고 직접 실행한 교정·재시험 또는 제약 증거를 연결하세요.');
    }
    if (!failed && state.kind === 'development' &&
        (!hasText(recovery.path) || Object.hasOwn(docs.hashes, recovery.path) ||
          !claims.some(claim => claim.evidence.some(item => item.kind === 'source' && item.path === recovery.path)) ||
          command('git', ['diff', '--quiet', state.head, tree, '--', `:(literal)${recovery.path}`], root).status !== 1)) {
      throw new Error('교정 후 정본과 별개의 실제 변경 소스를 현재 후보에서 다시 검사하세요.');
    }
  }
  const reportInput = {
    mode: manual ? 'manual' : 'finish', task: state.task, instruction: state.instruction, phase, tree, failed, verdict,
    rules, claims: validated, recovery,
    files: Object.fromEntries([...files].map(([path, file]) => [path, file.content.toString('base64')])),
  };
  const result = runLab(root, baseline, image, policy.verifier, undefined, { reportInput });
  if (result.exitCode !== 0) throw new Error('독립 종료 검토 실패 · ' + result.exitCode + ' · ' + result.stderr.trim().slice(-800));
  const decisions = json(result.stdout, '독립 종료 검토 결과');
  if (!Array.isArray(decisions) || decisions.length !== cases.length || cases.some(({ id, name }) => {
    const matches = decisions.filter(item => item?.id === id && item.case === name);
    return matches.length !== 1 || matches[0].accepted !== true || !hasText(matches[0].reason);
  })) {
    throw new Error('독립 검토가 실제 결과, 범위 또는 근거를 승인하지 않았습니다.');
  }
  for (const file of files.values()) await attachment(root, tree, file);
  return { claims: validated, decisions, recovery, verifierCommit: baseline };
}
