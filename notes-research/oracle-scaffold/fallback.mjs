import { readFile } from 'node:fs/promises';

import { latest, publish } from './gosplan.mjs';
import { git, gitText } from './lab.mjs';
import { hash } from './project.mjs';
import { lockedPacket } from './worker.mjs';
import { signedRows } from './politruk.mjs';
import { otherProvider } from './provider.mjs';

const bans = {
  BUILD:'앞서 실패한 빌드 경로를 그대로 제출하지 않는다.', ORACLE:'등록한 실제 동작 검사를 빠뜨리지 않는다.',
  TAMPER:'보호 파일과 허용 범위 밖 경로를 수정하지 않는다.', ANTI_CHEAT:'시험을 약화하거나 금지 패턴을 추가하지 않는다.',
  METRICS:'등록한 런타임 수치 범위를 지킨다.', SCOPE_SHRINK:'원문에서 지정한 동작을 축소하지 않는다.',
  MISSING_REQ:'누락으로 반려된 원문 요구를 구현한다.', REGRESSION:'기존 공개 계약을 보존한다.',
  OVERREACH:'원문과 쓰기 범위 밖 변경을 제출하지 않는다.', CHEAT:'특정 시험값 전용 처리를 금지한다.',
  VISUAL_DRIFT:'동결한 시각 기준에 맞춘다.',
};

export function antiPrior(attempt,row) {
  const code = row.category ?? row.stage;
  if (!Object.hasOwn(bans,code)) throw new Error('미등록 실패 유형');
  // Model explanations may quote source or raw logs. Carry a coordinate, never the explanation.
  const location = /^([^\s:]{1,150}):(\d{1,8}(?:,\d{1,8})?)(?:\s|$)/u.exec(row.evidence ?? '');
  const measured = /^관측 불일치 · ([A-Za-z0-9_.-]{1,64}) 실측 (-?\d+(?:\.\d+)?)$/u.exec(row.evidence ?? '');
  const coordinate = location ? location[1] + ':' + location[2] : measured ? measured[1] + '=' + measured[2] : code;
  return {attempt,rejected_prior:code,refutation_evidence:coordinate,hard_ban:bans[code]};
}

async function quarantine(root,ledger,task,reason) {
  task.state = 'QUARANTINED';
  task.hold = reason;
  await publish(root,ledger);
  return {status:'pending',state:task.state,id:task.id,reason};
}

function clearRun(task) {
  for (const key of ['worker','voenpred','politruk','winner','offer','approval']) delete task[key];
}

export async function retry(root) {
  const ledger = await latest(root);
  const task = ledger?.tasks.find(t=>t.state !== 'DONE');
  if (!task || !['IN_PROGRESS','VOENPRED_PASS'].includes(task.state)) throw new Error('반려 처리할 시도가 없습니다.');
  if (task.worker?.status === 'FAILED') return quarantine(root,ledger,task,'워커 실행 실패');
  if (task.politruk?.status === 'RUNNING' || !task.voenpred) throw new Error('검측 또는 감찰이 끝나지 않았습니다.');
  const previous = await lockedPacket(root,task);
  const rows = task.politruk ? await signedRows(root,task.politruk,'politruk_verdict.json') : await signedRows(root,task.voenpred,'voenpred_report.json');
  if (!rows.length || rows.some(r=>r.verdict !== 'REJECT')) throw new Error('모든 대상 후보가 반려되어야 재시도할 수 있습니다.');
  if (rows.some(r=>!Object.hasOwn(bans,r.category ?? r.stage))) return quarantine(root,ledger,task,'판정 불능 또는 실행 환경 오류');
  const row = rows[0];
  const candidates = task.worker.candidates;
  if (rows.length === 1 && row.stage === 'BUILD' && row.localBuild && !task.patchUsed) {
    task.patchUsed = true;
    task.patchTree = candidates[0].tree;
    task.patchRef = candidates[0].id;
    task.patchReason = row.evidence;
    clearRun(task);
    await publish(root,ledger);
    return {status:'patch',id:task.id,attempt:task.attempt};
  }
  const priors = [...(previous['anti_priors.json'] ?? []),antiPrior(task.attempt,row)];
  const body = JSON.stringify(priors);
  const preferred = candidates[0].provider;
  if (['codex','claude'].includes(preferred)) task.preferred = task.attempt >= 2 ? otherProvider(preferred) : preferred;
  task.priorRecord = {revision:ledger.revision+1,digest:hash(body)};
  task.state = 'PURGING';
  task.obsolete = [...new Set([...(task.obsolete ?? []),...candidates.map(c=>c.id),...(task.patchRef ? [task.patchRef] : [])])];
  clearRun(task);
  for (const key of ['patchRef','patchTree','patchReason']) delete task[key];
  const updated = await publish(root,ledger,{'anti_priors.json':body});
  try {
    for (const id of task.obsolete) git(root,['update-ref','-d','refs/lubyanka/candidates/' + id]);
  } catch {
    return quarantine(root,updated,task,'폐기 후보 정리 실패');
  }
  task.state = priors.length >= 3 ? 'QUARANTINED' : 'PURGED';
  await publish(root,updated);
  return {status:task.state === 'QUARANTINED' ? 'pending' : 'purged',state:task.state,id:task.id,priors};
}

