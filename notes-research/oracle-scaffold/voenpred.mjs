import { isDeepStrictEqual } from 'node:util';
import { baseFile, latest, observe, publish } from './gosplan.mjs';
import { git, gitText, runLab } from './lab.mjs';
import { hash, hasText, json } from './project.mjs';
import { lockedPacket } from './worker.mjs';

function changes(root, base, tree) {
  const entries = git(root, ['diff','--no-ext-diff','--no-renames','--raw','-z',base,tree,'--']).toString().split('\0');
  const rows = [];
  for (let i = 0; i < entries.length - 1; i += 2) {
    const [before, after] = entries[i].slice(1).split(' ');
    rows.push({ path:entries[i+1], before, after });
  }
  return rows;
}

function checkTamper(root, task, candidate, locked) {
  if (candidate.head !== task.head || candidate.attempt !== task.attempt || candidate.lockHash !== task.lockHash ||
      gitText(root, ['rev-parse','refs/lubyanka/candidates/' + candidate.id]) !== candidate.tree) throw new Error('후보·잠금·시도 결합이 다릅니다.');
  for (const [path, expected] of Object.entries({...locked['protected_hashes.json'], ...locked['baseline.json'].fixtures})) {
    if (hash(baseFile(root,candidate.tree,path)) !== expected) throw new Error(path + ':1 보호 파일 변경');
  }
  const rows = changes(root, task.head, candidate.tree);
  if (!rows.length) throw new Error('검사할 변경 파일이 없습니다.');
  for (const row of rows) {
    if (!locked['scope.json'].write.includes(row.path) || ![row.before,row.after].every(m => ['000000','100644','100755'].includes(m)) ||
        (row.before !== '000000' && row.after !== '000000' && row.before !== row.after)) throw new Error(row.path + ':1 허용 경로·모드 이탈');
  }
  return rows;
}

function checkPatterns(root, head, tree, rows, policy) {
  const forbidden = /(?:catch\s*(?:\([^)]*\))?\s*\{\s*\}|@ts-(?:ignore|nocheck)|eslint-disable|#\s*noqa\b|\b(?:test|it|describe)\.skip\b|\b(?:xit|xtest|xdescribe)\s*\()/u;
  for (const {path} of rows) {
    const diff = git(root,['--literal-pathspecs','diff','--no-ext-diff','--no-textconv','--no-renames','-U0',head,tree,'--',path]).toString('utf8');
    let line = 0, inHunk = false, added = '';
    const flush = () => {
      if (forbidden.test(added) || policy.forbidden_shortcuts.some(shortcut => added.includes(shortcut))) throw new Error(path + ':' + Math.max(1,line) + ' 금지 패턴');
      added = '';
    };
    for (const row of diff.split('\n')) {
      if (row.startsWith('@@ ')) {
        flush();
        line = Number(/\+(\d+)/u.exec(row)[1]) - 1;
        inHunk = true;
      } else if (inHunk && row.startsWith('+')) {
        line++;
        added += row.slice(1) + '\n';
        if (forbidden.test(added)) flush();
      } else if (inHunk && row.startsWith('-') && /(?:^|[./_-])(?:tests?|specs?)(?:[./_-]|$)/iu.test(path) && /\b(?:assert|expect)\b/u.test(row)) {
        throw new Error(path + ':' + Math.max(1,line + 1) + ' 시험 단언 삭제');
      }
    }
    flush();
  }
}

function measure(root, tree, config, rule) {
  if (!rule || !Array.isArray(rule.command) || !rule.expected || Array.isArray(rule.expected) || !Object.keys(rule.expected).length) throw new Error('등록한 관측 기준이 비었습니다.');
  const run = runLab(root,tree,config.image,rule.command);
  if (run.exitCode !== 0) throw new Error('관측기 실행 실패 · ' + String(run.exitCode));
  const actual = json(run.stdout,'독립 관측');
  if (!actual || Array.isArray(actual) || !isDeepStrictEqual(Object.keys(actual).sort(),Object.keys(rule.expected).sort())) throw new Error('관측 항목 누락·추가 또는 빈 실측');
  for (const [key, expected] of Object.entries(rule.expected)) {
    const bounded = expected && typeof expected === 'object' && Object.keys(expected).every(k=>['min','max'].includes(k)) && Object.keys(expected).length > 0;
    const ok = bounded ? Object.values(expected).every(Number.isFinite) && Number.isFinite(actual[key]) &&
      actual[key] >= (expected.min ?? -Infinity) && actual[key] <= (expected.max ?? Infinity) : isDeepStrictEqual(actual[key],expected);
    if (!ok) throw new Error('관측 불일치 · ' + key + ' 실측 ' + JSON.stringify(actual[key]).slice(0,100));
  }
  return actual;
}

