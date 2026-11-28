import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../notes-research/oracle-scaffold/', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'lubyanka-release-'));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: join(temp, 'gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  npm_config_cache: join(temp, 'cache'),
  npm_config_userconfig: join(temp, 'npm-user.conf'),
  npm_config_globalconfig: join(temp, 'npm-global.conf'),
};
const image = process.env.LUBYANKA_TEST_IMAGE || 'node:22-bookworm-slim';
const vasari = process.env.LUBYANKA_VASARI_EVIDENCE;

function run(executable, args, cwd, expected = 0) {
  const result = spawnSync(executable, args, { cwd, env, encoding: 'utf8', timeout: 120_000 });
  assert.ifError(result.error);
  if (expected === 'failure') {
    assert.ok(result.status > 0, `${executable} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  } else {
    assert.equal(result.status, expected, `${executable} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}
const write = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const read = async path => JSON.parse(await readFile(path, 'utf8'));

try {
  const archive = process.argv[2] ? resolve(process.argv[2]) : join(temp, JSON.parse(run('npm', [
    'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', temp,
  ], src).stdout)[0].filename);
  const install = join(temp, 'install');
  await mkdir(install);
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive], install);
  const bin = join(install, 'node_modules', '.bin', 'lubyanka');
  const pipeline = fileURLToPath(new URL('./pipeline.mjs', import.meta.url));
  process.stdout.write(run(process.execPath, [pipeline, bin, image], install).stdout);
  const legacy = join(install, 'node_modules', '.bin', 'lubyanka-oracle');
  run(process.execPath, ['--input-type=module', '-e',
    "import { evaluateOracle } from 'lubyanka-oracle-scaffold'; if (typeof evaluateOracle !== 'function') process.exit(1);"], install);

  const project = join(temp, 'legacy project');
  await mkdir(project);
  const git = (args, expected) => run('git', args, project, expected);
  const cli = (args, expected) => run(bin, [args[0], project, ...args.slice(1)], install, expected);
  const request = join(temp, 'request.txt');
  await writeFile(request, '시험 서비스 결과를 갱신하고 기존 거절 정책을 보존한다.\n');
  git(['init', '--template=', '-b', 'develop']);
  const fixtureSize = 65 * 1024 * 1024;
  const fixture = await open(join(project, 'archive-size-fixture.bin'), 'w');
  try {
    await fixture.write(Buffer.from([0x5a]), 0, 1, fixtureSize - 1);
  } finally {
    await fixture.close();
  }
  await writeFile(join(project, 'AGENTS.md'), '# 기존 프로젝트 지시\n사용자 원본을 보존한다.\n');
  const service = (version, allowViewer = false) => `
export const version = ${JSON.stringify(version)};
export const accepts = role => role === 'editor'${allowViewer ? " || role === 'viewer'" : ''};
export function createStore() {
  const rows = [];
  let running = 0;
  let peak = 0;
  return {
    async submit(role) {
      running++;
      peak = Math.max(peak, running);
      await new Promise(resolve => setImmediate(resolve));
      if (accepts(role)) rows.push(role);
      running--;
    },
    snapshot() { return { rows: [...rows], peak }; },
  };
}
`;
  await writeFile(join(project, 'service.mjs'), service('legacy'));
  git(['add', '.']);
  git(['commit', '-m', '기존 프로젝트']);
  cli(['begin', request], 1);
  cli(['adopt']);
  const firstAgents = await readFile(join(project, 'AGENTS.md'), 'utf8');
  cli(['adopt']);
  assert.equal(await readFile(join(project, 'AGENTS.md'), 'utf8'), firstAgents);
  assert.match(firstAgents, /^# 기존 프로젝트 지시\n사용자 원본을 보존한다\./);

  const unconfigured = JSON.parse(cli(['begin', request]).stdout);
  assert.ok(unconfigured.unresolved.length > 0);
  cli(['plan', request], 1);

  const configPath = join(project, 'lubyanka.json');
  const config = await read(configPath);
  config.integrationBranch = 'develop';
  config.image = image;
  config.reviewPlan = ['node', 'review-plan.mjs'];
  config.reportReview = ['node', 'review-report.mjs'];
  config.checkSources = ['exercise.mjs'];
  config.checks = {
    plan: [['node', 'exercise.mjs', 'plan']],
    feature: [['node', 'exercise.mjs', 'feature']],
    merge: [['node', 'exercise.mjs', 'merge']],
  };
  await write(configPath, config);
  const rule = (requirementId, comparator, assertion, stages) => ({
    requirementId, comparator, assertion, phases: stages, source: '시험용 사용자 계약',
    scope: '서비스 시험', inputs: '실제 코드와 시험 권한', expectedOrRule: '저장 횟수와 정책을 관측한다.',
    requiredEvidence: ['실제 후보 실행'], unresolved: [],
    reportCases: requirementId === 'VERSION'
      ? { operation: ['source', 'motion'], fallback: ['source', 'interaction'] }
      : { operation: ['source'] },
  });
  const oraclePath = join(project, 'lubyanka-oracle.json');
  const manifest = { schemaVersion: 1, requirements: [
    rule('PLAN', 'invariant', undefined, ['plan']),
    rule('VERSION', 'exact', { expected: 'new' }),
    rule('ALLOWED', 'invariant'),
    rule('COUNT', 'range', { min: 2, max: 2 }),
    rule('PARALLEL', 'range', { min: 3 }),
    rule('BLOCKED', 'relation', { operator: 'eq' }),
  ] };
  await write(oraclePath, manifest);
  await writeFile(join(project, 'LUBYANKA-CONTRACT.md'), '# 시험 계약\n기존 서비스, 사용자 역할과 판정 기준을 확인했다.\n');
  await writeFile(join(project, 'docs-critique.md'), '# 경로별 자아비판\n차단 상태에서 저장을 확인한다.\n');
  config.pathCritiques = ['docs-critique.md'];
  await write(configPath, config);
  const outside = join(temp, 'host-only.txt');
  await writeFile(outside, '호스트 전용 합성 데이터');
  await writeFile(join(project, 'exercise.mjs'), `
import fs from 'node:fs';
import os from 'node:os';
import { version, accepts, createStore } from './service.mjs';
if (process.argv[2] === 'plan') {
  let outsideRead = false;
  try { fs.readFileSync(${JSON.stringify(outside)}); outsideRead = true; } catch {}
  const isolated = !outsideRead && Object.keys(os.networkInterfaces()).every(name => name === 'lo');
  const fd = fs.openSync('archive-size-fixture.bin', 'r');
  const last = Buffer.alloc(1);
  const intact = fs.fstatSync(fd).size === ${fixtureSize} && fs.readSync(fd, last, 0, 1, ${fixtureSize - 1}) === 1 && last[0] === 0x5a;
  fs.closeSync(fd);
  console.log(JSON.stringify({ PLAN: isolated && intact && accepts('editor') && !accepts('viewer') }));
} else {
  const store = createStore();
  await Promise.all(['editor', 'viewer', 'editor'].map(role => store.submit(role)));
  const { rows, peak } = store.snapshot();
  console.log(JSON.stringify({
    VERSION: version, ALLOWED: rows.includes('editor'), COUNT: rows.length,
    PARALLEL: peak, BLOCKED: [rows.includes('viewer'), false],
  }));
}
`);
  await writeFile(join(project, 'review-plan.mjs'), `
const proposal = JSON.parse(process.env.LUBYANKA_PLAN_JSON);
const required = {
  PLAN: '격리 상태', VERSION: '버전 값', ALLOWED: '허용 결과', COUNT: '저장 횟수', PARALLEL: '동시에 진행', BLOCKED: '차단 후 저장',
};
const unsupported = proposal.decisions.filter(row =>
  !row.decision.includes(required[row.id]) || !row.reason.includes('실제') || !row.falsifier.includes('폐기'));
console.log(JSON.stringify({
  accepted: unsupported.length === 0,
  coverage: proposal.decisions.length === 1
    ? [{quote: '역할별 승인 규칙이 유지됐나?', ids: ['PLAN']}]
    : [{quote: '시험 서비스 결과를 갱신하고', ids: ['VERSION']},
       {quote: '기존 거절 정책을 보존한다.', ids: ['BLOCKED']}],
  reasons: unsupported.length ? unsupported.map(row => row.id + '의 결정을 뒷받침하지 못함') : ['각 결정이 서로 다른 판정과 반증 조건을 설명함'],
}));
`);
  await writeFile(join(project, 'review-report.mjs'), `
import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8'));
const { claims, files, phase, tree, verdict, failed, recovery } = input;
const bytes = path => Buffer.from(files[path], 'base64');
const markers = { motion: 'start-middle-end', interaction: 'click-and-fallback', recovery: 'same-path-rerun' };
const output = claims.map(claim => {
  const row = verdict.results.find(result => result.id === claim.id);
  const expected = row?.status === 'pass' ? 'verified' : 'failed';
  const accepted = claim.outcome === expected &&
    claim.statement === claim.id + '/' + claim.case + ': ' + JSON.stringify(row?.observed) &&
    claim.target === phase + ':' + tree && claim.evidence.every(item => {
      if (item.kind === 'source') return bytes(item.path).toString().includes('export const version');
      const data = JSON.parse(bytes(item.path).toString());
      if (item.path === 'report-assets/vasari-motion.json') {
        const clicked = data.filter(result => result.id);
        return clicked.length === 4 && data.every(result => !result.error) && clicked.every(result =>
          result.returnedToList && result.opening[0].clippedRight > 0 &&
          result.lettering[0].opacity > result.lettering[1].opacity &&
          result.end.every(part => part.opacity === 1));
      }
      return data.tree === tree && data.marker === markers[item.kind] &&
        (!failed || item.kind !== 'recovery' || recovery.blocker === data.blocker);
    });
  return { id: claim.id, case: claim.case, accepted, reason: '확정한 실행 범위와 파일 원본을 대조함' };
});
console.log(JSON.stringify(output));
`);

  await writeFile(join(project, '.gitattributes'), 'exercise.mjs export-ignore\nreview-plan.mjs export-ignore\n');
  const previousHooks = join(temp, "existing's hooks");
  await mkdir(previousHooks);
  await writeFile(join(previousHooks, 'pre-commit'), '#!/bin/sh\nprintf "original-hook\n" >&2\n', { mode: 0o755 });
  git(['config', 'core.hooksPath', previousHooks]);
  git(['add', '.']);
  git(['commit', '-m', '시험 계약과 도입 설정']);
  const dev = git(['rev-parse', 'HEAD']).stdout.trim();
  cli(['install-hooks']);
  const hookPath = git(['config', 'core.hooksPath']).stdout.trim();
  assert.notEqual(hookPath, previousHooks);
  cli(['install-hooks']);
  assert.equal(git(['config', 'core.hooksPath']).stdout.trim(), hookPath);
  const referenceHook = join(hookPath, 'reference-transaction');
  const referenceSource = await readFile(referenceHook);
  await rm(referenceHook);
  cli(['install-hooks']);
  assert.deepEqual(await readFile(referenceHook), referenceSource);
  assert.match(git(['update-ref', '-d', 'refs/heads/develop'], 'failure').stderr, /begin|시험|샤라시카/);
  assert.equal(git(['rev-parse', 'develop']).stdout.trim(), dev);
  git(['switch', '-c', 'feature/update']);

  const planPath = join(temp, 'plan.json');
  let task = JSON.parse(cli(['begin', request]).stdout);
  await writeFile(referenceHook, '#!/bin/sh\nexit 0\n');
  assert.match(cli(['verify', 'plan'], 1).stderr, /install-hooks/);
  cli(['install-hooks']);
  assert.deepEqual(await readFile(referenceHook), referenceSource);
  assert.match(task.selfCritique[1].content, /차단 상태에서 저장을 확인/);
  assert.match(task.contract.content, /시험 계약/);
  assert.equal(task.oracle.path, 'lubyanka-oracle.json');
  cli(['verify', 'feature'], 1);
  cli(['finish', 'feature'], 1);
  cli(['permit', task.task], 1);
  run(legacy, ['finish', project, task.reviewPath, '--json'], install, 1);
  await write(planPath, { instruction: '다른 지시', decisions: [] });
  cli(['plan', planPath], 1);
  const requiredDecisions = {
    PLAN: '격리 상태를 확인하고 두 역할을 실제 입력한다.',
    VERSION: '버전 값을 서비스 실행에서 읽는다.',
    ALLOWED: '허용 결과와 저장 배열을 관찰한다.',
    COUNT: '동시에 접근한 뒤 저장 횟수를 센다.',
    PARALLEL: '동시에 진행 중인 요청의 최댓값을 관측한다.',
    BLOCKED: '차단 후 저장 상태가 변했는지 검사한다.',
  };
  const goodPlan = { instruction: task.instruction, decisions: manifest.requirements.map(item => ({
    id: item.requirementId, path: 'docs-critique.md', quote: '차단 상태에서 저장을 확인한다.',
    decision: requiredDecisions[item.requirementId],
    reason: '차단이 실제 저장 경로보다 앞서야 한다.', falsifier: '기대 관측과 다르면 계획을 폐기한다.',
  })) };
  const expandedRequest = join(temp, 'expanded-request.txt');
  const expanded = goodPlan.instruction.trim() + '\n작품 상세의 캡션 설정이 다시 열 때 유지되는지 검사한다.';
  await writeFile(expandedRequest, expanded);
  const expandedTask = JSON.parse(cli(['begin', expandedRequest]).stdout);
  await write(planPath, { ...goodPlan, instruction: expanded });
  cli(['plan', planPath]);
  assert.match(JSON.parse(cli(['verify', 'plan'], 1).stdout).reason, /사용자 지시 원문/);
  cli(['permit', expandedTask.task], 1);
  task = JSON.parse(cli(['begin', request]).stdout);
  const wrongPlan = { ...goodPlan, decisions: goodPlan.decisions.map(row => ({ ...row, decision: '좋아지게 고친다.' })) };
  await write(planPath, wrongPlan);
  cli(['plan', planPath]);
  const rejectedPlan = JSON.parse(cli(['verify', 'plan'], 1).stdout);
  assert.match(rejectedPlan.reason, /독립 검토/);
  assert.match(cli(['begin', request], 1).stderr, /begin --resume/);
  cli(['permit', task.task], 1);
  task = JSON.parse(cli(['begin', request, '--resume']).stdout);
  await write(planPath, goodPlan);
  cli(['plan', planPath]);
  const plan = JSON.parse(cli(['verify', 'plan']).stdout);
  cli(['permit', 'wrong-task'], 1);
  assert.equal(JSON.parse(cli(['permit', task.task]).stdout).status, 'permitted');
  assert.equal(plan.status, 'pass');
  const planEvidence = await read(plan.evidence);
  assert.match(planEvidence.image, /^sha256:/);

  await writeFile(join(project, 'service.mjs'), service('wrong', true));
  git(['add', 'service.mjs']);
  git(['commit', '-m', '시험 생략'], 'failure');
  assert.match(git(['commit', '--no-verify', '-m', 'pre-commit 생략'], 'failure').stderr, /시험의 통과 기록/);
  const failed = JSON.parse(cli(['verify', 'feature'], 1).stdout);
  for (const id of ['VERSION', 'COUNT', 'BLOCKED']) {
    assert.ok(failed.results.some(result => result.id === id && result.status === 'fail'));
  }
  cli(['verify', 'feature'], 1);
  const note = { status: 'retained', summary: '정본을 대조하고 기존 조건을 유지했다.', evidence: '격리 시험 결과' };
  const finishNote = {
    instruction: task.instruction, oracle: note, selfCritique: note, remaining: [],
    codeReview: { result: 'fixed', source: '사용자 시험 계약', argument: '기존 값과 목표 값이 달랐다.', verification: '실제 후보 버전 관측' },
  };
  const failedReview = await read(task.reviewPath);
  failedReview.review = finishNote;
  await write(task.reviewPath, failedReview);
  cli(['finish', 'failure'], 1);
  assert.match(cli(['finish', 'failure'], 1).stderr, /전문을 다시 읽고/);
  const critiquePath = join(project, 'LUBYANKA-SELF-CRITIQUE.md');
  const recovery = {
    path: 'service.mjs', reason: '결과 진술에 실제 실패가 빠졌다.',
    technicalCause: '버전과 저장 관측이 기존 기대값을 벗어났다.',
    action: '같은 역할 입력으로 저장과 차단을 다시 시험했다.',
    blocker: '샌드박스 밖 전송은 이 시험에서 권한이 없다.',
  };
  await writeFile(critiquePath, (await readFile(critiquePath, 'utf8')) +
    '\n' + recovery.reason + '\n' + recovery.technicalCause + '\n');
  git(['add', 'LUBYANKA-SELF-CRITIQUE.md']);
  task = JSON.parse(cli(['begin', request, '--resume']).stdout);
  const attachment = async (kind, path) => ({
    kind, path, sha256: createHash('sha256').update(await readFile(join(project, path))).digest('hex'),
  });
  async function bindReport(task, result, { recover = false } = {}) {
    const record = await read(task.reviewPath);
    const receipt = await read(result.evidence);
    const claims = [];
    for (const row of receipt.verdict.results) {
      const rule = manifest.requirements.find(item => item.requirementId === row.id);
      for (const [name, kinds] of Object.entries(rule.reportCases)) {
        const evidence = [await attachment('source', 'service.mjs')];
        for (const kind of kinds.filter(item => item !== 'source')) {
          const path = join('report-assets', kind + '.json');
          await mkdir(join(project, 'report-assets'), { recursive: true });
          await write(join(project, path), { tree: result.tree, marker: kind === 'motion' ? 'start-middle-end' : 'click-and-fallback' });
          evidence.push(await attachment(kind, path));
        }
        claims.push({
          id: row.id, case: name, outcome: row.status === 'pass' ? 'verified' : 'failed',
          target: receipt.phase + ':' + result.tree, statement: row.id + '/' + name + ': ' + JSON.stringify(row.observed), evidence,
        });
      }
    }
    if (recover) {
      const path = 'report-assets/recovery.json';
      await mkdir(join(project, 'report-assets'), { recursive: true });
      await write(join(project, path), { tree: result.tree, marker: 'same-path-rerun', blocker: recovery.blocker });
      claims[0].evidence.push(await attachment('recovery', path));
    }
    record.review = {
      ...record.review, target: { task: task.task, phase: receipt.phase, tree: result.tree }, claims,
      ...(recover ? { recovery, selfCritique: { ...note, status: 'updated' } } : {}),
    };
    await write(task.reviewPath, record);
    return record;
  }
  const failureEvidence = await read(failed.evidence);
  await bindReport(task, { ...failed, tree: failureEvidence.tree }, { recover: true });
  const failureReport = JSON.parse(cli(['finish', 'failure'], 1).stdout);
  assert.equal(failureReport.verification.status, 'fail');
  assert.equal(failureReport.verification.sharashka, failed.evidence);
  git(['restore', '--source=HEAD', '--staged', '--worktree', '--', 'service.mjs']);
  cli(['plan', planPath]);
  cli(['verify', 'plan']);

  await writeFile(join(project, 'service.mjs'), service('new'));
  git(['add', 'service.mjs']);
  const feature = JSON.parse(cli(['verify', 'feature']).stdout);
  assert.equal(feature.status, 'pass');
  const savedEvidence = await readFile(feature.evidence, 'utf8');
  await writeFile(feature.evidence, '{}');
  assert.match(git(['commit', '-m', '바뀐 시험 기록'], 'failure').stderr, /기록이 바뀌었습니다/);
  await writeFile(feature.evidence, savedEvidence);
  const alteredHarness = await readFile(join(project, 'exercise.mjs'), 'utf8');
  // A candidate that makes its test print a pass must be rejected before that test runs.
  await writeFile(join(project, 'exercise.mjs'), 'console.log(JSON.stringify({ VERSION: "new" }));\n');
  git(['add', 'exercise.mjs']);
  const forged = JSON.parse(cli(['verify', 'feature'], 1).stdout);
  assert.match(forged.reason, /독립 시험 소스/);
  await writeFile(join(project, 'exercise.mjs'), alteredHarness);
  git(['add', 'exercise.mjs']);
  task = JSON.parse(cli(['begin', request, '--resume']).stdout);
  cli(['plan', planPath]);
  cli(['verify', 'plan']);
  cli(['verify', 'feature']);
  await writeFile(join(project, 'extra.txt'), '검증 뒤 새로 바뀐 스테이징\n');
  git(['add', 'extra.txt']);
  assert.match(git(['commit', '-m', '바뀐 후보'], 'failure').stderr, /현재 스테이징 내용/);
  git(['rm', '-f', '--', 'extra.txt']);
  const commit = git(['commit', '-m', '검증한 기능']);
  assert.match(commit.stderr, /original-hook/);
  const source = git(['rev-parse', 'HEAD']).stdout.trim();
  assert.match(git(['update-ref', 'refs/heads/develop', source, dev], 'failure').stderr, /시험의 통과 기록/);
  git(['switch', 'develop']);
  assert.match(git(['merge', '--ff-only', 'feature/update'], 'failure').stderr, /시험의 통과 기록/);
  assert.equal(git(['rev-parse', 'develop']).stdout.trim(), dev);
  git(['read-tree', '--reset', '-u', 'HEAD']);
  git(['switch', 'feature/update']);
  git(['config', 'core.hooksPath', previousHooks]);
  assert.match(cli(['verify', 'merge', 'feature/update'], 1).stderr, /install-hooks/);
  git(['config', 'core.hooksPath', hookPath]);

  const merge = JSON.parse(cli(['verify', 'merge', 'feature/update']).stdout);
  assert.equal(merge.status, 'pass');
  await writeFile(join(project, 'docs-critique.md'), '# 바뀐 자아비판\n');
  assert.match(git(['update-ref', 'refs/heads/develop', source, dev], 'failure').stderr, /문서가 바뀌었거나/);
  git(['restore', 'docs-critique.md']);
  git(['switch', 'develop']);
  git(['merge', '--no-ff', '-m', '검증한 병합', 'feature/update']);
  assert.equal(git(['rev-parse', 'develop^{tree}']).stdout.trim(), merge.tree);
  assert.equal(git(['show', '-s', '--format=%P', 'develop']).stdout.trim(), `${dev} ${source}`);

  const review = await read(task.reviewPath);
  review.review = { ...finishNote, instruction: '다른 사용자 지시' };
  await write(task.reviewPath, review);
  cli(['finish', 'merge'], 1);
  review.review = finishNote;
  await write(task.reviewPath, review);
  assert.match(cli(['finish', 'merge'], 1).stderr, /종료 주장/);
  const supported = await bindReport(task, merge, { recover: true });
  const rejectReport = async (mutate, match) => {
    const changed = structuredClone(supported);
    mutate(changed.review);
    await write(task.reviewPath, changed);
    const rejected = cli(['finish', 'merge'], 1);
    assert.equal(rejected.stdout, '');
    assert.match(rejected.stderr, match);
  };
  await rejectReport(review => review.claims.pop(), /종료 주장/);
  await rejectReport(review => { review.target.tree = 'stale'; }, /종료 주장/);
  await rejectReport(review => {
    review.claims.find(claim => claim.case === 'fallback').evidence.pop();
  }, /증거 종류/);
  await rejectReport(review => { review.claims[0].statement = '전면 개편을 완료했다.'; }, /승인하지 않았습니다/);
  await rejectReport(review => { review.recovery = undefined; }, /교정·재시험/);
  await write(task.reviewPath, supported);
  const motionPath = join(project, 'report-assets/motion.json');
  const motion = await readFile(motionPath);
  await writeFile(motionPath, '{}');
  assert.match(cli(['finish', 'merge'], 1).stderr, /증거가 비어 있거나 바뀌었습니다/);
  await writeFile(motionPath, motion);
  const report = JSON.parse(cli(['finish', 'merge']).stdout);
  assert.equal(report.verification.tree, merge.tree);
  assert.equal(report.verification.sharashka, merge.evidence);
  const reportPath = join(project, '.git', 'lubyanka', 'report-' + task.task + '-merge.json');
  assert.deepEqual(await read(reportPath), report);
  if (vasari) {
    const relative = 'report-assets/vasari-motion.json';
    const actual = join(project, relative);
    const samples = join(vasari, 'candidate-detail-reveal-2026-11-27');
    for (const [folder, code] of [['before', 1], ['pre-report', 1], ['package-audit-navigation', 0]]) {
      const next = structuredClone(supported);
      await writeFile(actual, await readFile(join(samples, folder, 'detail-caption-arrival.json')));
      next.review.claims.find(row => row.id === 'VERSION' && row.case === 'operation')
        .evidence.push(await attachment('motion', relative));
      await write(task.reviewPath, next);
      const check = cli(['finish', 'merge'], code);
      if (code) assert.match(check.stderr, /승인하지 않았습니다/);
    }
    console.log('바사리 원본 브라우저 로그 재생 · 이전 캡션, 재실행 시간 초과 거부 · 교정 후 8조건 승인');
  }

  const question = join(temp, 'question.txt');
  await writeFile(question, '역할별 승인 규칙이 유지됐나?\n');
  const answer = JSON.parse(cli(['begin', question, '--kind', 'answer']).stdout);
  const answerReview = await read(answer.reviewPath);
  answerReview.review = {
    instruction: answer.instruction, oracle: note, selfCritique: note, remaining: [],
    codeReview: { result: 'not-applicable', argument: '확인 질문에 대한 판정' },
  };
  await write(answer.reviewPath, answerReview);
  cli(['finish', 'plan'], 1);
  await write(planPath, { instruction: answer.instruction, decisions: [goodPlan.decisions[0]] });
  cli(['plan', planPath]);
  const answerResult = JSON.parse(cli(['verify', 'plan']).stdout);
  await bindReport(answer, answerResult);
  cli(['verify', 'feature'], 1);
  assert.equal(JSON.parse(cli(['finish', 'plan']).stdout).verification.stage, 'plan');

  const draftPath = join(temp, 'draft.txt');
  await writeFile(draftPath, '실행에서 입력 3건을 비교했습니다.\n');
  assert.equal(JSON.parse(cli(['review-draft', draftPath]).stdout).status, 'clear');
  await writeFile(draftPath, '근거는\n없습니다.\n');
  const rejectedDraft = JSON.parse(cli(['review-draft', draftPath], 1).stdout);
  assert.equal(rejectedDraft.status, 'fail');
  assert.deepEqual((await read(rejectedDraft.evidence)).triggers, ['근거는 없습니다']);
  cli(['finish', 'plan'], 1);
  assert.match(cli(['begin', question, '--kind', 'answer'], 1).stderr, /begin --resume/);
  const resumedAnswer = JSON.parse(cli(['begin', question, '--kind', 'answer', '--resume']).stdout);
  assert.equal((await read(join(project, '.git/lubyanka/task.json'))).recoveryRequired, true);
  const rejectedFinishReview = await read(resumedAnswer.reviewPath);
  rejectedFinishReview.review.codeReview.argument = '철회합니다.';
  await write(resumedAnswer.reviewPath, rejectedFinishReview);
  assert.match(cli(['finish', 'plan'], 1).stderr, /보고 초안을 다시 검증/);
  const stateAfterDraft = await read(join(project, '.git/lubyanka/task.json'));
  assert.deepEqual(stateAfterDraft.receipts, {});
  assert.deepEqual((await read(join(project, '.git/lubyanka', stateAfterDraft.draftFailure.filename))).triggers, ['철회합니다']);
  const draftCorrection = {
    ...recovery, reason: '사용자에게 전달할 초안에서 검산을 누락했다.',
    technicalCause: '일반 문서 검토에 실행한 질문의 관측이 붙지 않았다.',
  };
  await writeFile(critiquePath, (await readFile(critiquePath, 'utf8')) +
    '\n' + draftCorrection.reason + '\n' + draftCorrection.technicalCause + '\n');
  git(['add', 'LUBYANKA-SELF-CRITIQUE.md']);
  const correctedAnswer = JSON.parse(cli(['begin', question, '--kind', 'answer', '--resume']).stdout);
  await write(correctedAnswer.reviewPath, answerReview);
  cli(['plan', planPath]);
  const correctedResult = JSON.parse(cli(['verify', 'plan']).stdout);
  const correctedReport = await bindReport(correctedAnswer, correctedResult, { recover: true });
  correctedReport.review.recovery = draftCorrection;
  await write(correctedAnswer.reviewPath, correctedReport);
  assert.equal(JSON.parse(cli(['finish', 'plan']).stdout).verification.stage, 'plan');

  const values = join(temp, 'observations.json');
  await write(values, { PLAN: true });
  run(bin, ['judge', oraclePath, 'plan', values], install, 0);
  await write(values, {});
  run(bin, ['judge', oraclePath, 'plan', values], install, 2);
  await write(values, { PLAN: false });
  run(bin, ['judge', oraclePath, 'plan', values], install, 1);

  const fresh = join(temp, 'fresh');
  await mkdir(fresh);
  run('git', ['init', '--template=', '-b', 'dev'], fresh);
  run(bin, ['adopt', fresh], install);
  const blank = await read(join(fresh, 'lubyanka-oracle.json'));
  assert.equal(blank.requirements[0].source, '');
  assert.match(await readFile(join(fresh, 'LUBYANKA-SELF-CRITIQUE.md'), 'utf8'), /업무 착수/);
  // Manual observations cannot pass with a bare status value.
  const freshRun = (args, code) => run(bin, [args[0], fresh, ...args.slice(1)], install, code);
  const freshConfig = await read(join(fresh, 'lubyanka.json'));
  Object.assign(freshConfig, {
    image, reviewPlan: ['node', '-e', 'console.log(JSON.stringify({accepted:true,coverage:[{quote:"역할별 승인 규칙이 유지됐나?",ids:["MANUAL"]}],reasons:["정답지의 실제 원본을 연다"]}))'],
    reportReview: ['node', 'review-manual.mjs'],
    checks: { plan: [['node', '-e', 'console.log("{}")']] },
  });
  await write(join(fresh, 'lubyanka.json'), freshConfig);
  const manualRule = rule('MANUAL', 'manual', undefined, ['plan']);
  manualRule.reportCases = { operation: ['reference-source'] };
  await write(join(fresh, 'lubyanka-oracle.json'), { schemaVersion: 1, requirements: [manualRule] });
  await writeFile(join(fresh, 'LUBYANKA-CONTRACT.md'), '# 원본 확인 질문\n실제 증거를 검토한다.\n');
  await writeFile(join(fresh, 'review-manual.mjs'), `
import { readFileSync } from 'node:fs';
const { mode, files, claims } = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(claims.map(claim => ({
  id: claim.id, case: claim.case,
  accepted: mode === 'manual' && Buffer.from(files['reference.txt'], 'base64').toString() === 'line 3: checked actual renderer',
  reason: '출처의 해당 줄을 확인함',
}))));
`);
  run('git', ['add', '.'], fresh);
  run('git', ['commit', '-m', '수동 검토 시험 기준'], fresh);
  let manualTask = JSON.parse(freshRun(['begin', question, '--kind', 'answer']).stdout);
  const manualPlan = () => ({
    instruction: manualTask.instruction,
    decisions: [{
      id: 'MANUAL', path: 'LUBYANKA-SELF-CRITIQUE.md', quote: '이번 수정과 관련 기존 코드',
      decision: '실제 출력 줄을 검토한다.', reason: '출처를 구분한다.', falsifier: '다른 줄이나 출력이면 기각한다.',
    }],
  });
  await write(planPath, manualPlan());
  freshRun(['plan', planPath]);
  assert.equal(JSON.parse(freshRun(['verify', 'plan'], 2).stdout).status, 'pending');
  manualTask = JSON.parse(freshRun(['begin', question, '--kind', 'answer', '--resume']).stdout);
  await write(planPath, manualPlan());
  freshRun(['plan', planPath]);
  const manualTree = run('git', ['write-tree'], fresh).stdout.trim();
  const manualFile = join(temp, 'manual.json');
  const refPath = join(fresh, 'reference.txt');
  const manualProof = async body => {
    await writeFile(refPath, body);
    await write(manualFile, {
      target: { task: manualTask.task, phase: 'plan', tree: manualTree },
      claims: [{
        id: 'MANUAL', case: 'operation', outcome: 'verified', statement: '렌더러 호출 줄 확인',
        target: 'reference.txt:3', evidence: [{
          kind: 'reference-source', path: 'reference.txt', sha256: createHash('sha256').update(body).digest('hex'),
        }],
      }],
    });
  };
  await manualProof('only a file hash');
  const invalidManual = JSON.parse(freshRun(['verify', 'plan', '--manual-file', manualFile], 1).stdout);
  assert.match(invalidManual.reason, /승인하지 않았습니다/);
  manualTask = JSON.parse(freshRun(['begin', question, '--kind', 'answer', '--resume']).stdout);
  await write(planPath, manualPlan());
  freshRun(['plan', planPath]);
  await manualProof('line 3: checked actual renderer');
  const manualResult = JSON.parse(freshRun(['verify', 'plan', '--manual-file', manualFile]).stdout);
  assert.equal(manualResult.status, 'pass');
  assert.equal((await read(manualResult.evidence)).manual.claims[0].id, 'MANUAL');
  console.log(`릴리스 후보 ${basename(archive)}의 오프라인 설치와 API import 통과`);
  console.log('기존·빈 프로젝트 도입, 기존 지침과 Git 훅 보존, 자아비판 전문 전달 확인');
  console.log('배포 제외 속성의 영향을 받지 않는 Docker 계획·기능·병합 시험, 호스트 파일·네트워크 격리, 동시 실행과 정책 차단 검사 통과');
  console.log('64 MiB 초과 Git 아카이브를 Docker에 전달하고 파일 끝까지 보존 확인');
  console.log('동일한 인용을 단 계획도 독립 검토에서 적용 근거가 빠지면 거부');
  console.log('계획·시험 누락, --no-verify 커밋, 잘못된 관측, 바뀐 스테이징·정본·시험 기록과 미설치 훅, 시험 없는 fast-forward 거부 확인');
  console.log('검증한 커밋·병합·종료 보고, 재독 후 실패 보고와 단순 질문 보고 통과');
  console.log('동선 누락·이전 후보·근거 바꿔치기·과장 보고·후속 교정 누락 차단 및 수동 근거 독립 판정 확인');
  console.log('두 표현의 초안·종료 차단, 기존 통과 기록 폐기와 재독 강제 확인');
} finally {
  await rm(temp, { recursive: true, force: true });
}
