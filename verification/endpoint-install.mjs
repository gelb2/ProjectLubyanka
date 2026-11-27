// Run from the package-maintainer checkout against an endpoint's npm install root.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const name = 'lubyanka-oracle-scaffold';
const registry = 'https://registry.npmjs.org';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

async function fileHashes(root) {
  const hashes = {};
  async function visit(relative) {
    for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await visit(path);
      else {
        assert(entry.isFile(), '패키지 파일 형식이 다릅니다 · ' + path);
        hashes[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
      }
    }
  }
  await visit('');
  return hashes;
}

async function verify(path) {
  const root = await realpath(path);
  const manifest = await readJson(join(root, 'package.json'));
  const lock = await readJson(join(root, 'package-lock.json'));
  const section = manifest.devDependencies?.[name] ? 'devDependencies' : 'dependencies';
  const version = manifest[section]?.[name];
  assert(/^\d+\.\d+\.\d+$/.test(version), '공식 npm의 정확한 릴리스 버전을 지정하세요.');
  assert.equal(lock.packages[''][section]?.[name], version);
  const locked = lock.packages['node_modules/' + name];
  const address = registry + '/' + name + '/-/' + name + '-' + version + '.tgz';
  assert(locked, '잠금 파일에 설치 루트의 패키지 항목이 없습니다.');
  assert.equal(locked.version, version);
  assert.equal(locked.resolved, address);
  assert(!locked.link, '연결된 로컬 패키지입니다.');
  const target = join(root, 'node_modules', name);
  assert((await lstat(target)).isDirectory() && await realpath(target) === target, '설치본 경로가 로컬 링크입니다.');
  const response = await fetch(address, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert(response.ok, '공식 npm tarball 응답 ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  assert.equal(locked.integrity, integrity);
  const temp = await mkdtemp(join(tmpdir(), 'lubyanka-registry-'));
  try {
    const archive = join(temp, 'official.tgz');
    await writeFile(archive, bytes);
    execFileSync('tar', ['-xzf', archive, '-C', temp]);
    assert.deepEqual(await fileHashes(target), await fileHashes(join(temp, 'package')), '공식 npm 파일과 실제 설치 파일이 다릅니다.');
    for (const [bin, file] of Object.entries((await readJson(join(target, 'package.json'))).bin)) {
      assert.equal(await realpath(join(root, 'node_modules', '.bin', bin)), resolve(target, file));
    }
    console.log(JSON.stringify({ name, version, integrity, status: 'verified' }));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
try {
  if (process.argv.length !== 3) throw new Error('node verification/endpoint-install.mjs <npm 프로젝트 루트>');
  await verify(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
