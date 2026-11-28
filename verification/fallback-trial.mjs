import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [binary,image] = process.argv.slice(2);
const space = realpathSync(mkdtempSync(join(tmpdir(),'lubyanka-fallback-')));
const root = join(space,'repo'), control = join(space,'control');
const env = {...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
function cli(action,args = [],expected = 0) {
  const result = spawnSync(process.execPath,[binary,action,root,...args],{encoding:'utf8',env});
  assert.equal(result.status,expected,result.stderr + result.stdout);
  return result.stdout ? JSON.parse(result.stdout) : {};
}
function file(name,value) { writeFileSync(join(control,name),JSON.stringify(value)); }
function fixture(code) {
  file('worker.json',{image, command:['node','-e',code]});
  return cli('worker',['run',join(control,'worker.json')]);
}
function reply(text, guard) {
  return "const assert=require('assert/strict'); const p=JSON.parse(require('fs').readFileSync(0));" + guard + '\nconsole.log(' +
    JSON.stringify(JSON.stringify({status:'PROPOSED',dissent:'',changes:[{path:'calc.js',text}]})) + ');';
}
try {
  mkdirSync(root); mkdirSync(control);
  const git = (...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8'}).trim();
  git('init','-q','-b','develop');
  writeFileSync(join(root,'calc.js'),'exports.value=0;\n');
  writeFileSync(join(root,'contract.md'),'export a numeric value');
  git('add','.'); git('-c','user.name=Fixture','-c','user.email=f@example.invalid','commit','-qm','base');
  writeFileSync(join(control,'orders.md'),'1. Return 2.\n2. Preserve the API.\n');
  file('gost.json',{version:1,method_locks:[],forbidden_shortcuts:[],protected_paths:['contract.md'],visual_tokens:{}});
  const scope={read:[],write:['calc.js'],snapshots:[],intentional_constraints:[]};
  file('scope.json',{'TASK-01':scope,'TASK-02':scope});
  file('basis.json',{contract:'contract.md'});
  const checks={image,build:['node','--check','calc.js'],oracle:{command:['node','-e',"console.log(JSON.stringify({value:require('./calc.js').value}))"],expected:{value:2}}};
  file('checks.json',{'TASK-01':checks,'TASK-02':checks});
  cli('gosplan',['prepare',control]); cli('gosplan',['dispatch']);
  fixture(reply('exports.value=(\n','assert.equal(p.files["calc.js"].text,"exports.value=0;\\n");'));
  assert.equal(cli('voenpred',[],1).reports[0].localBuild,true);
  assert.equal(cli('retry').status,'patch');
  fixture(reply('exports.value=(!\n','assert.equal(p.files["calc.js"].text,"exports.value=(\\n");'));
  assert.equal(cli('voenpred',[],1).reports[0].stage,'BUILD');
  assert.equal(cli('retry').state,'PURGED');
  for (const attempt of [2,3]) {
    const current=cli('gosplan',['dispatch']);
    assert.equal(current.attempt,attempt);
    const guard='assert.equal(p.files["calc.js"].text,"exports.value=0;\\n"); assert.equal(p.anti_priors.length,' + (attempt-1) + '); assert.equal(p.build_failure,undefined);';
    fixture(reply('exports.value=9;\n',guard));
    assert.equal(cli('voenpred',[],1).reports[0].stage,'ORACLE');
    const result=cli('retry',[],attempt === 3 ? 2 : 0);
    assert.equal(result.state,attempt === 3 ? 'QUARANTINED' : 'PURGED');
  }
  const tasks=cli('gosplan',['status']).tasks;
  assert.equal(tasks[1].attempt,0);
  assert.equal(git('for-each-ref','--format=%(refname)','refs/lubyanka/candidates'),'');
  assert.equal(readFileSync(join(root,'calc.js'),'utf8'),'exports.value=0;\n');
  cli('gosplan',['dispatch'],1);
  cli('execute',[],2);
  cli('gosplan',['replace',control],1);
  writeFileSync(join(control,'orders.md'),'1. Return 2 using numeric input.\n2. Preserve the API.\n');
  const replacement=cli('gosplan',['replace',control]);
  assert.ok(replacement.supersedes);
  assert.equal(cli('gosplan',['dispatch']).attempt,1);
  console.log('Installed fallback: one local patch, clean attempts 2 and 3, protected prior evidence, three purges, next task closed.');
} finally {
  rmSync(space,{recursive:true,force:true});
}
