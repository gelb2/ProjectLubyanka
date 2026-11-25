import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const maxBuffer = 64 * 1024 * 1024;

export function command(program, args, cwd, options = {}) {
  const result = spawnSync(program, args, { cwd, maxBuffer, timeout: 120_000, ...options });
  if (result.error) throw result.error;
  return result;
}

export function git(root, args) {
  const result = command('git', ['-C', root, ...args], root);
  if (result.status !== 0) throw new Error(result.stderr.toString().trim() || `Git 실행 실패 · ${args[0]}`);
  return result.stdout;
}

export function gitText(root, args) {
  return git(root, args).toString().trim();
}

function sourceArchive(root, tree, directory) {
  const entries = git(root, ['ls-tree', '-r', '-z', tree]).toString().split('\0');
  if (entries.some(entry => entry.startsWith('160000 '))) {
    throw new Error('Git 서브모듈의 실행 내용은 이 후보 트리에 없습니다.');
  }
  const objects = gitText(root, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']);
  if (/[\r\n]/.test(objects)) throw new Error('Git 객체 경로의 줄바꿈을 지원하지 않습니다.');
  const format = gitText(root, ['rev-parse', '--show-object-format']);
  const bare = join(directory, 'objects.git');
  const archive = join(directory, 'source.tar');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  const initialized = command('git', ['init', '--quiet', '--bare', '--template=', `--object-format=${format}`, bare], directory, { env });
  if (initialized.status !== 0) throw new Error(initialized.stderr.toString().trim());
  mkdirSync(join(bare, 'info'), { recursive: true });
  writeFileSync(join(bare, 'info', 'attributes'), '* -export-ignore -export-subst\n');
  writeFileSync(join(bare, 'objects', 'info', 'alternates'), objects + '\n');
  const output = openSync(archive, 'wx', 0o600);
  try {
    const result = command('git', ['--git-dir', bare, 'archive', '--format=tar', tree], directory, {
      env, stdio: ['ignore', output, 'pipe'],
    });
    if (result.status !== 0) throw new Error(result.stderr.toString().trim());
  } finally {
    closeSync(output);
  }
  return openSync(archive, 'r');
}

export function imageId(root, image) {
  if (typeof image !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9./:@_-]{0,255}$/.test(image)) {
    throw new Error('시험에 사용할 로컬 Docker 이미지를 지정하세요.');
  }
  const result = command('docker', ['image', 'inspect', '--format', '{{.Id}}', image], root);
  const id = result.stdout.toString().trim();
  if (result.status !== 0 || !/^sha256:[a-f0-9]{64}$/.test(id)) {
    throw new Error(result.stderr.toString().trim() || '로컬 Docker 이미지를 읽을 수 없습니다.');
  }
  return id;
}

export function runLab(root, tree, image, args, planInput) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9./:@_-]{0,255}$/.test(image) ||
      !Array.isArray(args) || args.length === 0 ||
      !args.every(arg => typeof arg === 'string' && arg.length > 0 && !arg.includes('\0')) ||
      args[0].startsWith('-')) {
    throw new Error('시험에 사용할 로컬 Docker 이미지와 명령 배열을 지정하세요.');
  }
  const directory = mkdtempSync(join(tmpdir(), 'lubyanka-archive-'));
  const name = `lubyanka-${randomUUID()}`;
  let archive;
  try {
    archive = sourceArchive(root, tree, directory);
    const result = command('docker', [
      'run', '--rm', '-i', '--name', name, '--pull=never', '--network=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=128',
      '--memory=512m', '--cpus=2', '--user=65532:65532',
      '--tmpfs=/work:rw,exec,mode=1777,size=128m', '--tmpfs=/tmp:rw,mode=1777,size=32m',
      '--env=HOME=/tmp', ...(planInput ? ['--env=LUBYANKA_PLAN_JSON'] : []),
      '--entrypoint=/bin/sh', image,
      '-c', 'tar -xf - -C /work && cd /work && exec "$@"', 'lubyanka', ...args,
    ], root, {
      stdio: [archive, 'pipe', 'pipe'], maxBuffer: 2 * 1024 * 1024,
      env: planInput ? { ...process.env, LUBYANKA_PLAN_JSON: JSON.stringify(planInput) } : process.env,
    });
    return {
      exitCode: result.status,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } finally {
    if (archive !== undefined) {
      const cleaned = spawnSync('docker', ['rm', '-f', name], { cwd: root, stdio: 'ignore', timeout: 5_000 });
      if (cleaned.error?.code === 'ETIMEDOUT') console.error(`격리 컨테이너 정리 시간 초과 · ${name}`);
      closeSync(archive);
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
