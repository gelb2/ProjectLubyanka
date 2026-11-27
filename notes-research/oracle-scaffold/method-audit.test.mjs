import assert from 'node:assert/strict';
import test from 'node:test';
import {checkMethodWriting} from './method-audit.mjs';
import {judgeScenarios} from './sharashka.mjs';

const rule = {
  requirementId:'SLOTS', source:'save contract', scope:'restore', inputs:'blocked save', expectedOrRule:'restore leaves one slot',
  comparator:'exact', assertion:{expected:1}, requiredEvidence:['real output'], unresolved:[],
};
const incident = { path:'critique.md', requirement:'SLOTS', reason:'counted displayed slots', technicalCause:'never restored the real save',
  correction:'reopened the same persisted file', verification:'observed one restored slot' };
const docs = () => ({manifest:{schemaVersion:1,requirements:[structuredClone(rule)]},
  critique:[{path:'critique.md',content:Object.values(incident).join('\n')}]});
const basis = () => ({version:1,requirements:[{id:'SLOTS',basis:'independent persistence contract',approved:structuredClone(rule),accept:1,reject:0}],
  incidents:[structuredClone(incident)]});

test('writing audit rejects a substituted expected answer, a missing cause and a circular witness', () => {
  assert.equal(checkMethodWriting(docs(),basis()).status,'pass');
  const invented=docs();
  invented.manifest.requirements[0].assertion.expected=0;
  assert.match(checkMethodWriting(invented,basis()).issues.join('\n'),/assertion/);
  const vague=docs();
  vague.critique[0].content=incident.reason;
  assert.match(checkMethodWriting(vague,basis()).issues.join('\n'),/기술 원인/);
  const circular=basis();
  circular.requirements[0].reject=1;
  assert.match(checkMethodWriting(docs(),circular).issues.join('\n'),/반례/);
});

const scenarios={version:1,scenarios:[
  {id:'regular',mode:'denied',target:'release-build',input:'unlock interaction',assertions:[{metric:'written',operator:'eq',expected:0}]},
  {id:'long-run',mode:'memory',target:'release-on-device',input:'repeat the same state',
    assertions:[{metric:'retained',operator:'lte',expected:25},{metric:'iterations',operator:'gte',expected:10}]},
]};
const target={task:'case',phase:'feature',tree:'current'};
const row=(id,mode,environment,measurements)=>({id,mode,target:environment,entry:'actual view',actions:['tap and reopen'],result:'recorded output',measurements});

test('scenario gate covers every exact target, state, operation and metric', () => {
  const denied=row('regular','denied','release-build',{written:0});
  const memory=row('long-run','memory','release-on-device',{iterations:10,retained:25});
  const run={target,observations:[denied,memory]};
  assert.equal(judgeScenarios(scenarios,run,target).status,'pass');
  assert.equal(judgeScenarios(scenarios,{target,observations:[denied]},target).status,'pending');
  assert.equal(judgeScenarios(scenarios,{target,observations:[denied,{...memory,actions:[]}]},target).status,'fail');
  assert.equal(judgeScenarios(scenarios,{target,observations:[denied,{...memory,target:'simulator'}]},target).status,'fail');
  assert.equal(judgeScenarios(scenarios,{target,observations:[denied,{...memory,measurements:{iterations:10,retained:26}}]},target).status,'fail');
  assert.equal(judgeScenarios(scenarios,{target,observations:[denied,{id:'long-run',blocked:'device absent',attempt:'enumerated connected devices'}]},target).status,'pending');
  assert.throws(()=>judgeScenarios(scenarios,{...run,target:{...target,tree:'stale'}},target),/Git 후보/);
  assert.throws(()=>judgeScenarios(scenarios,{target,observations:[denied,denied]},target),/중복/);
});
