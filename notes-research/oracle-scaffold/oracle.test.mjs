import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./oracle.mjs', import.meta.url));
const manifestName = 'lubyanka-oracle.json';
const procedureName = 'LUBYANKA-ORACLE.md';
const critiqueName = 'LUBYANKA-SELF-CRITIQUE.md';
const completedRule = {
  requirementId: 'REQ-001',
  source: '사용자 명령 §1 · 재시도 후 같은 행을 하나만 유지한다.',
  scope: '등록 API와 시험 DB의 대상 행',
  inputs: '빈 시험 DB에 같은 요청 ID를 두 번 전송한다.',
  comparator: 'exact',
  expectedOrRule: '요청 ID가 같은 저장 행 1개',
  requiredEvidence: ['두 응답과 저장 행 재조회'],
  unresolved: [],
};

async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'lubyanka-oracle-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function run(command, root, ...args) {
  const result = spawnSync(process.execPath, [cli, command, root, ...args], { encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

async function writeManifest(root, requirements) {
  await writeFile(join(root, manifestName), JSON.stringify({ schemaVersion: 1, requirements }));
}

test('초기화는 빈 양식과 절차를 쓰고 기존 내용은 보존한다', async t => {
  const root = await project(t);
  assert.equal(run('init', root).status, 0);
  assert.match(await readFile(join(root, procedureName), 'utf8'), /정답지 작성과 판정 절차/);
  const template = await readFile(join(root, critiqueName), 'utf8');
  assert.match(template, /소스코드 전체가 틀렸다는 전제/);
  assert.match(template, /논증 뒤에 수정한 코드 위치/);
  assert.match(template, /이번 자아비판이 잘못됐다고 간주한다/);
  assert.equal(run('check', root).status, 2);
  await writeManifest(root, [completedRule]);
  await writeFile(join(root, procedureName), '프로젝트에서 수정한 기존 지침');
  await writeFile(join(root, critiqueName), '이미 사용 중인 자아비판문');
  const existingManifest = await readFile(join(root, manifestName), 'utf8');
  assert.equal(run('init', root).status, 0);
  assert.equal(await readFile(join(root, manifestName), 'utf8'), existingManifest);
  assert.equal(await readFile(join(root, procedureName), 'utf8'), '프로젝트에서 수정한 기존 지침');
  assert.equal(await readFile(join(root, critiqueName), 'utf8'), '이미 사용 중인 자아비판문');
});

test('모두 기입한 항목은 실행 전 기입 확인까지만 보고한다', async t => {
  const root = await project(t);
  await writeManifest(root, [completedRule]);
  const result = run('check', root);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /실제 실행과 판정은 별도로/);
});

test('check는 지정한 JSON 정답지의 기입 상태를 확인한다', async t => {
  const root = await project(t);
  const name = '사용자 정답지.json';
  const options = ['--oracle', name];
  const path = join(root, name);
  await writeFile(path, JSON.stringify({ schemaVersion: 1, requirements: [completedRule] }));
  const valid = run('check', root, ...options);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /요구 1개/);
  await writeFile(path, JSON.stringify({ schemaVersion: 1, requirements: [] }));
  const incomplete = run('check', root, ...options);
  assert.equal(incomplete.status, 2, incomplete.stderr);
  assert.match(incomplete.stdout, /요구 항목이 없습니다/);
  assert.match(run('check', root, '--oracle', '기준.md').stderr, /JSON 정답지/);
});

test('start는 손상된 정답지를 보존하고 미판정 양식과 구분한다', async t => {
  const root = await project(t);
  const name = '사용자 정답지.json';
  const path = join(root, name);
  const reviewPath = join(root, 'review.json');
  const options = [reviewPath, '--oracle', name];
  for (const [input, diagnostic] of [['{ 손상', /JSON으로 읽을 수 없습니다/], ['{}', /schemaVersion은 1/]]) {
    await writeFile(path, input);
    const result = run('start', root, ...options);
    assert.equal(result.status, 1);
    assert.match(result.stderr, diagnostic);
    await assert.rejects(readFile(reviewPath), { code: 'ENOENT' });
    assert.equal(await readFile(path, 'utf8'), input);
  }
  await rm(path);
  const initialized = run('start', root, ...options);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stderr, /정답지 미판정/);
  assert.match(initialized.stdout, /전문 읽기/);
});

test('필수 근거, 미지원 방식 또는 미해결 항목이 있으면 미판정으로 남긴다', async t => {
  const root = await project(t);
  await writeManifest(root, [{ ...completedRule, source: ' ', requiredEvidence: [], comparator: 'unknown', unresolved: ['최신 기준 필요'] }]);
  const result = run('check', root);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /source, comparator, requiredEvidence/);
  assert.match(result.stdout, /해결할 항목 1개/);
});

