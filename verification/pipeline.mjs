import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const execute = promisify(execFile);
const { realpath } = await import('node:fs/promises');
const { pathToFileURL } = await import('node:url');
const binary = await realpath(resolve(process.argv[2]));
const dir = await realpath(await mkdtemp(join(tmpdir(), 'lubyanka-pipeline-')));
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
  const scope = { write: ['app.js'], read: [], snapshots: [], intentional_constraints: ['한글'], candidates: 2 };
  const scopes = { 'TASK-01': scope, 'TASK-02': { ...scope, intentional_constraints: [] } };
  await jsonFile('gost.json', { version: 1, method_locks: ['기준 보존'], forbidden_shortcuts: ['test.skip'], protected_paths: ['reference.txt'], visual_tokens: {} });
  await jsonFile('scope.json', scopes);
  const image = process.argv[3];
  const observation = "const {run}=require('./app.js'); console.log(JSON.stringify({cases:[{input:2,output:run(2)}], signatures:['run(number)']}))";
  await jsonFile('basis.json', image ? { image, command: ['node', '-e', observation] } : { contract: 'contract.md' });
  const rule = { command:['node','-e',"console.log(JSON.stringify({at2:require('./app.js').run(2)}))"], expected:{at2:4} };
  if (image) await jsonFile('checks.json', {'TASK-01':{image,build:['node','--check','app.js'],oracle:rule,
    replaceCases:[{index:0,quote:'한글',output:4}],metrics:{...rule,expected:{at2:{min:4,max:4}}}}});
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
  if (image) {
    const { worker, lockedPacket, candidateTree } = await import(new URL('./worker.mjs', pathToFileURL(binary)));
    const task = state.tasks[0];
    const rawPath = join(permit.lock, 'raw_order.txt');
    const { chmod } = await import('node:fs/promises');
    await chmod(rawPath, 0o600);
    await writeFile(rawPath, 'modified');
    await assert.rejects(worker(root), /봉인/);
    await writeFile(rawPath, order1);
    assert.equal((await lockedPacket(root, task))['raw_order.txt'], order1);
    assert.throws(() => candidateTree(root, original, scope, [{path:'reference.txt',text:'x'}]), /범위/);
    const code = [
      "const fs=require('fs'), assert=require('assert/strict');",
      "const input=JSON.parse(fs.readFileSync(0)); assert.deepEqual(Object.keys(input.files), ['app.js']);",
      "assert.equal(input.raw_order," + JSON.stringify(order1) + "); assert.deepEqual(fs.readdirSync('.'),[]);",
      "assert.equal(fs.existsSync('/work/.git'), false); fs.writeFileSync('scratch','local');",
      "assert.equal(Object.values(require('os').networkInterfaces()).flat().filter(a=>!a.internal).length,0);",
      "console.log(JSON.stringify({status:'PROPOSED',dissent:'',changes:[{path:'app.js',text:'exports.run = n => n + 2;\\n'}]}));"
    ].join('\n');
    await jsonFile('fixture.json', {image,command:['node','-e',code]});
    const result = JSON.parse((await execute(process.execPath, [binary,'worker',root,'run',join(input,'fixture.json')],{env})).stdout);
    assert.equal(result.candidates.length, 2);
    assert.equal(new Set(result.candidates.map(c=>c.id)).size, 2);
    for (const candidate of result.candidates) {
      assert.equal(git('show',candidate.tree + ':app.js'), 'exports.run = n => n + 2;');
      assert.equal(candidate.lockHash, task.lockHash);
      assert.equal(candidate.provider,'fixture');
    }
    assert.equal(git('show',':app.js'),git('show','HEAD:app.js'));
    await assert.rejects(worker(root), /배차/);
    const { inspect } = await import(new URL('./voenpred.mjs', pathToFileURL(binary)));
    const locked = await lockedPacket(root,task);
    const config = locked['checks.json'];
    const candidate = result.candidates[0];
    const reject = (changes, stage, altered) => {
      const tree = changes ? candidateTree(root, original, {write:changes.map(c=>c.path)}, changes) : candidate.tree;
      const id = 'red-check';
      git('update-ref','refs/lubyanka/candidates/' + id,tree);
      const report = inspect(root,task,{...candidate,id,tree},altered ?? locked);
      assert.equal(report.verdict,'REJECT',JSON.stringify(report));
      assert.equal(report.stage,stage,JSON.stringify(report));
    };
    reject([{path:'reference.txt',text:'untoucheD'}],'TAMPER');
    reject([{path:'other.txt',text:'new'}],'TAMPER');
    reject([{path:'app.js',text:"try { throw 1 } catch {\n}\n"}],'ANTI_CHEAT');
    reject([{path:'app.js',text:'exports.run = ('}],'BUILD');
    reject([{path:'app.js',text:'exports.run = n => n;'}],'ORACLE');
    reject(null,'ORACLE',{...locked,'checks.json':{...config,oracle:{...rule,command:['node','-e','console.log("{}")']}}});
    reject(null,'METRICS',{...locked,'checks.json':{...config,metrics:{...rule,expected:{at2:{max:1}}}}});
    const measured = JSON.parse((await execute(process.execPath,[binary,'voenpred',root],{env})).stdout);
    assert.equal(measured.status,'pass');
    assert.deepEqual(measured.reports.map(r=>r.observations.oracle),[{at2:4},{at2:4}]);
    assert.equal((await run('status')).tasks[0].state,'VOENPRED_PASS');
    const { reviewPacket, checkEvidence } = await import(new URL('./politruk.mjs',pathToFileURL(binary)));
    const row = measured.reports[0];
    const {packet} = reviewPacket(root,task,candidate,locked,row);
    assert.deepEqual(Object.keys(packet).sort(),['adjacent','contract','diff','gost','id','measurements','raw_order','scope']);
    assert.throws(()=>reviewPacket(root,task,candidate,locked,{...row,target:{...row.target,token:'older'}}),/다릅니다/);
    assert.throws(()=>reviewPacket(root,task,candidate,{...locked,'scope.json':{...scope,visual:true}},row),/화면/);
    const okay = {verdict:'PASS',category:'NONE',evidence:'app.js:1 - measured correction'};
    assert.deepEqual(checkEvidence(root,candidate,packet,okay),okay);
    for (const replacement of [{evidence:'app.js:999 - missing'}, {evidence:'other.js:1 - missing'},
      {category:'CHEAT'}, {verdict:'REJECT',category:'VISUAL_DRIFT'}, {evidence:'capture:1,1 - no image'}]) {
      assert.throws(()=>checkEvidence(root,candidate,packet,{...okay,...replacement}));
    }
    await assert.rejects(execute(process.execPath,[binary,'politruk',root],{env}), error => {
      const verdict = JSON.parse(error.stdout);
      return error.code === 1 && verdict.reports.length === 2 && verdict.reports.every(r=>r.stage === 'INVALID_REVIEW');
    });
    assert.equal((await run('status')).tasks[0].state,'VOENPRED_PASS');
  }
  assert.equal(git('status','--porcelain'), '');
  console.log('Installed Gosplan: lossless bytes, invalid-input refusal, prior HEAD and protection, one winning dispatch, next task closed.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
