import assert from 'node:assert/strict';
import { spawnSync,execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const [entry,image] = process.argv.slice(2);
if (!entry || !image) throw new Error('Provide the installed CLI and local Docker image ID.');
const cliPath=resolve(entry);
const space=mkdtempSync(join(tmpdir(),'lubyanka-live-caption-'));
const root=join(space,'project'), control=join(space,'control');
const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
function run(action,args=[],code=0) {
  const r=spawnSync(process.execPath,[cliPath,action,root,...args],{env,encoding:'utf8',timeout:400000});
  assert.ifError(r.error); assert.equal(r.status,code,r.stderr+r.stdout); return r.stdout?JSON.parse(r.stdout):{};
}
const write=(name,obj)=>writeFileSync(join(control,name),JSON.stringify(obj));
const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8'}).trim();
try {
  mkdirSync(root);mkdirSync(control);
  git('init','-q','-b','develop');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
  writeFileSync(join(root,'store.cjs'),"let caption=null; exports.save=(path,v)=>{caption=v}; exports.load=path=>caption;\n");
  writeFileSync(join(root,'ui.cjs'),"exports.display=path=>'';\n");
  writeFileSync(join(root,'contract.md'),"CommonJS. save(path,caption), load(path) and display(path) are synchronous. A caption is a UTF-8 string. A missing caption reads as null.\n");
  run('adopt');
  const settings=join(root,'lubyanka.json');
  const project=JSON.parse(readFileSync(settings,'utf8'));project.integrationBranch='develop';
  writeFileSync(settings,JSON.stringify(project));
  git('add','.');git('commit','-qm','generated example');run('install-hooks');
  writeFileSync(join(control,'orders.md'),"1. In store.cjs, preserve save(path,caption) and load(path). Save captions in the supplied file so reopening in a new Node process reads the same UTF-8 value. load must return null for a missing file.\n2. In ui.cjs implement display(path) to return the current caption from store.load(path). Display an empty string when it returns null. Keep the CommonJS display export.\n");
  write('gost.json',{version:1,method_locks:['Preserve synchronous CommonJS exports.'],forbidden_shortcuts:['test.skip'],protected_paths:['contract.md'],visual_tokens:{}});
  const scope={write:['store.cjs'],read:[],snapshots:[],intentional_constraints:['reads the same UTF-8 value']};
  write('scope.json',{'TASK-01':scope,'TASK-02':{...scope,write:['ui.cjs'],read:['store.cjs'],intentional_constraints:[]}});
  write('basis.json',{contract:'contract.md'});
  const save="require('./store.cjs').save('/tmp/cap','한글 caption')";
  const prepare="const cp=require('node:child_process'); cp.execFileSync(process.execPath,['-e',"+JSON.stringify(save)+"]);";
  const first=prepare+"const s=require('./store.cjs');console.log(JSON.stringify({caption:s.load('/tmp/cap'),missing:s.load('/tmp/absent')}));";
  const second=prepare+"const u=require('./ui.cjs');console.log(JSON.stringify({caption:u.display('/tmp/cap'),empty:u.display('/tmp/absent')}));";
  const checks=(file,probe,expected)=>({image,build:['node','--check',file],oracle:{command:['node','-e',probe],expected}});
  write('checks.json',{'TASK-01':{...checks('store.cjs',first,{caption:'한글 caption',missing:null}),promote:[{quote:scope.intentional_constraints[0],metric:'caption'}]},'TASK-02':{...checks('ui.cjs',second,{caption:'한글 caption',empty:''}),risk:'high'}});
  run('gosplan',['prepare',control]);run('gosplan',['dispatch']);
  const bad="let v=null; exports.save=(path,input)=>{v=input}; exports.load=path=>v;";
  const answer={status:'PROPOSED',changes:[{path:'store.cjs',text:bad}],dissent:''};
  write('fixture.json',{image,command:['node','-e',"console.log("+JSON.stringify(JSON.stringify(answer))+")"]});
  run('worker',['run',join(control,'fixture.json')]);
  assert.equal(run('voenpred',[],1).reports[0].stage,'ORACLE');
  run('politruk',[],1);
  const before=run('gosplan',['status']).tasks;assert.equal(before[1].attempt,0);assert.equal(before[0].politruk,undefined);
  assert.equal(run('retry').state,'PURGED');
  const results=[];
  for (const id of ['TASK-01','TASK-02']) {
    const dispatch=run('gosplan',['dispatch']);assert.equal(dispatch.id,id);
    const automated=id==='TASK-02';
    if (automated) {
      const gost=JSON.parse(readFileSync(join(dispatch.lock,'gost.json'),'utf8'));
      assert.ok(gost.method_locks.includes(scope.intentional_constraints[0]));
      const waiting=run('execute',[],2);assert.equal(waiting.task,id);
    }
    const state=run('gosplan',['status']).tasks.find(t=>t.id===id);
    const worker=automated?state.worker.candidates[0]:run('worker',['run']).candidates[0];
    const revisionFile=(rev,name)=>join(root,'.git','lubyanka','gosplan',String(rev).padStart(12,'0'),name);
    const reports=automated?JSON.parse(readFileSync(revisionFile(state.voenpred.revision,'voenpred_report.json'))):run('voenpred').reports;
    const reviews=automated?JSON.parse(readFileSync(revisionFile(state.politruk.revision,'politruk_verdict.json'))):run('politruk').reports;
    const metrics=reports[0].observations.oracle,judge=reviews[0];assert.equal(judge.verdict,'PASS');
    if (id==='TASK-02') {
      const {task,token,tree}=run('settle',['integrate'],2);const file=join(control,'approval.json');
      write('approval.json',{task,token,tree:'wrong',decision:'APPROVE'});run('settle',['approve',file],1);
      write('approval.json',{task,token,tree,decision:'APPROVE'});run('settle',['approve',file]);
    }
    const offer=run('settle',['offer']);assert.deepEqual(run('settle',['offer']),offer);
    if (id==='TASK-01') {
      writeFileSync(join(root,'existing-work.txt'),'private fixture');
      run('settle',['integrate'],1);assert.equal(readFileSync(join(root,'existing-work.txt'),'utf8'),'private fixture');
      rmSync(join(root,'existing-work.txt'));
      git('merge','--ff-only',offer.merge);
    }
    assert.equal(run('settle',['integrate']).head,offer.merge);
    assert.equal(run('settle',['integrate']).id,id);
    assert.equal(git('rev-parse','HEAD^{tree}'),worker.tree);
    results.push({id,attempt:dispatch.attempt,worker:worker.provider,reviewer:judge.provider,measurements:metrics,tree:worker.tree});
  }
  assert.ok(run('gosplan',['status']).tasks.every(t=>t.state==='DONE'));
  assert.equal(run('execute').status,'done');
  console.log(JSON.stringify(results));
} finally {rmSync(space,{recursive:true,force:true});}
