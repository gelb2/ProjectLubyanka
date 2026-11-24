import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { evaluateOracle, findUnresolved, phases, rulesForPhase } from './engine.mjs';
import { command, git, gitText, imageId, runLab } from './lab.mjs';
import { requireHooks } from './hooks.mjs';
import { finish as documentReport, resolveDocuments, start } from './lifecycle.mjs';
import { configName, hasText, hash, json, loadState, readProject, save, stateDir, withLock } from './project.mjs';

const procedure = 'LUBYANKA-ORACLE.md';
const reread = '자아비판문 전문을 다시 읽고 begin부터 시작하세요.';

function oracleIssues(name, content) {
  return findUnresolved(json(content, name));
}

function integration(root, docs) {
  return gitText(root, ['rev-parse', '--verify', `refs/heads/${docs.config.integrationBranch}^{commit}`]);
}

function head(root) {
  return gitText(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
}

function treeOf(root, object) {
  return gitText(root, ['rev-parse', '--verify', `${object}^{tree}`]);
}

function parentsOf(root, object) {
  return gitText(root, ['show', '-s', '--format=%P', object]).split(' ');
}

function isTestedMerge(root, receipt, commit) {
  if (treeOf(root, commit) !== receipt.tree) return false;
  if (commit !== receipt.source) return isDeepStrictEqual(parentsOf(root, commit), [receipt.target, receipt.source]);
  return command('git', ['merge-base', '--is-ancestor', receipt.target, commit], root).status === 0;
}

async function current(root, directory) {
  const docs = await readProject(root);
  const state = await loadState(directory);
  if (state.root !== root || !isDeepStrictEqual(state.hashes, docs.hashes) || state.failed) {
    throw new Error(`필수 문서가 바뀌었거나 시험을 통과하지 못했습니다. ${reread}`);
  }
  return { docs, state };
}

export async function begin(root, requestFile, { kind = 'development', resume = false } = {}) {
  if (!['development', 'answer'].includes(kind)) throw new Error('kind는 development 또는 answer여야 합니다.');
  const directory = stateDir(root);
  return withLock(directory, async () => {
    const docs = await readProject(root);
    const instruction = await readFile(requestFile, 'utf8');
    if (!hasText(instruction)) throw new Error('사용자 지시 원문이 필요합니다.');
    const unresolved = findUnresolved(docs.manifest);
    const task = randomUUID();
    let reviewPath = join(directory, `review-${task}.json`);
    let previousFailure;
    if (resume) {
      const prior = await loadState(directory);
      if (prior.instruction !== instruction || prior.kind !== kind || prior.root !== root) {
        throw new Error('이어받을 사용자 지시 또는 작업 종류가 다릅니다.');
      }
      const review = json(await readFile(prior.reviewPath), '작업 검토');
      if (review.before.oracle.name !== docs.oracle.path || review.before.selfCritique.name !== docs.critique[0].path) {
        throw new Error('정답지 또는 자아비판문 경로가 바뀌었습니다. 새 작업으로 시작하세요.');
      }
      reviewPath = prior.reviewPath;
      previousFailure = prior.failed || prior.previousFailure;
    } else {
      const paths = await resolveDocuments(root, docs.config.oracle, docs.config.selfCritique, procedure);
      await start(root, paths, reviewPath, new Set(), oracleIssues, { quiet: true });
    }
    await save(directory, 'task.json', {
      root, task, kind, resumed: resume, instruction, head: head(root), hashes: docs.hashes, reviewPath, receipts: {}, previousFailure,
    });
    return { task, instruction, selfCritique: docs.critique, contract: docs.contract, oracle: docs.oracle, unresolved, reviewPath };
  });
}

export async function plan(root, planFile) {
  const directory = stateDir(root);
  return withLock(directory, async () => {
    const { state, docs } = await current(root, directory);
    if (docs.contract.content.includes('<!-- lubyanka-contract-pending -->')) {
      throw new Error('프로젝트 정본에 사용자 요구와 보존 범위를 기입하고 전문을 다시 읽으세요.');
    }
    for (const phase of state.kind === 'answer' ? ['plan'] : phases) rulesForPhase(docs.manifest, phase);
    const proposal = json(await readFile(planFile), '실행 계획');
    const rules = state.kind === 'answer' ? rulesForPhase(docs.manifest, 'plan') : docs.manifest.requirements;
    const required = new Set(rules.map(rule => rule.requirementId));
    if (!Array.isArray(proposal?.decisions) || !hasText(proposal?.instruction) ||
        proposal.instruction.trim() !== state.instruction.trim()) {
      throw new Error('계획에 현재 사용자 지시 원문과 그에 따른 결정을 작성하세요.');
    }
    for (const decision of proposal.decisions) {
      const doc = docs.critique.find(item => item.path === decision?.path);
      if (!required.delete(decision?.id) || !doc ||
          ![decision?.quote, decision?.decision, decision?.reason, decision?.falsifier].every(hasText) ||
          !doc.content.includes(decision.quote.trim())) {
        throw new Error(`계획의 요구·자아비판 원문·결정·이유·기각 조건을 점검하세요 · ${decision?.id ?? '?'}`);
      }
    }
    if (required.size) throw new Error(`계획에서 빠진 사용자 요구 · ${[...required].join(', ')}`);
    if (head(root) !== state.head) throw new Error(`계획 대상 커밋이 바뀌었습니다. ${reread}`);
    await save(directory, 'task.json', { ...state, plan: proposal, receipts: {} });
    return { status: 'recorded', task: state.task, next: 'verify plan', semanticReview: '기준 커밋에 있는 독립 계획 검토기가 결정과 근거를 대조합니다.' };
  });
}

function confirmTreeDocs(root, tree, hashes) {
  for (const [path, digest] of Object.entries(hashes)) {
    if (hash(git(root, ['show', `${tree}:${path}`])) !== digest) {
      throw new Error(`시험 후보에서 정본이나 정답지가 달라졌습니다 · ${path}`);
    }
  }
}

async function receiptFor(directory, state, phase) {
  const receipt = state.receipts[phase];
  const filename = `evidence-${state.task}-${phase}.json`;
  if (!receipt || receipt.filename !== filename) throw new Error(`${phase} 시험의 통과 기록이 없습니다.`);
  const content = await readFile(join(directory, filename));
  if (hash(content) !== receipt.evidenceHash || json(content, filename).verdict?.status !== 'pass') {
    throw new Error(`${phase} 시험 기록이 바뀌었습니다. 다시 검증하세요.`);
  }
  return receipt;
}

async function featureEvidence(root, directory, state, source) {
  const receipt = await receiptFor(directory, state, 'feature');
  if (receipt.tree !== treeOf(root, source) || !isDeepStrictEqual(parentsOf(root, source), [state.head])) {
    throw new Error('기능 시험을 통과한 커밋이 필요합니다.');
  }
}

async function candidate(root, directory, phase, state, docs, source) {
  if (!state.plan) throw new Error('plan을 완료해야 시험할 수 있습니다.');
  if (phase === 'plan') {
    if (head(root) !== state.head) throw new Error(`계획 대상 커밋이 바뀌었습니다. ${reread}`);
    return { tree: gitText(root, ['write-tree']), parent: state.head };
  }
  if (state.kind === 'answer') throw new Error('질문 응답은 계획 단계에서 실측을 검증하세요.');
  await receiptFor(directory, state, 'plan');
  if (phase === 'feature') {
    if (head(root) !== state.head) throw new Error(`기능 서명을 시작한 커밋이 바뀌었습니다. ${reread}`);
    const branch = gitText(root, ['symbolic-ref', '--short', 'HEAD']);
    if (branch === docs.config.integrationBranch) throw new Error('별도 기능 브랜치에서 시험하세요.');
    return { tree: gitText(root, ['write-tree']), parent: state.head };
  }
  if (!hasText(source) || source.startsWith('-')) throw new Error('병합할 기능 브랜치 또는 커밋을 지정하세요.');
  const target = integration(root, docs);
  const commit = gitText(root, ['rev-parse', '--verify', `${source}^{commit}`]);
  await featureEvidence(root, directory, state, commit);
  return { tree: gitText(root, ['merge-tree', '--write-tree', target, commit]), target, source: commit };
}

export async function verify(root, phase, source) {
  if (!phases.includes(phase)) throw new Error('시험 단계는 plan, feature, merge 중 하나여야 합니다.');
  const directory = stateDir(root);
  return withLock(directory, async () => {
    const { state, docs } = await current(root, directory);
    if (state.kind === 'development') await requireHooks(root, directory);
    const snapshot = await candidate(root, directory, phase, state, docs, source);
    const filename = `evidence-${state.task}-${phase}.json`;
    const evidence = { task: state.task, phase, ...snapshot, checks: [] };
    const observations = Object.create(null);
    try {
      rulesForPhase(docs.manifest, phase);
      const checks = docs.config.checks?.[phase];
      if (!Array.isArray(checks) || checks.length === 0) throw new Error(`${phase} 단계의 시험 명령을 설정하세요.`);
      confirmTreeDocs(root, snapshot.tree, state.hashes);
      evidence.image = imageId(root, docs.config.image);
      if (phase === 'plan') {
        const baseline = treeOf(root, state.head);
        const baselineConfig = json(git(root, ['show', `${baseline}:${configName}`]), configName);
        if (!isDeepStrictEqual(baselineConfig.reviewPlan, docs.config.reviewPlan)) {
          throw new Error('후보에서 독립 계획 검토 명령을 바꿀 수 없습니다.');
        }
        const review = runLab(root, baseline, evidence.image, baselineConfig.reviewPlan, state.plan);
        evidence.planReview = { ...review, tree: baseline };
        if (review.exitCode !== 0) throw new Error('독립 계획 검토 명령이 실패했습니다.');
        const output = json(review.stdout, '독립 계획 검토 결과');
        if (!Array.isArray(output?.reasons) || !output.reasons.length || !output.reasons.every(hasText) ||
            output.accepted !== true) {
          throw new Error('독립 검토가 계획 근거의 90% 기준을 충족하지 못했거나 이유가 없습니다.');
        }
      }
      for (const args of checks) {
        const result = runLab(root, snapshot.tree, evidence.image, args);
        evidence.checks.push(result);
        if (result.exitCode !== 0) throw new Error(`격리 시험 명령 실패 · 종료 코드 ${result.exitCode}`);
        const output = json(result.stdout, '시험 출력');
        if (!output || typeof output !== 'object' || Array.isArray(output)) {
          throw new Error('시험 출력은 요구 ID를 키로 쓰는 JSON 객체여야 합니다.');
        }
        for (const [id, value] of Object.entries(output)) {
          if (Object.hasOwn(observations, id)) throw new Error(`중복 관측 · ${id}`);
          observations[id] = value;
        }
      }
      const latest = await readProject(root);
      if (!isDeepStrictEqual(state.hashes, latest.hashes)) throw new Error('실행 중 정본문서나 정답지가 바뀌었습니다.');
      evidence.verdict = evaluateOracle(docs.manifest, phase, observations);
    } catch (error) {
      evidence.verdict = { status: 'fail', reason: error.message };
    }
    const evidenceHash = await save(directory, filename, evidence);
    if (evidence.verdict.status !== 'pass') {
      await save(directory, 'task.json', { ...state, receipts: {}, failed: { task: state.task, phase, filename, evidenceHash } });
      return { ...evidence.verdict, evidence: join(directory, filename), next: reread };
    }
    const receipts = { ...state.receipts };
    for (const following of phases.slice(phases.indexOf(phase) + 1)) delete receipts[following];
    receipts[phase] = { ...snapshot, filename, evidenceHash };
    const previousFailure = state.previousFailure?.phase === phase ? undefined : state.previousFailure;
    await save(directory, 'task.json', { ...state, receipts, previousFailure });
    return { ...evidence.verdict, evidence: join(directory, filename), tree: snapshot.tree };
  });
}

export async function permit(root, task) {
  const directory = stateDir(root);
  const { state } = await current(root, directory);
  if (state.kind === 'development') await requireHooks(root, directory);
  if (state.task !== task || head(root) !== state.head) throw new Error(`현재 요청의 계획 통과 기록이 필요합니다. ${reread}`);
  await receiptFor(directory, state, 'plan');
  return { status: 'permitted', task };
}

export async function guardCommit(root, protectedBranch) {
  const directory = stateDir(root);
  const { docs, state } = await current(root, directory);
  const branch = gitText(root, ['symbolic-ref', '--short', 'HEAD']);
  if (protectedBranch !== docs.config.integrationBranch) throw new Error('설치된 훅과 통합 브랜치 설정이 다릅니다.');
  if (branch === protectedBranch) throw new Error('통합 브랜치는 검증한 후보를 병합해 갱신하세요.');
  const receipt = await receiptFor(directory, state, 'feature');
  if (receipt.parent !== head(root) || receipt.tree !== gitText(root, ['write-tree'])) {
    throw new Error('현재 스테이징 내용의 샤라시카 기능 시험 통과 기록이 필요합니다.');
  }
}

export async function guardReferences(root, protectedBranch, text) {
  const ref = `refs/heads/${protectedBranch}`;
  for (const line of text.split('\n')) {
    const [previous, next, name] = line.split(' ');
    if (!name?.startsWith('refs/heads/')) continue;
    const target = name === ref;
    if (/^0+$/.test(next) || !/^[a-f0-9]+$/.test(next)) {
      if (target) throw new Error('통합 브랜치 삭제·대상 변경은 이 작업에서 허용되지 않습니다. 샤라시카로 병합을 검증하세요.');
      continue;
    }
    if (previous === next) continue;
    const existing = /^0+$/.test(previous) ? command('git', ['rev-parse', '--verify', name], root) : null;
    if (existing && existing.status !== 0 && !target) {
      if (next === head(root)) continue;
      const listed = gitText(root, ['for-each-ref', '--format=%(objectname)', 'refs/heads', 'refs/remotes']).split('\n');
      if (listed.includes(next)) continue;
    }
    const old = existing ? existing.stdout.toString().trim() : previous;
    const directory = stateDir(root);
    const { state, docs } = await current(root, directory);
    if (protectedBranch !== docs.config.integrationBranch) throw new Error('설치된 훅과 통합 브랜치 설정이 다릅니다.');
    if (!target) {
      const receipt = await receiptFor(directory, state, 'feature');
      if (receipt.parent !== old || receipt.tree !== treeOf(root, next) ||
          !isDeepStrictEqual(parentsOf(root, next), [old])) {
        throw new Error('기능 브랜치 갱신 전에 정확한 후보를 샤라시카로 검증하세요.');
      }
      continue;
    }
    const receipt = await receiptFor(directory, state, 'merge');
    if (receipt.target !== old || !isTestedMerge(root, receipt, next)) {
      throw new Error('최신 통합 브랜치와 병합 후보를 함께 샤라시카로 검증하세요.');
    }
  }
}

async function failureReport(directory, state) {
  const failure = state.previousFailure;
  if (!failure || failure.filename !== `evidence-${failure.task}-${failure.phase}.json`) {
    throw new Error('실행된 실패 시험과 전문 재독 기록이 필요합니다.');
  }
  const path = join(directory, failure.filename);
  const bytes = await readFile(path);
  if (hash(bytes) !== failure.evidenceHash) throw new Error('실패 시험 기록이 바뀌었습니다.');
  const evidence = json(bytes, failure.filename);
  const ran = [...evidence.checks, evidence.planReview].some(item =>
    Number.isInteger(item?.exitCode) && item.exitCode >= 0 && item.exitCode < 125);
  if (!ran || !['fail', 'pending'].includes(evidence.verdict?.status)) throw new Error('실제 시험 실패가 관측되지 않았습니다.');
  return { stage: failure.phase, status: evidence.verdict.status, previousTask: failure.task, tree: evidence.tree, sharashka: path };
}

export async function finish(root, stage) {
  const directory = stateDir(root);
  return withLock(directory, async () => {
    const { docs, state } = await current(root, directory);
    if (state.kind === 'development') await requireHooks(root, directory);
    const review = json(await readFile(state.reviewPath), '작업 검토');
    if (!hasText(review.review?.instruction) || review.review.instruction.trim() !== state.instruction.trim()) {
      throw new Error('종료 기록은 현재 사용자 지시 원문과 일치해야 합니다.');
    }
    if (stage === 'failure') {
      return documentReport(root, state.reviewPath, true, procedure, oracleIssues, await failureReport(directory, state));
    }
    if (review.review?.codeReview?.result === 'no-fix-found' && !state.resumed) {
      throw new Error('고칠 코드가 없어 보이면 begin --resume으로 전문을 다시 읽고 재검증하세요.');
    }
    const allowed = state.kind === 'answer' ? ['plan'] : ['feature', 'merge'];
    if (!allowed.includes(stage)) throw new Error('작업 종류에 해당하는 완료 보고 단계를 지정하세요.');
    const result = await receiptFor(directory, state, stage);
    if (stage === 'plan' && (head(root) !== result.parent || gitText(root, ['write-tree']) !== result.tree)) {
      throw new Error('답변에서 검증한 후보가 바뀌었습니다.');
    }
    if (stage === 'feature' && (result.tree !== gitText(root, ['write-tree']) ||
        (head(root) !== result.parent && treeOf(root, head(root)) !== result.tree))) {
      throw new Error('보고 대상의 기능 후보가 바뀌었습니다.');
    }
    if (stage === 'merge') {
      const actual = integration(root, docs);
      if (!isTestedMerge(root, result, actual)) {
        throw new Error('시험한 병합 후보를 통합 브랜치에서 확인할 수 없습니다.');
      }
    }
    await documentReport(root, state.reviewPath, true, procedure, oracleIssues, {
      stage, tree: result.tree, sharashka: join(directory, result.filename),
    });
  });
}
