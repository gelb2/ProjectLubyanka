import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { git, gitText, imageId, runLab } from './lab.mjs';
import { readRegularFile } from './lifecycle.mjs';
import { hash, hasText, json } from './project.mjs';
import { pathsOverlap, repoPath, validateGost, validateScope } from './pipeline-contract.mjs';

export function splitOrders(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (/\r(?!\n)|\0/u.test(text)) throw new Error('번호 원문의 줄 경계 또는 NUL을 확인하세요.');
  const tasks = [];
  let offset = 0;
  let fence;
  for (const raw of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    let line = raw.replace(/\r?\n$/u, '');
    if (offset === 0) line = line.replace(/^\uFEFF/u, '');
    const marker = /^ {0,3}(\x60{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    } else if (marker && tasks.length) {
      fence = marker[1];
    } else if (/^[0-9]+[.)]/u.test(line)) {
      const match = /^([1-9]\d*)\.[ \t]+(\S.*)$/u.exec(line);
      if (!match || match[1] !== String(tasks.length + 1)) throw new Error('최상위 번호의 누락·중복 또는 빈 지시입니다.');
      const id = 'TASK-' + match[1].padStart(2, '0');
      if (tasks.length) tasks.at(-1).end = offset;
      tasks.push({ id, start: tasks.length ? offset : 0 });
    } else if (!tasks.length && line.trim()) {
      throw new Error('첫 최상위 번호 앞에 소속을 정할 수 없는 본문이 있습니다.');
    }
    offset += Buffer.byteLength(raw);
  }
  if (fence || !tasks.length) throw new Error('원문에서 완결된 번호 항목을 읽을 수 없습니다.');
  tasks.at(-1).end = bytes.length;
  return tasks;
}

