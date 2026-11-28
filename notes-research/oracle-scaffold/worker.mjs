import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Worker, parentPort, workerData } from 'node:worker_threads';
import { baseFile, latest, publish, taskLock } from './gosplan.mjs';
import { command, git, gitText, imageId } from './lab.mjs';
import { hash, json } from './project.mjs';
import { assign, oneShot } from './provider.mjs';

const instruction = 'Implement the original order using only the supplied files. Reply with {"status":"PROPOSED","changes":[{"path":"exact writable path","text":"full new UTF-8 file contents"}],"dissent":""}. Use {"path":"...","remove":true} for deletion or {"path":"...","base64":"..."} for binary data. Use {"status":"ABORT","dissent":"one line"} if impossible. Do not claim that your own work passed.';

export async function lockedPacket(root, task) {
  if (hash(JSON.stringify(task.lockHashes)) !== task.lockHash) throw new Error('원장의 잠금 지문이 다릅니다.');
  const locked = {};
  for (const [name, digest] of Object.entries(task.lockHashes)) {
    const bytes = await readFile(join(taskLock(root, task), name));
    if (hash(bytes) !== digest) throw new Error('봉인한 자료가 바뀌었습니다 · ' + name);
    locked[name] = name === 'raw_order.txt' ? bytes.toString('utf8') : json(bytes, name);
  }
  return locked;
}

function contents(root, tree, path, allowMissing) {
  if (allowMissing && !gitText(root, ['--literal-pathspecs','ls-tree',tree,'--',path])) return null;
  const bytes = baseFile(root, tree, path);
  const text = bytes.toString('utf8');
  return Buffer.from(text).equals(bytes) ? { text } : { base64: bytes.toString('base64') };
}

export function sourcePacket(root, task, locked, tree = task.head) {
  const scope = locked['scope.json'];
  const baseline = locked['baseline.json'].baseline;
  const contract = baseline.contract ? contents(root, task.head, baseline.contract, false) : baseline;
  return { id: task.id, raw_order: locked['raw_order.txt'], gost: locked['gost.json'], scope, contract,
    files: Object.fromEntries([...scope.read, ...scope.write].map(path => [path, contents(root, tree, path, scope.write.includes(path))])) };
}

export function candidateTree(root, base, scope, changes) {
  if (!Array.isArray(changes) || !changes.length) throw new Error('후보 변경이 비었습니다.');
  const seen = new Set();
  const dir = mkdtempSync(join(tmpdir(), 'lubyanka-worker-index-'));
  function index(args, input) {
    const result = command('git', ['-C', root, ...args], root, { env: { ...process.env, GIT_INDEX_FILE: join(dir,'index') }, input });
    if (result.status !== 0) throw new Error('후보 인덱스 작업 실패 · ' + args[0]);
    return result.stdout.toString().trim();
  }
  try {
    index(['read-tree', base]);
    for (const change of changes) {
      const path = change?.path;
      if (!scope.write.includes(path) || seen.has(path)) throw new Error('쓰기 범위 이탈 또는 중복 · ' + path);
      seen.add(path);
      const keys = Object.keys(change).sort().join(',');
      const prior = gitText(root, ['--literal-pathspecs','ls-tree',base,'--',path]);
      if (keys === 'path,remove' && change.remove === true && prior) {
        index(['--literal-pathspecs','update-index','--force-remove','--',path]);
        continue;
      }
      let bytes;
      if (keys === 'path,text' && typeof change.text === 'string') bytes = Buffer.from(change.text);
      else if (keys === 'base64,path' && typeof change.base64 === 'string') {
        bytes = Buffer.from(change.base64, 'base64');
        if (bytes.toString('base64') !== change.base64) throw new Error('유효하지 않은 base64 · ' + path);
      } else throw new Error('후보 파일 형식 오류 · ' + path);
      const oid = index(['hash-object','-w','--stdin'], bytes);
      index(['update-index','--add','--cacheinfo',prior ? prior.split(' ')[0] : '100644',oid,path]);
    }
    const tree = index(['write-tree']);
    if (tree === gitText(root, ['rev-parse',base + '^{tree}'])) throw new Error('기준과 후보 트리가 같습니다.');
    return tree;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sandbox(root, fixture, packet) {
  if (!Array.isArray(fixture.command) || !fixture.command.length || !fixture.command.every(v => typeof v === 'string' && v.length)) throw new Error('격리 시험 명령이 필요합니다.');
  const image = imageId(root, fixture.image);
  const name = 'lubyanka-worker-' + randomUUID();
  try {
    const result = command('docker',['run','--rm','-i','--name',name,'--pull=never','--network=none','--read-only',
      '--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64','--memory=256m','--cpus=1',
      '--user=65532:65532','--tmpfs=/work:rw,mode=1777,size=32m','--workdir=/work','--entrypoint',fixture.command[0],image,...fixture.command.slice(1)],
    root, { input: JSON.stringify(packet), maxBuffer: 8 * 1024 * 1024 });
    if (result.status !== 0) throw new Error('격리 시험 프로세스 실패');
    return json(result.stdout, '격리 시험 응답');
  } finally {
    command('docker',['rm','-f',name],root,{timeout:5000});
  }
}

function produce({ root, fixture, packet, preferred }) {
  return fixture ? { provider:'fixture', response:sandbox(root, fixture, packet) }
    : assign(preferred, name => oneShot(name, instruction, packet));
}

function isolatedCall(input) {
  return new Promise((resolve, reject) => {
    const child = new Worker(new URL(import.meta.url), { workerData: input });
    let answer;
    child.once('message', message => { answer = message; });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0 && answer) resolve(answer);
      else reject(new Error('격리 작업자가 응답 없이 종료했습니다.'));
    });
  });
}