function regression(root, candidate, locked, checks) {
  if (!locked['characterize.json']) return;
  const baseline = structuredClone(locked['baseline.json'].baseline);
  for (const change of checks.replaceCases ?? []) {
    if (!Number.isInteger(change.index) || !baseline.cases[change.index] || !hasText(change.quote) ||
        !locked['raw_order.txt'].includes(change.quote) || !Object.hasOwn(change,'output')) throw new Error('원문 근거가 없는 특성화 기준 변경');
    baseline.cases[change.index].output = change.output;
  }
  const observed = observe(root,candidate.tree,locked['characterize.json'],locked['scope.json']);
  if (!isDeepStrictEqual(observed,baseline)) throw new Error('특성화 사례 또는 시그니처 회귀');
}

export function inspect(root, task, candidate, locked) {
  const target = { id:task.id, attempt:task.attempt, token:task.token, head:task.head, tree:candidate.tree, lockHash:task.lockHash };
  const observations = {};
  const checks = locked['checks.json'];
  let stage = 'TAMPER', localBuild = false;
  try {
    const rows = checkTamper(root, task, candidate, locked);
    observations.paths = rows.map(row=>row.path);
    stage = 'ANTI_CHEAT';
    checkPatterns(root,task.head,candidate.tree,rows,locked['gost.json']);
    stage = 'BUILD';
    if (!checks?.image || !Array.isArray(checks.build) || !checks.build.length) throw new Error('등록한 독립 빌드 명령이 없습니다.');
    const build = runLab(root,candidate.tree,checks.image,checks.build);
    if (build.exitCode !== 0) {
      const code = build.stderr.match(/\b(?:SyntaxError|TS2304|TS2307|TS1005)\b/gu) ?? [];
      localBuild = code.length === 1 && build.exitCode === 1;
      throw new Error('빌드 실패 · ' + (localBuild ? code[0] : build.exitCode));
    }
    observations.build = build.exitCode;
    stage = 'ORACLE';
    observations.oracle = measure(root,candidate.tree,checks,checks.oracle);
    regression(root,candidate,locked,checks);
    if (checks.metrics) {
      stage = 'METRICS';
      observations.metrics = measure(root,candidate.tree,checks,checks.metrics);
    }
    return {target,verdict:'PASS',observations};
  } catch (error) {
    return {target,verdict:'REJECT',stage,localBuild,evidence:error.message.split(/\r?\n/u)[0].slice(0,400),observations};
  }
}

export async function voenpred(root) {
  const ledger = await latest(root);
  const task = ledger?.tasks.find(t=>t.state !== 'DONE');
  if (task?.state !== 'IN_PROGRESS' || task.worker?.status !== 'PROPOSED' || task.voenpred) throw new Error('검측할 신규 후보가 없습니다.');
  if (gitText(root,['rev-parse',ledger.ref]) !== task.head) throw new Error('기준 커밋이 이동했습니다.');
  const locked = await lockedPacket(root,task);
  const reports = task.worker.candidates.map(candidate => inspect(root,task,candidate,locked));
  const pass = reports.some(r=>r.verdict === 'PASS');
  if (pass) task.state = 'VOENPRED_PASS';
  task.voenpred = { revision:ledger.revision + 1, digest:hash(JSON.stringify(reports)) };
  await publish(root,ledger,{ 'voenpred_report.json':JSON.stringify(reports) });
  return { status:pass ? 'pass' : 'fail', reports };
}