function currentRef(root) {
  return gitText(root,['symbolic-ref','HEAD']);
}

export async function settle(root,action,approvalFile) {
  const ledger = await latest(root);
  if (!ledger) throw new Error('원장이 없습니다.');
  const task = ledger.tasks.find(t=>t.state !== 'DONE');
  if (!task && action === 'integrate') return {status:'done',head:ledger.head};
  if (task?.state !== 'POLITRUK_PASS') throw new Error('양쪽 판정이 필요한 작업입니다.');
  if (currentRef(root) !== ledger.ref || ledger.ref === 'refs/heads/main') throw new Error('배차된 작업 브랜치에서 실행하세요. main은 배포 승격 절차를 사용합니다.');
  const locked = await lockedPacket(root,task);
  const candidate = task.worker.candidates.find(c=>c.id === task.winner);
  const signed = await signedRows(root,task.politruk,'politruk_verdict.json');
  const measured = await signedRows(root,task.voenpred,'voenpred_report.json');
  const valid = row => row.verdict === 'PASS' && row.target.tree === candidate.tree && row.target.token === task.token &&
    row.target.attempt === task.attempt && row.target.lockHash === task.lockHash && row.target.head === task.head;
  if (!signed.some(row=>valid(row) && row.id === candidate.id && ['codex','claude'].includes(row.provider)) || !measured.some(valid) ||
      gitText(root,['rev-parse','refs/lubyanka/candidates/' + candidate.id]) !== candidate.tree) throw new Error('같은 후보의 두 판정이 필요합니다.');
  const config = locked['checks.json'];
  const high = config.risk === 'high' || locked['scope.json'].write.some(path=>/(?:^|[/. _-])(?:auth|permissions?|billing|payments?|migrations?|deploy)(?:[/. _-]|$)/iu.test(path));
  const permit = {task:task.id,token:task.token,tree:candidate.tree};
  if (action === 'approve') {
    const approval = JSON.parse(await readFile(approvalFile,'utf8'));
    if (!Object.entries(permit).every(([k,v])=>approval[k] === v) || approval.decision !== 'APPROVE') throw new Error('현재 후보를 지정한 사용자 승인이 필요합니다.');
    task.approval = permit;
    await publish(root,ledger);
    return {status:'approved',...permit};
  }
  if (high && task.approval?.tree !== candidate.tree) return {status:'pending',reason:'고위험 사용자 승인 대기',...permit};
  const head = gitText(root,['rev-parse',ledger.ref]);
  if (task.offer && head === task.offer.merge) {
    if (gitText(root,['show','-s','--format=%P',head]) !== task.head + ' ' + task.offer.proposal ||
        gitText(root,['rev-parse',head + '^{tree}']) !== candidate.tree) throw new Error('병합 부모 또는 트리 불일치');
    ledger.head = head;
    task.state = 'DONE';
    task.merged = head;
    await publish(root,ledger);
    for (const c of task.worker.candidates) git(root,['update-ref','-d','refs/lubyanka/candidates/'+c.id]);
    if (task.patchRef) git(root,['update-ref','-d','refs/lubyanka/candidates/'+task.patchRef]);
    git(root,['update-ref','-d','refs/lubyanka/offers/'+task.token]);
    return {status:'done',id:task.id,head};
  }
  if (head !== task.head) throw new Error('기준 브랜치가 이동했습니다.');
  if (!task.offer) {
    const proposal = gitText(root,['commit-tree',candidate.tree,'-p',head,'-m','Verified proposal ' + task.id]);
    const merge = gitText(root,['commit-tree',candidate.tree,'-p',head,'-p',proposal,'-m','Integrate verified ' + task.id]);
    task.offer = {proposal,merge};
    await publish(root,ledger);
    git(root,['update-ref','refs/lubyanka/offers/' + task.token,merge]);
    if (action === 'offer') return {status:'ready',...task.offer};
    return settle(root,'integrate');
  }
  if (action === 'offer') return {status:'ready',...task.offer};
  if (gitText(root,['status','--porcelain']) || gitText(root,['rev-parse','--verify','HEAD']) !== task.head) throw new Error('기존 작업을 보존하기 위해 깨끗한 작업 트리가 필요합니다.');
  git(root,['merge','--ff-only',task.offer.merge]);
  return settle(root,'integrate');
}

export async function recover(root) {
  const ledger = await latest(root);
  const task = ledger?.tasks.find(t=>t.state !== 'DONE');
  if (!task || task.state === 'QUARANTINED' || !(task.state === 'PURGING' || task.worker?.status === 'RUNNING' || task.politruk?.status === 'RUNNING')) throw new Error('회수할 실행 예약이 없습니다.');
  return quarantine(root,ledger,task,'관리자가 중단된 실행 예약을 회수했습니다.');
}
