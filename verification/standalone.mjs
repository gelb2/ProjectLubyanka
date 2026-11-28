import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../notes-research/oracle-scaffold/', import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), 'lubyanka-standalone-'));
const env = {
  ...process.env,
  npm_config_cache: join(workspace, 'npm-cache'),
  npm_config_userconfig: join(workspace, 'npm-user.conf'),
  npm_config_globalconfig: join(workspace, 'npm-global.conf'),
};

function run(command, args, cwd, expected) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (expected !== undefined) {
    assert.equal(result.status, expected, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

try {
  const installation = join(workspace, 'installation');
  const project = join(workspace, 'empty project');
  await mkdir(installation);
  await mkdir(project);
  await mkdir(join(project, 'docs'));
  const tarball = JSON.parse(run('npm', [
    'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', workspace,
  ], source, 0).stdout)[0];
  assert.deepEqual(tarball.files.map(entry => entry.path).sort(), [
    'README.md', 'engine.mjs', 'gate.mjs', 'gosplan.mjs', 'hooks.mjs', 'lab.mjs', 'lifecycle.mjs', 'managed.md',
    'managed.mjs', 'method-audit.mjs', 'oracle.mjs', 'package.json', 'pipeline-contract.mjs', 'pipeline.md', 'politruk.mjs', 'procedure.md', 'project.mjs',
    'provider.mjs', 'report.mjs', 'self-critique.md', 'sharashka.mjs', 'voenpred.mjs', 'worker.mjs',
  ]);
  run('npm', [
    'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(workspace, tarball.filename),
  ], installation, 0);

  const installed = join(installation, 'node_modules', tarball.name);
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.bin['lubyanka-oracle'], './oracle.mjs');
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/' });
  const policyPath = join(workspace, 'gost.json');
  const scopePath = join(workspace, 'scope.json');
  await writeFile(policyPath, JSON.stringify({ version: 1, method_locks: [], forbidden_shortcuts: [],
    protected_paths: ['oracle.json'], visual_tokens: {} }));
  const scope = { write: ['app.js'], read: [], snapshots: [], intentional_constraints: [] };
  const contractArgs = [join(installed, 'managed.mjs'), 'contract', policyPath, scopePath];
  await writeFile(scopePath, JSON.stringify(scope));
  run(process.execPath, contractArgs, installation, 0);
  await writeFile(scopePath, JSON.stringify({ ...scope, write: ['oracle.json'] }));
  run(process.execPath, contractArgs, installation, 1);
  const pipelineTest = fileURLToPath(new URL('./pipeline.mjs', import.meta.url));
  process.stdout.write(run(process.execPath, [pipelineTest, join(installed, 'managed.mjs')], installation, 0).stdout);
  const executable = process.platform === 'win32' ? process.execPath : join(installation, 'node_modules', '.bin', 'lubyanka-oracle');
  const entry = process.platform === 'win32' ? [join(installed, 'oracle.mjs')] : [];
  const cli = (args, expected) => run(executable, [...entry, ...args], installation, expected);

  const relativeOracle = 'docs/검증 기준.json';
  const options = ['--oracle', relativeOracle];
  const oraclePath = join(project, relativeOracle);
  const reviewPath = join(workspace, 'review.json');
  cli(['init', project, ...options], 0);

  const critiquePath = join(project, 'LUBYANKA-SELF-CRITIQUE.md');
  const original = await readFile(critiquePath, 'utf8');
  const marker = '시험용 자아비판 원문 확인 표식';
  await writeFile(critiquePath, `${original}\n${marker}\n`);
  const started = cli(['start', project, reviewPath, ...options], 0);
  assert.match(started.stderr, /정답지 미판정/);
  assert.match(started.stdout, /전문 읽기/);
  cli(['check', project, ...options], 2);

  const oracle = JSON.parse(await readFile(oraclePath, 'utf8'));
  Object.assign(oracle.requirements[0], {
    source: '독립 시험 계약 · 항목 1개',
    scope: '격리된 시험용 출력',
    inputs: '입력 한 건',
    comparator: 'exact',
    expectedOrRule: '결과 1개',
    requiredEvidence: ['시험의 실제 출력'],
  });
  await writeFile(oraclePath, JSON.stringify(oracle));
  cli(['check', project, ...options], 0);

  const record = JSON.parse(await readFile(reviewPath, 'utf8'));
  record.review = {
    instruction: '정답지 기입 상태 확인',
    oracle: { status: 'updated', summary: '기준을 기입했다.', evidence: '시험 계약' },
    selfCritique: { status: 'retained', summary: '기존 기록을 유지했다.', evidence: '파일 내용과 대조' },
    codeReview: { result: 'not-applicable', argument: '시험 프로젝트에 제품 코드는 없다.' },
    remaining: [],
  };
  await writeFile(reviewPath, JSON.stringify(record));
  const finish = cli(['finish', project, reviewPath, '--json'], 0);
  assert.deepEqual(JSON.parse(finish.stdout).oracleIssues, []);
  await writeFile(oraclePath, JSON.stringify({ schemaVersion: 1, requirements: [] }));
  const unjudged = cli(['finish', project, reviewPath, '--json'], 0);
  assert.deepEqual(JSON.parse(unjudged.stdout).oracleIssues, ['요구 항목이 없습니다.']);

  const brokenReview = join(workspace, 'broken-review.json');
  const damaged = '{ 손상';
  await writeFile(oraclePath, damaged);
  assert.match(cli(['start', project, brokenReview, ...options], 1).stderr, /JSON으로 읽을 수 없습니다/);
  await assert.rejects(readFile(brokenReview), { code: 'ENOENT' });
  assert.equal(await readFile(oraclePath, 'utf8'), damaged);
  await writeFile(oraclePath, '{}');
  assert.match(cli(['start', project, brokenReview, ...options], 1).stderr, /schemaVersion은 1/);
  await assert.rejects(readFile(brokenReview), { code: 'ENOENT' });

  console.log(`오프라인 설치 통과 · ${tarball.name} · 패키지 파일 ${tarball.files.length}개`);
  console.log('init · start · check · finish 실행 확인 · 정상 0 / 미판정 2 / 손상 JSON·스키마 오류 1');
  console.log(`start 출력의 자아비판문 전문 표식 · ${started.stdout.includes(marker) ? '있음' : '없음'}`);
  console.log(`도입 전 문서 전용 finish · 종료 코드 ${finish.status}, 문서 검토 출력 · 미판정 정답지도 동일`);
  run(process.execPath, [
    '--input-type=module', '-e',
    "import { evaluateOracle } from 'lubyanka-oracle-scaffold'; if (typeof evaluateOracle !== 'function') process.exit(1);",
  ], installation, 0);
  console.log('공개 evaluateOracle API import 성공. 기존 명령의 호환 범위를 확인했습니다.');
  console.log('npm 공개 레지스트리 설정 확인');
} finally {
  await rm(workspace, { recursive: true, force: true });
}
