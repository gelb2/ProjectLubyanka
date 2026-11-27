import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

const reviewFields = { oracle: '정답지', selfCritique: '자아비판문' };
const codeReviewResults = new Map([
  ['fixed', '결함 수정'],
  ['no-fix-found', '재검토 후 수정할 코드 미입증'],
  ['pending', '미해결'],
  ['not-applicable', '소스코드 검토 대상 없음'],
]);

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function resolveDocument(root, name) {
  if (!hasText(name) || isAbsolute(name) || name.split(sep).includes('..') || ['.', '..'].includes(basename(name))) {
    throw new Error('문서는 프로젝트 내부 상대 경로로 지정해야 합니다.');
  }
  const parent = await realpath(join(root, dirname(name)));
  const within = relative(root, parent);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error('문서는 프로젝트 내부에 있어야 합니다.');
  }
  const path = join(parent, basename(name));
  return { path, name: relative(root, path) };
}

export async function resolveDocuments(root, oraclePath, critiquePath, procedureName) {
  const oracle = await resolveDocument(root, oraclePath);
  const selfCritique = await resolveDocument(root, critiquePath);
  if (new Set([oracle.name, selfCritique.name, procedureName]).size !== 3) {
    throw new Error('정답지, 자아비판문, 작성 절차는 서로 다른 파일이어야 합니다.');
  }
  return { oracle, selfCritique };
}

export async function readRegularFile(path, name) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat({ bigint: true });
    if (!info.isFile()) throw new Error(`${name}은 일반 파일이어야 합니다.`);
    return { content: await file.readFile(), identity: `${info.dev}:${info.ino}` };
  } catch (error) {
    if (error.code === 'ELOOP') throw new Error(`${name}은 일반 파일이어야 합니다.`);
    throw error;
  } finally {
    await file?.close();
  }
}

async function readDocuments(documents) {
  const snapshots = {};
  for (const [field, label] of Object.entries(reviewFields)) {
    const { name, path } = documents[field];
    const { content, identity } = await readRegularFile(path, name);
    if (!hasText(content.toString('utf8'))) throw new Error(`${label} 본문을 확인할 수 없습니다.`);
    snapshots[field] = { content, identity, sha256: createHash('sha256').update(content).digest('hex') };
  }
  if (snapshots.oracle.identity === snapshots.selfCritique.identity) {
    throw new Error('정답지와 자아비판문은 서로 다른 파일이어야 합니다.');
  }
  return snapshots;
}