test('중복 요구 ID와 손상된 JSON을 오류로 처리한다', async t => {
  const root = await project(t);
  await writeManifest(root, [completedRule, completedRule]);
  assert.match(run('check', root).stderr, /중복 요구 ID/);
  await writeFile(join(root, manifestName), '{ 잘못된 JSON');
  const result = run('check', root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON으로 읽을 수 없습니다/);
});

test('기존 심볼릭 링크를 덮어쓰거나 정답지로 읽지 않는다', async t => {
  const root = await project(t);
  const target = join(root, 'existing.json');
  await writeFile(target, '{}');
  await symlink(target, join(root, manifestName));
  assert.equal(run('init', root).status, 0);
  assert.equal(await readFile(target, 'utf8'), '{}');
  const result = run('check', root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /일반 파일/);
});

const instruction = '같은 요청을 재시도해도 등록 행은 하나를 유지한다.';
const retained = { status: 'retained', summary: '기존 기준과 이번 근거가 일치한다.', evidence: '등록 계약 §1과 대상 행 재조회' };
const updated = { status: 'updated', summary: '재시도 조건과 관측을 추가했다.', evidence: '등록 계약 §1과 두 응답의 재현 기록' };
const fixed = {
  result: 'fixed',
  source: 'PostgreSQL 공식 문서 INSERT § ON CONFLICT',
  argument: '조회와 삽입 사이 동시 요청에서 중복이 생긴다. 요청 ID의 유일 제약과 충돌 시 건너뛰기를 적용한다.',
  verification: '등록 경로에서 동일한 2건을 재실행한 뒤 저장 행 1개를 확인했다.',
  reread: '',
};
const docsOnly = { result: 'not-applicable', argument: '이번 업무 범위는 기존 설명 문구 검토다.' };

async function review(path, oracle = retained, selfCritique = retained, remaining = [], codeReview = docsOnly) {
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.review = { instruction, codeReview, oracle, selfCritique, remaining };
  await writeFile(path, JSON.stringify(record));
}

test('착수 때 없는 두 문서를 만들고, 실제 편집을 CLI와 채팅용 JSON에 동일하게 전달한다', async t => {
  const root = await project(t);
  const path = join(root, 'work.json');
  const start = run('start', root, path);
  assert.equal(start.status, 0, start.stderr);
  assert.match(start.stdout, /정답지 전문 읽기/);
  assert.match(start.stdout, /자아비판문 전문 읽기/);
  const previous = await readFile(join(root, critiqueName), 'utf8');
  await writeManifest(root, [completedRule]);
  await writeFile(join(root, critiqueName), `${previous}\n첫 재시도에서 중복 행을 만든 가정을 기록한다.\n`);
  await review(path, updated, updated, ['동시 재시도 확인'], fixed);
  const cli = run('finish', root, path);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /정답지 · 착수 때 생성 · 수정/);
  assert.match(cli.stdout, /자아비판문 · 착수 때 생성 · 수정/);
  assert.match(cli.stdout, /외부 출처 · PostgreSQL 공식 문서/);
  assert.match(cli.stdout, /남은 확인 · 동시 재시도 확인/);
  const json = run('finish', root, path, '--json');
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), {
    instruction,
    codeReview: fixed,
    documents: {
      oracle: { path: manifestName, created: true, ...updated },
      selfCritique: { path: critiqueName, created: true, ...updated },
    },
    oracleIssues: [],
    remaining: ['동시 재시도 확인'],
  });
});

test('고칠 코드가 없다는 기록은 재독과 재검토를 거친 뒤에도 미입증으로 안내한다', async t => {
  const root = await project(t);
  const path = join(root, 'work.json');
  assert.equal(run('start', root, path).status, 0);
  const outcome = { ...fixed, result: 'no-fix-found' };
  const remaining = ['응답 유실 후 재시도는 운영 사례 미입증'];
  await review(path, retained, retained, remaining, outcome);
  const rejected = run('finish', root, path);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /자아비판이 잘못됐다고 간주합니다.*전문을 다시 읽고/);
  await review(path, retained, retained, remaining, {
    ...outcome,
    reread: '전문 재독 뒤 이전 순차 요청을 동시 요청으로 바꾸어 확인했다.',
    verification: '동시 요청 2건에서 등록 행 1개를 관측했다.',
  });
  const result = run('finish', root, path);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /재검토 후 수정할 코드 미입증/);
  assert.match(result.stdout, /남은 확인 · 응답 유실 후 재시도/);
});

