import { constants } from 'node:fs';
import { access, chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, gitText } from './lab.mjs';
import { hash, json, readProject, save, stateDir, withLock } from './project.mjs';
import { readRegularFile } from './lifecycle.mjs';

const required = ['pre-commit', 'reference-transaction'];

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
  const configured = command('git', ['config', '--path', '--get', 'core.hooksPath'], root);
  try {
    const receipt = json(await readFile(join(directory, 'hook-receipt.json')), 'Git 훅');
    if (configured.status === 0 && configured.stdout.toString().trim() === target) {
      for (const name of required) {
        const path = join(target, name);
        if (!(await executable(path)) || hash((await readRegularFile(path, name)).content) !== receipt[name]) {
          throw new Error('실행 훅이 저장한 내용과 다릅니다.');
        }
      }
      return;
    }
  } catch {
    throw new Error('install-hooks로 현재 복제본의 커밋·참조 검사를 연결하세요.');
  }
  throw new Error('install-hooks로 현재 복제본의 커밋·참조 검사를 연결하세요.');
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
    const originName = 'hook-origin.json';
    let previous = raw ? (isAbsolute(raw) ? raw : resolve(root, raw)) :
      gitText(root, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
    if (previous === target) {
      const origin = await readFile(join(directory, originName)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (!origin) {
        await requireHooks(root, directory);
        return { status: 'installed', hooks: target, preserved: true };
      }
      ({ previous } = json(origin, originName));
      if (typeof previous !== 'string' || !isAbsolute(previous) || previous === target) {
        throw new Error('기존 Git 훅 경로 기록을 확인할 수 없습니다.');
      }
    } else {
      await save(directory, originName, { previous });
    }

    await mkdir(target, { recursive: true });
    const files = await readdir(previous).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    const entry = fileURLToPath(new URL('./managed.mjs', import.meta.url));
    const receipt = {};
    for (const name of new Set([...required, ...files])) {
      if (!/^[a-z][a-z-]+$/.test(name)) continue;
      const prior = join(previous, name);
      const hasPrior = await executable(prior);
      const args = [process.execPath, entry, '_hook', root, name, config.integrationBranch, hasPrior ? prior : ''].map(quote).join(' ');
      const script = required.includes(name) ? `exec ${args} "$@"` :
        hasPrior ? `exec ${quote(prior)} "$@"` : '';
      if (script) {
        const destination = join(target, name);
        const wrapper = `#!/bin/sh\n${script}\n`;
        await writeFile(destination, wrapper, { mode: 0o755 });
        await chmod(destination, 0o755);
        if (required.includes(name)) receipt[name] = hash(wrapper);
      }
    }
    gitText(root, ['config', '--local', 'core.hooksPath', target]);
    await save(directory, 'hook-receipt.json', receipt);
    await requireHooks(root, directory);
    return { status: 'installed', hooks: target, preserved: true };
  });
}