export function controllerDir(root) {
  if (gitText(root, ['rev-parse', '--show-toplevel']) !== root) throw new Error('Git 작업 루트를 지정하세요.');
  const common = gitText(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return join(common, 'lubyanka', 'gosplan');
}

function revision(number) {
  return String(number).padStart(12, '0');
}

export async function latest(root) {
  const directory = controllerDir(root);
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  const name = names.filter(n => /^\d{12}$/u.test(n)).sort().at(-1);
  if (!name) return undefined;
  const ledger = json(await readFile(join(directory, name, 'ledger.json')), 'ledger.json');
  if (ledger.version !== 1 || ledger.revision !== Number(name) || !Array.isArray(ledger.tasks) || !ledger.tasks.length) {
    throw new Error('고스플란 원장 판본이 손상되었습니다.');
  }
  return ledger;
}

// The controller is the only writer. A complete nonempty directory wins one revision.
// An interrupted staging directory has no revision number and is never read.
export async function publish(root, ledger, files = {}) {
  const dir = controllerDir(root);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = await mkdtemp(join(dir, '.prepare-'));
  const next = { ...ledger, revision: ledger.revision + 1 };
  try {
    for (const [name, bytes] of Object.entries(files)) {
      const path = join(temp, name);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, bytes, { mode: 0o400, flag: 'wx' });
    }
    await writeFile(join(temp, 'ledger.json'), JSON.stringify(next, null, 2) + '\n', { mode: 0o400 });
    try {
      await rename(temp, join(dir, revision(next.revision)));
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw new Error('같은 원장 판본을 다른 요청이 먼저 갱신했습니다.');
      throw error;
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return next;
}

export function recordDir(root, rev) {
  if (!Number.isSafeInteger(rev) || rev < 1) throw new Error('원장 판본 번호가 유효하지 않습니다.');
  return join(controllerDir(root), revision(rev));
}

export function taskLock(root, task) {
  return join(recordDir(root, task.lockRevision), 'lock', task.id);
}

function linesAt(root, commit, path) {
  return git(root, ['--literal-pathspecs', 'ls-tree', '-r', '-z', commit, '--', path])
    .toString('utf8').split('\0').filter(Boolean).map(row => {
      const tab = row.indexOf('\t');
      const [mode, type, oid] = row.slice(0, tab).split(' ');
      const name = row.slice(tab + 1);
      if (!repoPath(name) || !['100644', '100755'].includes(mode) || type !== 'blob') {
        throw new Error('허용 범위에 일반 파일 외 항목이 있습니다 · ' + name);
      }
      return { path: name, oid, mode };
    });
}

export function baseFile(root, commit, path) {
  const rows = linesAt(root, commit, path);
  if (rows.length !== 1 || rows[0].path !== path) throw new Error('기준 커밋에 일반 파일이 필요합니다 · ' + path);
  return git(root, ['cat-file', 'blob', rows[0].oid]);
}

function verifyTarget(root, head, name) {
  const parts = name.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const path = parts.slice(0, i).join('/');
    const row = gitText(root, ['--literal-pathspecs', 'ls-tree', head, '--', path]);
    if (!row) return;
    const mode = row.split(' ')[0];
    if ((i < parts.length && mode !== '040000') || (i === parts.length && !['100644', '100755'].includes(mode))) {
      throw new Error('쓰기 대상 또는 상위 경로가 일반 파일 계약을 벗어납니다 · ' + path);
    }
  }
}

async function controlFile(dir, name) {
  return (await readRegularFile(join(dir, name), name)).content;
}

function validateBasis(basis) {
  const keys = Object.keys(basis ?? {}).sort().join(',');
  if (keys === 'contract' && repoPath(basis.contract)) return;
  if (keys === 'command,image' && hasText(basis.image) && Array.isArray(basis.command) &&
      basis.command.length && basis.command.every(hasText)) return;
  throw new Error('basis.json에 정본 경로 또는 격리 관측기(image, command)를 지정하세요.');
}

export async function prepare(root, control) {
  const previous = await latest(root);
  const files = {};
  for (const name of ['orders.md', 'gost.json', 'scope.json', 'basis.json']) files[name] = await controlFile(control, name);
  const orders = files['orders.md'];
  const tasks = splitOrders(orders);
  const policy = validateGost(json(files['gost.json'], 'gost.json'));
  const scopes = json(files['scope.json'], 'scope.json');
  const basis = json(files['basis.json'], 'basis.json');
  validateBasis(basis);
  if (!scopes || Array.isArray(scopes) || Object.keys(scopes).length !== tasks.length) throw new Error('원문 항목과 작업 범위 수가 다릅니다.');
  const digests = Object.fromEntries(Object.entries(files).map(([path, data]) => [path, hash(data)]));
  const campaign = hash(JSON.stringify(digests));
  const ref = gitText(root, ['symbolic-ref', 'HEAD']);
  if (previous?.campaign === campaign && previous.ref === ref) return previous;
  if (previous && previous.tasks.some(t => t.state !== 'DONE')) throw new Error('미완료 원장이 있어 새 지시 묶음을 열 수 없습니다.');
  const head = gitText(root, ['rev-parse', ref]);
  for (const task of tasks) {
    const scope = validateScope(scopes[task.id], policy);
    const raw = orders.subarray(task.start, task.end);
    if (!scope.intentional_constraints.every(q => raw.toString('utf8').includes(q))) throw new Error('원문에 없는 명시적 제약입니다.');
    if (basis.contract && scope.write.some(path => pathsOverlap(path, basis.contract))) throw new Error('태스크가 기준 정본을 변경할 수 없습니다.');
    Object.assign(task, { state: 'PENDING', attempt: 0, rawHash: hash(raw) });
  }
  const revision = previous?.revision ?? 0;
  return publish(root, { version: 1, revision, inputRevision: revision + 1, campaign, ref, head, digests, tasks }, files);
}

function observe(root, head, basis, scope) {
  if (basis.contract) {
    const bytes = baseFile(root, head, basis.contract);
    if (!bytes.toString('utf8').trim()) throw new Error('기준 정본이 비었습니다.');
    return { contract: basis.contract, sha256: hash(bytes) };
  }
  const result = runLab(root, head, imageId(root, basis.image), basis.command, undefined,
{ reportInput: { head, scope } });
  if (result.exitCode !== 0) throw new Error('특성화 관측기가 기준 커밋에서 실패했습니다.');
  const snapshot = json(result.stdout, '특성화 관측');
  if (!Array.isArray(snapshot?.cases) || !snapshot.cases.length ||
      !snapshot.cases.every(c => c && Object.hasOwn(c, 'input') && Object.hasOwn(c, 'output')) ||
      !Array.isArray(snapshot.signatures) || !snapshot.signatures.every(hasText)) {
    throw new Error('특성화 관측에 실제 입출력 사례와 공개 시그니처 목록이 필요합니다.');
  }
  return snapshot;
}

export async function dispatch(root) {
  const ledger = await latest(root);
  if (!ledger) throw new Error('먼저 고스플란 원장을 준비하세요.');
  const task = ledger.tasks.find(t => t.state !== 'DONE');
  if (!task || task.state !== 'PENDING') throw new Error('새 배차를 허용할 선두 태스크가 없습니다.');
  if (gitText(root, ['rev-parse', ledger.ref]) !== ledger.head) throw new Error('승인한 기준 커밋이 이동했습니다.');
  const source = recordDir(root, ledger.inputRevision);
  const inputs = {};
  for (const [name, digest] of Object.entries(ledger.digests)) {
    inputs[name] = await controlFile(source, name);
    if (hash(inputs[name]) !== digest) throw new Error('봉인한 입력이 변경되었습니다 · ' + name);
  }
  const raw = inputs['orders.md'].subarray(task.start, task.end);
  if (hash(raw) !== task.rawHash) throw new Error('원문 구간이 원장과 다릅니다.');
  const policy = validateGost(json(inputs['gost.json'], 'gost.json'));
  const scope = validateScope(json(inputs['scope.json'], 'scope.json')[task.id], policy);
  const basis = json(inputs['basis.json'], 'basis.json');
  const protectedHashes = Object.create(null);
  for (const path of policy.protected_paths) {
    const rows = linesAt(root, ledger.head, path);
    if (!rows.length) throw new Error('잠글 보호 파일이 없습니다 · ' + path);
    for (const row of rows) protectedHashes[row.path] = hash(git(root, ['cat-file', 'blob', row.oid]));
  }
  for (const path of scope.write) verifyTarget(root, ledger.head, path);
  for (const path of scope.read) baseFile(root, ledger.head, path);
  const fixtures = Object.fromEntries(scope.snapshots.map(path => [path, hash(baseFile(root, ledger.head, path))]));
  const baseline = observe(root, ledger.head, basis, scope);
  const files = { 'raw_order.txt': raw, 'scope.json': JSON.stringify(scope), 'gost.json': inputs['gost.json'],
    'protected_hashes.json': JSON.stringify(protectedHashes), 'baseline.json': JSON.stringify({ baseline, fixtures }) };
  const lockHashes = Object.fromEntries(Object.entries(files).map(([name, data]) => [name, hash(data)]));
  Object.assign(task, { state: 'IN_PROGRESS', attempt: task.attempt + 1, head: ledger.head, lockHashes,
    token: randomUUID(), lockRevision: ledger.revision + 1, lockHash: hash(JSON.stringify(lockHashes)) });
  const locks = Object.fromEntries(Object.entries(files).map(([name, bytes]) => ['lock/' + task.id + '/' + name, bytes]));
  if (gitText(root, ['rev-parse', ledger.ref]) !== ledger.head) throw new Error('관측 도중 기준 커밋이 변경되었습니다.');
  await publish(root, ledger, locks);
  return { id: task.id, state: task.state, attempt: task.attempt, lockHash: task.lockHash, lock: taskLock(root, task) };
}

export async function gosplan(root, action, control) {
  if (action === 'prepare' && control) return prepare(root, control);
  if (action === 'dispatch' && !control) return dispatch(root);
  if (action === 'status' && !control) {
    const ledger = await latest(root);
    if (!ledger) throw new Error('아직 고스플란 원장이 없습니다.');
    return ledger;
  }
  throw new Error('gosplan <Git 루트> prepare <지시 폴더> | dispatch | status');
}