export async function start(root, documents, reviewPath, created, inspectOracle, { quiet = false } = {}) {
  const before = {};
  const review = {
    instruction: '',
    codeReview: { result: '', source: '', argument: '', verification: '', reread: '' },
    remaining: [],
  };
  const snapshots = await readDocuments(documents);
  const issues = inspectOracle(documents.oracle.name, snapshots.oracle.content);
  for (const field of Object.keys(reviewFields)) {
    const document = documents[field];
    const { sha256 } = snapshots[field];
    before[field] = { name: document.name, sha256, created: created.has(document.name) };
    review[field] = { status: '', summary: '', evidence: '' };
  }
  const record = { version: 1, root, before, review };
  await writeFile(reviewPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  if (quiet) return;
  for (const issue of issues ?? []) console.error(`정답지 미판정 · ${issue}`);
  for (const [field, label] of Object.entries(reviewFields)) {
    console.log(`${label} 전문 읽기 · ${documents[field].path}`);
  }
  console.log(`작업 검토 · ${reviewPath}`);
}

function validateReview(record, root) {
  if (record?.version !== 1 || record.root !== root || !record.before) {
    throw new Error('이 프로젝트의 start에서 생성한 작업 검토 파일이 필요합니다.');
  }
  const { review } = record;
  if (!hasText(review?.instruction) || !Array.isArray(review?.remaining) || !review.remaining.every(hasText)) {
    throw new Error('review에 적용한 사용자 지시와 남은 항목 배열을 기록해야 합니다.');
  }
  for (const [field, label] of Object.entries(reviewFields)) {
    const before = record.before[field];
    const note = review[field];
    if (!hasText(before?.name) || typeof before.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(before.sha256) ||
        typeof before.created !== 'boolean') {
      throw new Error(`${label}의 착수 기록을 확인할 수 없습니다.`);
    }
    if (!['updated', 'retained'].includes(note?.status) || !hasText(note.summary) || !hasText(note.evidence)) {
      throw new Error(`${label}의 수정·유지 상태와 변경 내용 또는 유지 이유, 확인 근거를 기록해야 합니다.`);
    }
  }
}

function readCodeReview(review) {
  const { result, source = '', argument = '', verification = '', reread = '' } = review.codeReview ?? {};
  if (!codeReviewResults.has(result) || ![source, argument, verification, reread].every(value => typeof value === 'string')) {
    throw new Error('review.codeReview에 코드 검토 결과와 근거를 기록해야 합니다. 작성 절차를 확인하세요.');
  }
  if (result === 'no-fix-found' && !hasText(reread)) {
    throw new Error('고칠 코드가 없어 보이면 이번 자아비판이 잘못됐다고 간주합니다. 자아비판문 전문을 다시 읽고 다른 입력이나 관측으로 재검토한 내용을 기록하세요.');
  }
  if (['fixed', 'no-fix-found'].includes(result) && ![source, argument, verification].every(hasText)) {
    throw new Error('외부 베스트 프랙티스의 출처, 기존 코드와 대조한 논증, 실제 재검증 결과를 기록해야 합니다.');
  }
  if (['no-fix-found', 'pending'].includes(result) && (!hasText(argument) || review.remaining.length === 0)) {
    throw new Error('미입증 범위 또는 미해결 이유와 남은 확인을 기록해야 합니다.');
  }
  if (result === 'not-applicable' && !hasText(argument)) {
    throw new Error('소스코드가 검토 대상에 포함되지 않는 이유를 기록해야 합니다.');
  }
  return { result, source, argument, verification, reread };
}

export async function finish(root, reviewPath, json, procedureName, inspectOracle, validatedEvidence, record) {
  const managed = record !== undefined;
  if (!record) {
    const { content: raw } = await readRegularFile(reviewPath, '작업 검토 파일');
    try {
      record = JSON.parse(raw);
    } catch {
      throw new Error('작업 검토 파일을 JSON으로 읽을 수 없습니다.');
    }
  }
  validateReview(record, root);
  const { before, review } = record;
  const documents = await resolveDocuments(root, before.oracle.name, before.selfCritique.name, procedureName);
  const snapshots = await readDocuments(documents);
  const codeReview = readCodeReview(review);
  const report = { instruction: review.instruction, codeReview, documents: {}, remaining: review.remaining };
  if (validatedEvidence) report.verification = validatedEvidence;
  for (const [field, label] of Object.entries(reviewFields)) {
    const document = documents[field];
    const { content, sha256 } = snapshots[field];
    const changed = sha256 !== before[field].sha256;
    const { status, summary, evidence } = review[field];
    if (changed !== (status === 'updated')) {
      throw new Error(`${label}의 기록과 실제 변경 여부가 다릅니다. 저장된 문서와 작업 검토를 대조하세요.`);
    }
    if (field === 'oracle') report.oracleIssues = inspectOracle(document.name, content);
    report.documents[field] = { path: document.name, created: before[field].created, status, summary, evidence };
  }

  if (managed) return report;
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const lines = ['작업 종료 문서 검토', `적용한 사용자 지시 · ${report.instruction}`];
  lines.push(`- 코드 검토 · ${codeReviewResults.get(codeReview.result)}`, `  판단 근거 · ${codeReview.argument}`);
  if (hasText(codeReview.source)) lines.push(`  외부 출처 · ${codeReview.source}`);
  if (hasText(codeReview.reread)) lines.push(`  재독 · ${codeReview.reread}`);
  if (hasText(codeReview.verification)) lines.push(`  확인 결과 · ${codeReview.verification}`);
  for (const [field, label] of Object.entries(reviewFields)) {
    const { path, created, status, summary, evidence } = report.documents[field];
    const statusText = status === 'updated' ? '수정' : '유지';
    lines.push(`- ${label} · ${created ? '착수 때 생성 · ' : ''}${statusText} · ${path}`, `  ${summary}`, `  근거 · ${evidence}`);
  }
  for (const issue of report.oracleIssues ?? []) lines.push(`- 정답지 미판정 · ${issue}`);
  for (const item of report.remaining) lines.push(`- 남은 확인 · ${item}`);
  console.log(lines.join('\n'));
}
