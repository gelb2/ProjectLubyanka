import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = path => readFileSync(path,'utf8');
const fromInput = () => JSON.parse(readFileSync(0,'utf8'));
const mode = process.argv[2];
const runner = {
  'PRODUCER-RAW':'notes-research/manuscripts/README.md',
  'PRODUCER-UNIT':'notes-research/oracle-scaffold/package.json',
};
let output;
if (mode === 'measure') {
  const entries = [...read(runner['PRODUCER-RAW']).matchAll(/originals\/(\d{4})\/chat\.txt\).*?\x60([a-f0-9]{64})\x60/gu)];
  const intact = entries.filter(([_,id,digest])=>createHash('sha256').update(readFileSync('notes-research/manuscripts/originals/'+id+'/chat.txt')).digest('hex') === digest);
  const unit = spawnSync('npm',['test','--offline'],{cwd:'notes-research/oracle-scaffold',encoding:'utf8',timeout:90000});
  const count = /^# pass (\d+)$/mu.exec(unit.stdout ?? '');
  if (unit.status !== 0 || !count || !/^# fail 0$/mu.test(unit.stdout)) throw new Error('실제 패키지 회귀 시험 실패');
  output = {'PRODUCER-RAW':new Set(intact.map(e=>e[1])).size,'PRODUCER-UNIT':Number(count[1])};
} else if (mode === 'method') {
  const {contract,oracle,critique,basis}=fromInput();
  const ok = contract.content.includes('실제') && basis.incidents.every(i=>critique.some(c=>c.content.includes(i.technicalCause))) &&
    oracle.requirements.every(r=>runner[r.requirementId] && read(runner[r.requirementId]).trim() && r.inputs && r.requiredEvidence.length);
  output={accepted:ok,reasons:[ok?'원본 접수 기록·시험 명령과 실제 실패 사례를 대조했다.':'생산자 검증 출처 또는 기록이 누락됐다.']};
} else if (mode === 'plan') {
  const plan=JSON.parse(process.env.LUBYANKA_PLAN_JSON);
  const decisions=plan.decisions;
  const ok=Array.isArray(plan.coverage) && plan.coverage.length && decisions.every(d=>
    runner[d.id] && d.decision.includes(runner[d.id]) && typeof d.falsifier === 'string' &&
    d.falsifier.trim().length && plan.coverage.some(c=>c.ids.includes(d.id))) &&
    plan.coverage.every(c=>c.quote.trim() && plan.instruction.includes(c.quote) &&
      c.ids.every(id=>decisions.some(d=>d.id === id && d.orderQuote === c.quote)));
  output={accepted:Boolean(ok),coverage:ok?plan.coverage:[],reasons:[ok?'원문별 결정·실행 대상·기각 조건을 대조했다.':'원문 구절과 시험 진입점의 연결이 빠졌다.']};
} else if (mode === 'report') {
  const {claims,tree,phase,files,verdict}=fromInput();
  output=claims.map(c=>{
    const row=verdict.results.find(r=>r.id===c.id);
    const ok=row && c.target===phase+':'+tree && c.outcome===(row.status==='pass'?'verified':'failed') &&
      c.statement === c.id+'='+JSON.stringify(row.observed) && c.evidence.some(item=>{
        if (item.kind !== 'measurement') return false;
        const actual=JSON.parse(Buffer.from(files[item.path],'base64').toString());
        return actual.tree===tree && actual.phase===phase && actual.observations?.[c.id]===row.observed;
      });
    return {id:c.id,case:c.case,accepted:Boolean(ok),reason:ok?'같은 트리·단계의 실측과 종료 문구가 일치한다.':'보고와 실측 불일치'};
  });
} else throw new Error('생산자 검증 종류를 지정하세요.');
console.log(JSON.stringify(output));
