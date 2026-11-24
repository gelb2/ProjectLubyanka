import { constants } from 'node:fs';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, gitText } from './lab.mjs';
import { readProject, stateDir, withLock } from './project.mjs';

function quote(value) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

async function executable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch (error) {
    if (['ENOENT', 'EACCES'].includes(error.code)) return false;
    throw error;
  }
}

export async function requireHooks(root, directory) {
  const target = join(directory, 'hooks');
  const configured = command('git', ['config', '--local', '--path', '--get', 'core.hooksPath'], root);
  if (configured.status !== 0 || configured.stdout.toString().trim() !== target ||
      !(await executable(join(target, 'pre-commit'))) || !(await executable(join(target, 'reference-transaction')))) {
    throw new Error('install-hooks로 현재 복제본의 커밋·참조 검사를 연결하세요.');
  }
}

export async function installHooks(root) {
  const directory = stateDir(root);
  return withLock(directory, async () => {
    const { config } = await readProject(root);
    gitText(root, ['rev-parse', '--verify', `refs/heads/${config.integrationBranch}^{commit}`]);
    const target = join(directory, 'hooks');
    const configured = command('git', ['config', '--path', '--get', 'core.hooksPath'], root);
    if (![0, 1].includes(configured.status)) throw new Error('기존 Git 훅 경로를 확인할 수 없습니다.');
    const raw = configured.stdout.toString().trim();
    const previous = raw ? (isAbsolute(raw) ? raw : resolve(root, raw)) :
      gitText(root, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
    if (previous === target) return { status: 'installed', hooks: target, preserved: true };

    await mkdir(target, { recursive: true });
    const files = await readdir(previous).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    const entry = fileURLToPath(new URL('./managed.mjs', import.meta.url));
    for (const name of new Set(['pre-commit', 'reference-transaction', ...files])) {
      if (!/^[a-z][a-z-]+$/.test(name)) continue;
      const prior = join(previous, name);
      const hasPrior = await executable(prior);
      const args = [process.execPath, entry, '_hook', root, name, config.integrationBranch, hasPrior ? prior : ''].map(quote).join(' ');
      const script = name === 'pre-commit' || name === 'reference-transaction' ? `exec ${args} "$@"` :
        hasPrior ? `exec ${quote(prior)} "$@"` : '';
      if (script) await writeFile(join(target, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    }
    gitText(root, ['config', '--local', 'core.hooksPath', target]);
    return { status: 'installed', hooks: target, preserved: true };
  });
}
