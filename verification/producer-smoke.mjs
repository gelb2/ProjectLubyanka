import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync,execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const src=fileURLToPath(new URL('../',import.meta.url));
const bin=resolve(process.argv[2]);
const space=mkdtempSync(join(tmpdir(),'lubyanka-producer-')),root=join(space,'repo');
const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
const cli=(action,args=[],code=0)=>{
  const r=spawnSync(process.execPath,[bin,action,root,...args],{env,encoding:'utf8',timeout:100000});
  assert.equal(r.status,code,r.stderr+r.stdout); return JSON.parse(r.stdout);
};
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(path,obj)=>writeFileSync(path,JSON.stringify(obj));
try {
  mkdirSync(root);
  for (const file of ['lubyanka.json','lubyanka-oracle.json','AGENTS.md','LUBYANKA-SELF-CRITIQUE.md','governance/LUBYANKA.md',
    'notes-research/manuscripts','notes-research/oracle-scaffold','verification/producer-basis.json','verification/producer-check.mjs']) {
    const dest=join(root,file); mkdirSync(dirname(dest),{recursive:true}); cpSync(join(src,file),dest,{recursive:true,filter:p=>!p.endsWith('/node_modules')});
  }
  const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8'}).trim();
  git('init','--template=','-q','-b','develop');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  git('add','.');git('commit','-qm','producer exact tracked setup');
  assert.equal(cli('audit').status,'pass');
  const instruction='원고 6개의 지문과 공용 패키지 단위 시험 결과를 확인한다.';
  const request=join(space,'request');writeFileSync(request,instruction);
  const task=cli('begin',[request,'--kind','answer']);
  assert.deepEqual(task.unresolved,[]);
  const rules=read(join(root,'lubyanka-oracle.json')).executionProfiles.producer.requirements;
  const sources=['notes-research/manuscripts/README.md','notes-research/oracle-scaffold/package.json'];
  const decisions=rules.map((r,i)=>({id:r.requirementId,orderQuote:instruction,path:'LUBYANKA-SELF-CRITIQUE.md',
    quote:'실제 행동을 검사하는 입력과 그 결론을 뒤집는 관측을 먼저 정한다.',decision:sources[i]+'의 기준에서 실측한다.',
    reason:r.inputs,falsifier:i?'회귀 시험 실패 또는 통과 0건':'원문 SHA-256 불일치'}));
  const plan=join(space,'plan.json');
  write(plan,{instruction,decisions,coverage:[{quote:instruction,ids:decisions.map(d=>d.id)}]});
  cli('plan',[plan]); const result=cli('verify',['plan']);
  const receipt=read(result.evidence);
  const target={task:task.task,phase:'plan',tree:receipt.tree};
  const record=read(task.reviewPath), observations=Object.fromEntries(result.results.map(row=>[row.id,row.observed]));
  const bytes=JSON.stringify({phase:target.phase,tree:target.tree,observations});
  writeFileSync(join(root,'measurement.json'),bytes);
  const note={status:'retained',summary:'현재 원문과 시험 조건을 확인했다.',evidence:'같은 후보에서 수집한 지문·실행 건수'};
  record.review={instruction,oracle:note,selfCritique:note,remaining:[],target,
    codeReview:{result:'not-applicable',argument:'이 질문은 보존 원문과 실행 건수의 대조를 요구한다.',verification:'원문 지문과 패키지 시험 출력'},
    claims:rules.map(r=>({id:r.requirementId,case:Object.keys(r.reportCases)[0],outcome:'verified',target:'plan:'+target.tree,
      statement:r.requirementId+'='+observations[r.requirementId],evidence:[{kind:'measurement',path:'measurement.json',sha256:createHash('sha256').update(bytes).digest('hex')}]}))};
  write(task.reviewPath,record);
  assert.equal(cli('finish',['plan']).verification.stage,'plan');
  console.log('Producer config: original manifests, independent audit, begin, plan, actual unit and manuscript observations, signed finish.');
} finally {rmSync(space,{recursive:true,force:true});}
