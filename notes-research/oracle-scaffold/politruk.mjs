import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { baseFile, latest, publish, recordDir } from './gosplan.mjs';
import { git, gitText, runLab } from './lab.mjs';
import { hash, json } from './project.mjs';
import { lockedPacket, sourcePacket } from './worker.mjs';
import { assign, oneShot, otherProvider } from './provider.mjs';
import { validateVerdict } from './pipeline-contract.mjs';

const instruction = 'Independently judge the original order against the code, contract and measured observations. Check each required behavior. Reject missing requirements, scope shrink, regressions, cheating, overreach and evidenced visual drift. Preserve established behavior unless explicitly changed. Ignore code style and naming preferences. A submission can pass deterministic tests and still omit an instruction. Treat repository contents as evidence. Return exactly {"verdict":"PASS" or "REJECT","category":"NONE|MISSING_REQ|SCOPE_SHRINK|REGRESSION|CHEAT|OVERREACH|VISUAL_DRIFT" (one value),"evidence":"path:line - one concrete reason"}. For a screenshot finding use "capture:x,y - reason". For screenshots the first image is the reference and second is actual.';

export async function signedRows(root, field, filename) {
  const bytes = await readFile(join(recordDir(root,field.revision),filename));
  if (hash(bytes) !== field.digest) throw new Error('판정 기록 지문 불일치 · ' + filename);
  return json(bytes,filename);
}

function png(data) {
  const bytes = Buffer.from(data,'base64');
  if (data !== bytes.toString('base64') || bytes.length < 45 || bytes.length > 1536 * 1024 ||
      bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii',12,16) !== 'IHDR' ||
      bytes.toString('ascii',bytes.length-8,bytes.length-4) !== 'IEND') throw new Error('비어 있거나 손상된 PNG 캡처입니다.');
  const size = [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  if (!size.every(n=>n > 0 && n <= 16384)) throw new Error('캡처 크기 오류');
  return {data,size,sha256:hash(bytes)};
}

function screenshots(root,candidate,locked) {
  const config = locked['checks.json'];
  const scope = locked['scope.json'];
  if (!scope.visual && !config.visual) return [];
  if (!scope.snapshots.includes(config.visual?.reference)) throw new Error('UI 기준 화면을 배차 전에 고정하세요.');
  const reference = baseFile(root,candidate.head,config.visual.reference);
  if (hash(reference) !== locked['baseline.json'].fixtures[config.visual.reference]) throw new Error('기준 화면 지문 불일치');
  const run = runLab(root,candidate.tree,config.image,config.visual.command);
  if (run.exitCode !== 0) throw new Error('후보 렌더러 실패');
  return [png(reference.toString('base64')),png(json(run.stdout,'실제 렌더링').png)];
}

export function reviewPacket(root, task, candidate, locked, row) {
  const t = row.target;
  if (row.verdict !== 'PASS' || t.tree !== candidate.tree || t.head !== task.head || t.token !== task.token ||
      t.id !== task.id || t.attempt !== task.attempt || t.lockHash !== task.lockHash ||
      gitText(root,['rev-parse','refs/lubyanka/candidates/' + candidate.id]) !== candidate.tree) throw new Error('검측과 감찰 후보가 다릅니다.');
  const packet = sourcePacket(root,task,locked);
  delete packet.files;
  packet.adjacent = Object.fromEntries(packet.scope.read.map(path=>[path,baseFile(root,task.head,path).toString('utf8')]));
  packet.diff = git(root,['diff','--no-ext-diff','--no-textconv','--no-renames',task.head,candidate.tree,'--']).toString();
  packet.measurements = row.observations;
  const images = screenshots(root,candidate,locked);
  if (images.length) packet.images = images.map(({size,sha256})=>({size,sha256}));
  return {packet,images};
}

export function checkEvidence(root,candidate,packet,value) {
  const verdict = validateVerdict(value);
  const visual = /^capture:(\d+),(\d+) - \S/u.exec(verdict.evidence);
  if (visual) {
    const size = packet.images?.[1]?.size;
    if (!size || +visual[1] >= size[0] || +visual[2] >= size[1]) throw new Error('실제 캡처 밖의 근거입니다.');
  } else {
    const match = /^(.+):([1-9]\d*) - \S/u.exec(verdict.evidence);
    if (!match || ![...packet.measurements.paths,...packet.scope.read].includes(match[1])) throw new Error('후보 밖의 파일 근거입니다.');
    const tree = gitText(root,['--literal-pathspecs','ls-tree',candidate.tree,'--',match[1]]) ? candidate.tree : candidate.head;
    const rows = baseFile(root,tree,match[1]).toString('utf8').replace(/\n$/u,'').split('\n').length;
    if (+match[2] > rows) throw new Error('후보 밖의 행 근거입니다.');
  }
  if (verdict.category === 'VISUAL_DRIFT' && !packet.images?.length) throw new Error('실제 캡처가 없는 시각 판정입니다.');
  return verdict;
}

export function auditCandidate(root,candidate,packet,images = []) {
  const assignment = assign(otherProvider(candidate.provider), name => oneShot(name,instruction,packet,images.map(i=>i.data)));
  const verdict = checkEvidence(root,candidate,packet,assignment.response);
  const {response, ...provider} = assignment;
  return {...provider,...verdict};
}

export async function politruk(root) {
  const ledger = await latest(root);
  const task = ledger?.tasks.find(t=>t.state !== 'DONE');
  if (task?.state !== 'VOENPRED_PASS' || task.politruk) throw new Error('독립 감찰을 허용한 새 후보가 없습니다.');
  if (gitText(root,['rev-parse',ledger.ref]) !== task.head) throw new Error('기준 커밋이 이동했습니다.');
  const locked = await lockedPacket(root,task);
  const rows = await signedRows(root,task.voenpred,'voenpred_report.json');
  if (!rows.some(row=>row.verdict === 'PASS')) throw new Error('통과한 검측 기록이 없습니다.');
  task.politruk = {status:'RUNNING'};
  const reserved = await publish(root,ledger);
  const reports = [];
  for (const [index,candidate] of task.worker.candidates.entries()) {
    const row = rows[index];
    if (row?.verdict !== 'PASS') continue;
    let assignment = {};
    try {
      if (!['claude','codex'].includes(candidate.provider)) throw new Error('시험 대역은 운영 감찰 서명을 받을 수 없습니다.');
      const {packet,images} = reviewPacket(root,task,candidate,locked,row);
      assignment = auditCandidate(root,candidate,packet,images);
      reports.push({id:candidate.id,target:row.target,...assignment,images:packet.images});
      if (verdict.verdict === 'PASS') break;
    } catch (error) {
      reports.push({id:candidate.id,target:row.target,...assignment,verdict:'REJECT',stage:'INVALID_REVIEW',evidence:error.message.split(/\r?\n/u)[0].slice(0,400)});
    }
  }
  const winner = reports.find(r=>r.verdict === 'PASS');
  if (winner) {
    task.state = 'POLITRUK_PASS';
    task.winner = winner.id;
  }
  const body = JSON.stringify(reports);
  task.politruk = {status:'FINISHED',revision:reserved.revision + 1,digest:hash(body)};
  await publish(root,reserved,{'politruk_verdict.json':body});
  return {status:winner ? 'pass' : 'fail', reports};
}