if (parentPort && workerData?.kind === 'sharashka') parentPort.postMessage(produce(workerData));

export async function worker(root, fixturePath) {
  const ledger = await latest(root);
  const task = ledger?.tasks.find(t => t.state !== 'DONE');
  if (task?.state !== 'IN_PROGRESS' || task.worker) throw new Error('새 워커를 실행할 배차가 없습니다.');
  if (gitText(root,['rev-parse',ledger.ref]) !== task.head) throw new Error('기준 커밋이 이동했습니다.');
  const locked = await lockedPacket(root, task);
  const fixture = fixturePath ? json(await readFile(fixturePath), '격리 시험 설정') : null;
  const count = locked['scope.json'].candidates ?? 1;
  if (![1,2].includes(count)) throw new Error('허용 후보 수는 1 또는 2입니다.');
  const session = randomUUID();
  task.worker = { session, status:'RUNNING', candidates: [] };
  const reserved = await publish(root, ledger);
  try {
    const packet = sourcePacket(root, task, locked, task.patchTree ?? task.head);
    if (task.antiPriors?.length) packet.anti_priors = task.antiPriors;
    const input = { kind:'sharashka', root, fixture, packet, preferred:task.preferred ?? 'codex' };
    const results = await Promise.allSettled(Array.from({length:count}, () => isolatedCall(input)));
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason;
      const answer = result.value;
      const { response, ...assignment } = answer;
      if (typeof response?.dissent !== 'string' || /[\r\n]/u.test(response.dissent) || response.dissent.length > 500) throw new Error('이견은 한 줄로 기록하세요.');
      if (response.status === 'ABORT' && Object.keys(response).sort().join(',') === 'dissent,status') throw new Error('워커가 실행 불가를 반환했습니다.');
      if (response.status !== 'PROPOSED' || Object.keys(response).sort().join(',') !== 'changes,dissent,status') throw new Error('후보 응답 형식 오류');
      const tree = candidateTree(root, task.patchTree ?? task.head, locked['scope.json'], response.changes);
      const id = randomUUID();
      git(root, ['update-ref','refs/lubyanka/candidates/' + id,tree,'']);
      task.worker.candidates.push({ id, tree, head:task.head, lockHash:task.lockHash, attempt:task.attempt, ...assignment, dissent:response.dissent });
    }
    task.worker.status = 'PROPOSED';
  } catch (error) {
    task.worker.status = 'FAILED';
    task.worker.error = error.message;
    await publish(root, reserved);
    throw error;
  }
  await publish(root, reserved);
  return task.worker;
}