test('수정 기록은 외부 출처, 논증, 재검증 결과를 모두 요구한다', async t => {
  const root = await project(t);
  const path = join(root, 'work.json');
  assert.equal(run('start', root, path).status, 0);
  for (const field of ['source', 'argument', 'verification']) {
    await review(path, retained, retained, [], { ...fixed, [field]: '' });
    const result = run('finish', root, path, '--json');
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /외부 베스트 프랙티스의 출처.*논증.*재검증 결과/);
  }

  const record = JSON.parse(await readFile(path, 'utf8'));
  delete record.review.codeReview;
  await writeFile(path, JSON.stringify(record));
  const missing = run('finish', root, path);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /review.codeReview/);
  await review(path, retained, retained, [], fixed);
  assert.equal(run('finish', root, path).status, 0);
});

test('사용자가 지정한 기존 정본을 보존하고 부족한 판단을 남긴다', async t => {
  const root = await project(t);
  const path = join(root, 'work.json');
  const oracle = '판정 기준.md';
  const selfCritique = '자아비판_회사배치.md';
  await writeFile(join(root, oracle), '# 팀의 기존 정답지\n');
  await writeFile(join(root, selfCritique), '# 팀의 기존 자아비판문\n');
  const start = run('start', root, path, '--oracle', oracle, '--self-critique', selfCritique);
  assert.equal(start.status, 0, start.stderr);
  await assert.rejects(readFile(join(root, manifestName)), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, critiqueName)), { code: 'ENOENT' });
  await review(path, retained, retained, ['독립 기대값 조사']);
  const result = run('finish', root, path, '--json');
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.documents.oracle, { path: oracle, created: false, ...retained });
  assert.deepEqual(report.documents.selfCritique, { path: selfCritique, created: false, ...retained });
  assert.equal(report.oracleIssues, null);
  assert.deepEqual(report.remaining, ['독립 기대값 조사']);
  assert.equal(await readFile(join(root, oracle), 'utf8'), '# 팀의 기존 정답지\n');
  assert.equal(await readFile(join(root, selfCritique), 'utf8'), '# 팀의 기존 자아비판문\n');
});

test('종료 검토가 없거나 수정 여부가 실제와 다르면 안내를 발급하지 않는다', async t => {
  const root = await project(t);
  const path = join(root, 'work.json');
  assert.equal(run('start', root, path).status, 0);
  assert.equal(run('finish', root, path).status, 1);
  await review(path, updated, retained);
  let result = run('finish', root, path);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /정답지의 기록과 실제 변경 여부/);
  await review(path);
  await writeFile(join(root, critiqueName), '# 변경한 자아비판문\n');
  result = run('finish', root, path);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /자아비판문의 기록과 실제 변경 여부/);
  await review(path, retained, updated);
  result = run('finish', root, path);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /정답지 미판정/);
  await writeFile(join(root, manifestName), '{ 손상된 JSON');
  await review(path, updated, updated);
  result = run('finish', root, path);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSON으로 읽을 수 없습니다/);
});

test('후속 작업은 갱신된 두 문서를 기준으로 삼고 다른 프로젝트에 검토 파일을 적용하지 않는다', async t => {
  const root = await project(t);
  const other = await project(t);
  const first = join(root, 'first.json');
  const next = join(root, 'next.json');
  assert.equal(run('start', root, first).status, 0);
  await writeManifest(root, [completedRule]);
  await writeFile(join(root, critiqueName), '# 갱신된 자아비판문\n');
  await review(first, updated, updated);
  assert.equal(run('finish', root, first).status, 0);
  assert.equal(run('start', root, next).status, 0);
  const original = await readFile(next, 'utf8');
  assert.equal(run('start', root, next).status, 1);
  assert.equal(await readFile(next, 'utf8'), original);
  await review(next);
  const result = run('finish', root, next);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /자아비판문 · 유지/);
  assert.equal(run('finish', other, next).status, 1);
});

test('착수에서 외부 경로, 별칭으로 같은 파일을 고른 경우, 빈 정본을 거부한다', async t => {
  const root = await project(t);
  const outside = await project(t);
  const reviewPath = join(root, 'work.json');
  await symlink(outside, join(root, 'external'));
  assert.match(run('start', root, reviewPath, '--oracle', 'external/oracle.md').stderr, /내부/);
  await assert.rejects(readFile(join(outside, 'oracle.md')), { code: 'ENOENT' });
  await writeManifest(root, [completedRule]);
  await link(join(root, manifestName), join(root, critiqueName));
  const linked = run('start', root, reviewPath);
  assert.equal(linked.status, 1);
  assert.match(linked.stderr, /서로 다른 파일/);
  await rm(join(root, critiqueName));
  await writeFile(join(root, critiqueName), ' \n');
  const blank = run('start', root, reviewPath);
  assert.equal(blank.status, 1);
  assert.match(blank.stderr, /자아비판문 본문/);
  await assert.rejects(readFile(reviewPath), { code: 'ENOENT' });
});
