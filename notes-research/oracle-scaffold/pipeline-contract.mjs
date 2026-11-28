import { hasText } from './project.mjs';

function requireFields(object, required, optional = []) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('JSON 객체가 필요합니다.');
  for (const key of required) {
    if (!Object.hasOwn(object, key)) throw new Error(`필수 필드 누락 · ${key}`);
  }
  for (const key of Object.keys(object)) {
    if (!required.includes(key) && !optional.includes(key)) throw new Error(`미등록 필드 · ${key}`);
  }
}

export function repoPath(value) {
  return hasText(value) && !/[\\:\x00-\x1f\x7f]/u.test(value) &&
    value.split('/').every(s => s && s !== '.' && s !== '..' && s.toLowerCase() !== '.git');
}

function list(value, key, predicate) {
  if (!Array.isArray(value) || !value.every(predicate) || new Set(value).size !== value.length) {
    throw new Error(`유효하지 않은 목록 · ${key}`);
  }
}

export function pathsOverlap(left, right) {
  // Also reject aliases on case-insensitive, normalization-insensitive workspaces.
  const a = left.normalize('NFC').toLowerCase();
  const b = right.normalize('NFC').toLowerCase();
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

export function validateGost(policy) {
  requireFields(policy, ['version', 'method_locks', 'forbidden_shortcuts', 'protected_paths', 'visual_tokens']);
  if (policy.version !== 1) throw new Error('지원하는 GOST 버전은 1입니다.');
  for (const key of ['method_locks', 'forbidden_shortcuts']) list(policy[key], key, hasText);
  list(policy.protected_paths, 'protected_paths', repoPath);
  if (!policy.visual_tokens || typeof policy.visual_tokens !== 'object' || Array.isArray(policy.visual_tokens)) {
    throw new Error('visual_tokens에는 이름별 기준값을 지정하세요.');
  }
  return policy;
}

export function validateScope(scope, policy) {
  requireFields(scope, ['write', 'read', 'snapshots', 'intentional_constraints'], ['candidates']);
  if ('candidates' in scope && ![1, 2].includes(scope.candidates)) throw new Error('허용 후보 수는 1 또는 2입니다.');
  for (const key of ['write', 'read', 'snapshots']) list(scope[key], key, repoPath);
  list(scope.intentional_constraints, 'intentional_constraints', hasText);
  const immutable = [...policy.protected_paths, ...scope.read, ...scope.snapshots];
  for (const [index, path] of scope.write.entries()) {
    if (immutable.some(other => pathsOverlap(path, other)) ||
        scope.write.slice(0, index).some(other => pathsOverlap(path, other))) {
      throw new Error(`쓰기 경로가 보호 경로 또는 다른 쓰기 경로와 겹칩니다 · ${path}`);
    }
  }
  return scope;
}

export function validateVerdict(value) {
  requireFields(value, ['verdict', 'category', 'evidence']);
  const reasons = ['MISSING_REQ', 'SCOPE_SHRINK', 'REGRESSION', 'CHEAT', 'OVERREACH', 'VISUAL_DRIFT'];
  const allowed = (value.verdict === 'PASS' && value.category === 'NONE') ||
    (value.verdict === 'REJECT' && reasons.includes(value.category));
  if (!allowed || !hasText(value.evidence) || /[\r\n\u2028\u2029]/u.test(value.evidence)) {
    throw new Error('판정·사유·한 줄 근거를 확인하세요.');
  }
  return value;
}
