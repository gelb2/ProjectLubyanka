import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const binary = resolve(process.argv[2]);
const dir = await mkdtemp(join(tmpdir(), 'lubyanka-pipeline-'));
const root = join(dir, 'project');
const input = join(dir, 'input');
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
const run = async (...args) => JSON.parse((await execute(process.execPath, [binary, 'gosplan', root, ...args], { env })).stdout);
const fails = async (args, diagnostic) => {
  await assert.rejects(run(...args), error => error.code === 1 && diagnostic.test(error.stderr));
};
const digest = data => createHash('sha256').update(data).digest('hex');
const jsonFile = (name, value) => writeFile(join(input, name), JSON.stringify(value));
try {
  await mkdir(root);
  await mkdir(input);
  git('init', '-q', '-b', 'develop');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  for (const [path, data] of Object.entries({ 'app.js': 'exports.run = n => n + 1;\n', 'reference.txt': 'untouched', 'contract.md': 'keep current I/O' })) {
    await writeFile(join(root, path), data);
  }
  git('add', '.');
  git('commit', '-qm', 'baseline');
  const original = git('rev-parse', 'HEAD');
  const order1 = '1. 한글\t수정\r\n    2. 하위 예시\r\n~~~text\r\n7. 코드\r\n~~~\r\n';
  const order2 = '2. 두 번째';
  const scope = { write: ['app.js'], read: [], snapshots: [], intentional_constraints: ['한글'] };
  const scopes = { 'TASK-01': scope, 'TASK-02': { ...scope, intentional_constraints: [] } };
  await jsonFile('gost.json', { version: 1, method_locks: ['기준 보존'], forbidden_shortcuts: ['test.skip'], protected_paths: ['reference.txt'], visual_tokens: {} });
  await jsonFile('scope.json', scopes);
  const image = process.argv[3];
  const observation = "const {run}=require('./app.js'); console.log(JSON.stringify({cases:[{input:2,output:run(2)}], signatures:['run(number)']}))";
  await jsonFile('basis.json', image ? { image, command: ['node', '-e', observation] } : { contract: 'contract.md' });
  for (const bad of ['1. first\n3. missing', '1. again\n1. again', 'orphan\n1. first', '1. ok\n~~~\n2. hidden', Buffer.from([0xff])]) {
    await writeFile(join(input, 'orders.md'), bad);
    await fails(['prepare', input], /번호|원문|encoded data|UTF-8/i);
    await fails(['status'], /원장/);
  }
  await writeFile(join(input, 'orders.md'), order1 + order2);
  const immutable = await run('prepare', input);
  assert.deepEqual(await run('prepare', input), immutable);
  assert.deepEqual(immutable.tasks.map(t => [t.id, t.state]), [['TASK-01','PENDING'], ['TASK-02','PENDING']]);
  const raw = Buffer.from(order1 + order2);
  assert.equal(immutable.tasks[0].end, Buffer.byteLength(order1));
  assert.deepEqual(Buffer.concat(immutable.tasks.map(t => raw.subarray(t.start, t.end))), raw);
  assert.deepEqual(immutable.tasks.map(t => t.rawHash), [digest(order1), digest(order2)]);
  await writeFile(join(input, 'orders.md'), '1. 변경\n2. 변경');
  await fails(['prepare', input], /미완료/);
  git('commit', '-q', '--allow-empty', '-m', 'moved');
  await fails(['dispatch'], /기준 커밋/);
  git('reset', '--soft', original);
  const race = await Promise.allSettled([run('dispatch'), run('dispatch')]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.find(r => r.status === 'rejected').reason.code, 1);
  const permit = race.find(r => r.status === 'fulfilled').value;
  assert.equal((await readFile(join(permit.lock, 'raw_order.txt'))).toString(), order1);
  assert.equal(JSON.parse(await readFile(join(permit.lock, 'protected_hashes.json')))['reference.txt'], digest('untouched'));
  const { baseline } = JSON.parse(await readFile(join(permit.lock, 'baseline.json')));
  if (image) assert.deepEqual(baseline.cases, [{ input: 2, output: 3 }]);
  else assert.equal(baseline.sha256, digest('keep current I/O'));
  const state = await run('status');
  assert.equal(state.tasks[0].state, 'IN_PROGRESS');
  assert.equal(state.tasks[1].attempt, 0);
  await fails(['dispatch'], /선두/);
  assert.deepEqual(await run('status'), state);
  assert.equal(git('status','--porcelain'), '');
  console.log('Installed Gosplan: lossless bytes, invalid-input refusal, prior HEAD and protection, one winning dispatch, next task closed.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
