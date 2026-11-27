#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { evaluateOracle } from './engine.mjs';
import { audit, begin, finish, guardCommit, guardReferences, permit, plan, reviewDraft, verify } from './gate.mjs';
import { installHooks } from './hooks.mjs';
import { command } from './lab.mjs';
import { adopt, json } from './project.mjs';

async function main() {
  if (process.argv[2] === '_hook') {
    const [, , , root, hook, branch, prior, ...args] = process.argv;
    const input = hook === 'reference-transaction' ? readFileSync(0) : undefined;
    if (hook === 'pre-commit') await guardCommit(root, branch);
    if (hook === 'reference-transaction' && args[0] === 'prepared') await guardReferences(root, branch, input.toString());
    if (prior) {
      const result = command(prior, args, root, { input, stdio: ['pipe', 'inherit', 'inherit'] });
      return result.status ?? 1;
    }
    return 0;
  }

  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      resume: { type: 'boolean' }, kind: { type: 'string' },
      'manual-file': { type: 'string' }, 'scenario-file': { type: 'string' },
    },
  });
  const [action, path, arg, source, ...extra] = positionals;
  if (!path || extra.length || (action !== 'begin' && (values.resume || values.kind)) ||
      (action !== 'verify' && (values['manual-file'] !== undefined || values['scenario-file'] !== undefined))) {
    throw new Error('lubyanka 사용법을 확인하세요.');
  }
  if (action === 'judge' && arg && source) {
    const manifest = json(await readFile(path), '정답지');
    const observations = json(await readFile(source), '실측');
    return report(evaluateOracle(manifest, arg, observations));
  }
  const root = await realpath(path);
  if (action === 'adopt' && !arg) return report(await adopt(root));
  if (action === 'audit' && !arg) return report(await audit(root));
  if (action === 'install-hooks' && !arg) return report(await installHooks(root));
  if (action === 'begin' && arg && !source) return report(await begin(root, arg, values));
  if (action === 'permit' && arg && !source) return report(await permit(root, arg));
  if (action === 'plan' && arg && !source) return report(await plan(root, arg));
  if (action === 'review-draft' && arg && !source) return report(await reviewDraft(root, arg));
  if (action === 'verify' && arg && (!source || arg === 'merge')) {
    return report(await verify(root, arg, source, { manualFile: values['manual-file'], scenarioFile: values['scenario-file'] }));
  }
  if (action === 'finish' && arg && !source) return finish(root, arg);
  throw new Error([
    'lubyanka <adopt|audit|install-hooks> <Git 루트>',
    'lubyanka begin <Git 루트> <사용자 지시 파일> [--kind answer|development] [--resume]',
    'lubyanka plan <Git 루트> <계획 JSON>',
    'lubyanka permit <Git 루트> <작업 ID>',
    'lubyanka review-draft <Git 루트> <사용자에게 보낼 초안.txt>',
    'lubyanka verify <Git 루트> <plan|feature|merge> [병합할 브랜치] [--manual-file 증거.json] [--scenario-file 실측.json]',
    'lubyanka finish <Git 루트> <plan|feature|merge|failure>',
    'lubyanka judge <정답지 JSON> <plan|feature|merge> <실측 JSON>',
  ].join('\n'));
}

function report(value) {
  console.log(JSON.stringify(value, null, 2));
  return value.status === 'fail' ? 1 : value.status === 'pending' ? 2 : 0;
}

try {
  process.exitCode = (await main()) ?? 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
