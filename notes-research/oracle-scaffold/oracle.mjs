#!/usr/bin/env node
import { lstat, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { findUnresolved } from './engine.mjs';
import { finish, readRegularFile, resolveDocument, resolveDocuments, start } from './lifecycle.mjs';

const manifestName = 'lubyanka-oracle.json';
const procedureName = 'LUBYANKA-ORACLE.md';
const critiqueName = 'LUBYANKA-SELF-CRITIQUE.md';
const initialManifest = {
  schemaVersion: 1,
  requirements: [{
    requirementId: 'REQ-001',
    source: '',
    scope: '',
    inputs: '',
    comparator: '',
    expectedOrRule: '',
    requiredEvidence: [],
    baseline: '',
    unresolved: [],
  }],
};

async function createFile(path, content) {
  try {
    await writeFile(path, content, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  }
}

async function init(root, documents, log) {
  const procedure = await readFile(new URL('./procedure.md', import.meta.url), 'utf8');
  const critique = await readFile(new URL('./self-critique.md', import.meta.url), 'utf8');
  const rules = `${JSON.stringify(initialManifest, null, 2)}\n`;
  const oracle = documents.oracle.name.endsWith('.json')
    ? rules
    : '# 프로젝트 정답지\n\n요구·판정 기준과 독립 근거를 기입한다. 미확인 기준은 미판정으로 남긴다.\n';
  const created = new Set();
  for (const [path, name, content] of [
    [documents.oracle.path, documents.oracle.name, oracle],
    [documents.selfCritique.path, documents.selfCritique.name, critique],
    [join(root, procedureName), procedureName, procedure],
  ]) {
    const isNew = await createFile(path, content);
    if (isNew) created.add(name);
    log(`${isNew ? '생성' : '기존 경로 보존'} ${name}`);
  }
  return created;
}

async function check(root, oraclePath) {
  const { name, path } = await resolveDocument(root, oraclePath);
  if (!name.endsWith('.json')) throw new Error('check는 JSON 정답지를 검사합니다. 그 외 정답지는 직접 검토하세요.');
  const { content } = await readRegularFile(path, name);
  const manifest = parseManifest(content, name);
  const issues = findUnresolved(manifest);
  if (issues.length > 0) {
    console.log(['미판정 · 판정 기준을 보완해야 합니다.', ...issues].join('\n'));
    return 2;
  }
  console.log(`요구 ${manifest.requirements.length}개 기입 확인. 실제 실행과 판정은 별도로 수행합니다.`);
  return 0;
}

function parseManifest(content, name) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${name}을 JSON으로 읽을 수 없습니다.`);
  }
}

function inspectOracle(name, content) {
  return name.endsWith('.json') ? findUnresolved(parseManifest(content, name)) : null;
}

async function main(args) {
  const { positionals, values } = parseArgs({
    args, allowPositionals: true,
    options: {
      oracle: { type: 'string' },
      'self-critique': { type: 'string' },
      json: { type: 'boolean' },
    },
  });
  const [command, path, reviewPath] = positionals;
  const lifecycle = ['start', 'finish'].includes(command);
  if (!['init', 'check', 'start', 'finish'].includes(command) || !path ||
      positionals.length !== (lifecycle ? 3 : 2) ||
      (values.oracle !== undefined && command === 'finish') ||
      (values['self-critique'] !== undefined && !['init', 'start'].includes(command)) ||
      (values.json && command !== 'finish')) {
    throw new Error([
      'lubyanka-oracle <init|check> <프로젝트>',
      'lubyanka-oracle <start|finish> <프로젝트> <작업검토.json>',
      'init·start·check 옵션: --oracle <정답지>',
      'init·start 옵션: --self-critique <자아비판문>',
      'finish 옵션: --json',
    ].join('\n'));
  }
  const root = await realpath(path);
  if (!(await stat(root)).isDirectory()) throw new Error('프로젝트 경로는 디렉터리여야 합니다.');
  const oraclePath = values.oracle ?? manifestName;
  if (command === 'check') return check(root, oraclePath);
  if (command === 'finish') {
    const config = await lstat(join(root, 'lubyanka.json')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (config) throw new Error('도입 프로젝트의 종료 검토에는 lubyanka finish와 샤라시카 실행 기록이 필요합니다.');
    return finish(root, reviewPath, values.json, procedureName, inspectOracle);
  }

  const documents = await resolveDocuments(root, oraclePath, values['self-critique'] ?? critiqueName, procedureName);
  const created = await init(root, documents, command === 'start' ? console.error : console.log);
  if (command === 'start') await start(root, documents, reviewPath, created, inspectOracle);
}

try {
  process.exitCode = (await main(process.argv.slice(2))) ?? 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
