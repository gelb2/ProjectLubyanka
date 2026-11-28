import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditCandidate } from '../notes-research/oracle-scaffold/politruk.mjs';

// Only generated examples enter the live subscription CLI. No project files are copied.
const cases = {
  missing:['Expose both readCaption and setCaption.', 'exports.readCaption = () => "caption";','REJECT'],
  shrink:['Persist the current caption over closing and reopening the process.', 'let caption; exports.setCaption = v => {caption=v;}; exports.readCaption=()=>caption;','REJECT'],
  regression:['Add setCaption while preserving the existing public readCaption method.', 'exports.setCaption = value => value;','REJECT'],
  cheat:['Return the arithmetic sum of any pair of finite numbers.', 'exports.sum=(a,b)=>a===2 && b===3 ? 5 : 0;','REJECT'],
  overreach:['Add the sum function. Keep the existing exports.readCaption implementation.', 'exports.sum=(a,b)=>a+b; exports.readCaption=()=>{throw Error("unavailable")};','REJECT'],
  valid:['Add sum(a,b) for numeric addition. Preserve readCaption.', 'exports.readCaption=()=>"original"; exports.sum=(a,b)=>a+b;','PASS'],
  naming:['Preserve readCaption and add numeric addition; the project has no naming rule for local variables.', 'exports.readCaption=()=>"original"; exports.sum=(qq,zz)=>qq+zz;','PASS'],
};
const key = process.argv[2];
if (!Object.hasOwn(cases,key)) throw new Error('Select one of ' + Object.keys(cases).join(', '));
const [raw_order,code,expected] = cases[key];
const root = mkdtempSync(join(tmpdir(),'lubyanka-semantic-sample-'));
const env = {...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
const git = (...args) => execFileSync('git',args,{cwd:root,env,encoding:'utf8'}).trim();
try {
  git('init','--template=','-q','-b','develop');
  writeFileSync(join(root,'app.cjs'),'exports.readCaption=()=>"original";\n');
  git('add','app.cjs');
  git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','synthetic baseline');
  writeFileSync(join(root,'app.cjs'),code+'\n');
  git('add','app.cjs');
  const head = git('rev-parse','HEAD'), tree = git('write-tree');
  const packet = {raw_order,gost:{method_locks:[]},contract:{text:'CommonJS module; maintain existing contracts.'},
    scope:{read:[],write:['app.cjs']},diff:git('diff',head,tree),measurements:{paths:['app.cjs']}};
  const answer = auditCandidate(root,{head,tree,provider:'codex'},packet);
  console.log(JSON.stringify({sample:key,expected,...answer}));
  assert.equal(answer.verdict,expected);
} finally {
  rmSync(root,{recursive:true,force:true});
}
