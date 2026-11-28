import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, gitText } from './lab.mjs';
import { readRegularFile, resolveDocument } from './lifecycle.mjs';

export const configName = 'lubyanka.json';
export const managedMarker = '<!-- lubyanka-managed -->';
const defaultConfig = {
  schemaVersion: 1,
  integrationBranch: 'dev',
  image: '',
  contract: 'LUBYANKA-CONTRACT.md',
  oracle: 'lubyanka-oracle.json',
  selfCritique: 'LUBYANKA-SELF-CRITIQUE.md',
  pathCritiques: [],
  reviewPlan: [],
  reportReview: [],
  checks: { plan: [], feature: [], merge: [] },
};

export function json(content, label) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label}을 JSON으로 읽을 수 없습니다.`);
  }
}

export function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function stateDir(root) {
  const actual = gitText(root, ['rev-parse', '--show-toplevel']);
  if (actual !== root) throw new Error('Git 저장소의 루트 경로를 지정하세요.');
  return join(gitText(root, ['rev-parse', '--absolute-git-dir']), 'lubyanka');
}

async function create(path, value) {
  try {
    await writeFile(path, value, { flag: 'wx', mode: 0o644 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

async function getDoc(root, name) {
  const file = await resolveDocument(root, name);
  const data = await readRegularFile(file.path, file.name);
  const content = data.content.toString('utf8');
  if (!hasText(content)) throw new Error(`${name}이 비어 있습니다.`);
  return { path: file.name, content, sha256: hash(data.content) };
}

async function configFor(root) {
  const file = await getDoc(root, configName);
  const config = json(file.content, configName);
  if (config?.schemaVersion !== 1 || !hasText(config.integrationBranch) ||
      config.integrationBranch.startsWith('-') || !Array.isArray(config.pathCritiques) ||
      !config.pathCritiques.every(hasText) || !hasText(config.oracle) || !config.oracle.endsWith('.json') ||
      !hasText(config.contract) || !hasText(config.selfCritique)) {
    throw new Error(`${configName}의 구조 또는 문서 경로가 유효하지 않습니다.`);
  }
  gitText(root, ['check-ref-format', `refs/heads/${config.integrationBranch}`]);
  return { file, config };
}

async function agents(root) {
  const file = join(root, 'AGENTS.md');
  await create(file, '# 프로젝트 지침\n');
  const { content } = await readRegularFile(file, 'AGENTS.md');
  if (content.toString('utf8').includes(managedMarker)) return;
  const handle = await open(file, constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW);
  try {
    await handle.writeFile([
      '', managedMarker, '## 루비얀카와 샤라시카',
      '모든 지시·질문에서 `lubyanka begin`이 전달한 자아비판문 전문과 정본문서·정답지를 읽는다.',
      '계획을 세우고 `plan`과 `verify plan`을 통과한 뒤 구현한다. 커밋 전 `verify feature`, 병합 전 `verify merge`를 실행한다.',
      '보고 전에 직접 수정·재검증한다. `finish`에서 현재 후보의 주장·원본 증거·독립 판정을 확인한다. 미통과나 문서 변경 때 전문을 재독한다.', '',
    ].join('\n'));
  } finally {
    await handle.close();
  }
}

export async function adopt(root) {
  const dir = stateDir(root);
  return withLock(dir, async () => {
    await create(join(root, configName), JSON.stringify(defaultConfig, null, 2) + '\n');
    const { config } = await configFor(root);
    const contract = await resolveDocument(root, config.contract);
    await create(contract.path, '# 프로젝트 정본\n\n<!-- lubyanka-contract-pending -->\n사용자 요구, 보존 범위와 독립 근거를 기입한다.\n');
    const scaffold = new URL('./oracle.mjs', import.meta.url);
    const result = command(process.execPath, [
      fileURLToPath(scaffold), 'init', root, '--oracle', config.oracle,
      '--self-critique', config.selfCritique,
    ], root);
    if (result.status !== 0) throw new Error(result.stderr.toString().trim());
    await agents(root);
    return { status: 'adopted', configuration: configName, pending: '사용자 요구와 시험 기준을 기입하고 시작하세요.' };
  });
}

export function projectOracle(manifest, profile) {
  if (profile === undefined) return manifest;
  const scoped = manifest.executionProfiles?.[profile];
  if (!Object.hasOwn(manifest.executionProfiles ?? {},profile) || !Array.isArray(scoped?.requirements) || !scoped.requirements.length) {
    throw new Error('등록된 실행 정답 범위가 필요합니다.');
  }
  return {schemaVersion:manifest.schemaVersion,requirements:scoped.requirements};
}

export async function readProject(root) {
  const { file, config } = await configFor(root);
  const [instructions, contract, oracle, ...critique] = await Promise.all([
    getDoc(root, 'AGENTS.md'), getDoc(root, config.contract), getDoc(root, config.oracle),
    ...[config.selfCritique, ...config.pathCritiques].map(path => getDoc(root, path)),
  ]);
  const policies = await Promise.all([config.methodAudit, config.scenarioInventory]
    .filter(path => path !== undefined).map(path => getDoc(root, path)));
  const all = [file, instructions, contract, oracle, ...critique, ...policies];
  if (new Set(all.map(item => item.path)).size !== all.length) throw new Error('필수 문서는 각기 다른 파일이어야 합니다.');
  if (!instructions.content.includes(managedMarker)) throw new Error('AGENTS.md의 루비얀카 절차를 복구하세요.');
  return {
    config, instructions, contract, oracle, critique,
    manifest: projectOracle(json(oracle.content, oracle.path), config.oracleProfile),
    hashes: Object.fromEntries(all.map(item => [item.path, item.sha256])),
  };
}

export async function withLock(dir, action) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, 'lock');
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('다른 검증이 진행 중입니다. 중단된 작업의 lock은 소유 프로세스를 확인한 뒤 정리하세요.');
    throw error;
  }
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function loadState(dir) {
  try {
    return json(await readFile(join(dir, 'task.json')), '작업 상태');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('begin으로 자아비판문 전문부터 읽으세요.');
    throw error;
  }
}

export async function save(dir, name, value) {
  const dest = join(dir, name);
  const temp = `${dest}.new`;
  const content = JSON.stringify(value, null, 2) + '\n';
  await writeFile(temp, content, { mode: 0o600 });
  await rename(temp, dest);
  return hash(content);
}
