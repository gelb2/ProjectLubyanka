import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class Unavailable extends Error {}
export const otherProvider = name => name === 'codex' ? 'claude' : 'codex';

export function assign(preferred, invoke) {
  if (!['codex', 'claude'].includes(preferred)) throw new Error('지원하지 않는 모델 제공자입니다.');
  try {
    return { preferred, provider: preferred, response: invoke(preferred) };
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    const alternate = otherProvider(preferred);
    return { preferred, provider: alternate, fallback: error.message, response: invoke(alternate) };
  }
}

function unavailable(reason) {
  if (/rate.limit|quota|usage.limit|out of extra usage/i.test(reason)) return 'quota';
  if (/not logged in|login required|unauthorized|authentication failed|invalid.*token|please run.*login/i.test(reason)) return 'authentication';
  if (/connection refused|connection reset|could not connect|service unavailable|server overloaded|stream disconnected|unable to connect|\b(?:502|503|504)\b/i.test(reason)) return 'service';
}

export function oneShot(provider, instruction, packet, images = []) {
  const dir = mkdtempSync(join(tmpdir(), 'lubyanka-model-'));
  const output = join(dir, 'reply.json');
  let input = instruction + '\nReturn a single JSON object without Markdown. Do not invoke tools.\n' + JSON.stringify(packet);
  try {
    const disabled = ['shell_tool', 'unified_exec', 'apps', 'multi_agent', 'memories', 'skill_search', 'hooks', 'plugins'];
    const args = provider === 'codex'
      ? ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--json',
        ...disabled.flatMap(feature => ['--disable', feature]), '-c', 'web_search="disabled"',
        '-c', 'project_doc_max_bytes=0', '-c', 'approval_policy="never"', '-c', 'default_permissions="pipeline"',
        '-c', 'permissions.pipeline.filesystem={":workspace_roots"="read"}', '-c', 'permissions.pipeline.network.enabled=false', '-o', output, '-']
      : ['-p', '--restricted', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--disable-slash-commands', '--no-session-persistence', '--setting-sources', '', '--output-format', 'json'];
    if (images.length && provider === 'codex') {
      for (const [index, image] of images.entries()) {
        const path = join(dir, index + '.png');
        writeFileSync(path, Buffer.from(image, 'base64'), {mode:0o400});
        args.splice(args.length - 1, 0, '--image', path);
      }
    } else if (images.length) {
      args.splice(-1,1,'stream-json','--input-format','stream-json','--verbose');
      const content = [{type:'text',text:input}, ...images.map(data=>({type:'image',source:{type:'base64',media_type:'image/png',data}}))];
      input = JSON.stringify({type:'user',message:{role:'user',content}}) + '\n';
    }
    const run = spawnSync(provider, args, { cwd: dir, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180000, killSignal: 'SIGKILL' });
    if (['ENOENT', 'EACCES', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(run.error?.code)) throw new Unavailable(provider + '/' + run.error.code);
    if (run.error) throw run.error;
    let response;
    let diagnostic = '';
    if (provider === 'claude') {
      const raw = run.stdout.trim();
      const envelope = raw && images.length ? raw.split('\n').map(line=>JSON.parse(line)).findLast(event=>event.type === 'result') ?? {} : raw ? JSON.parse(raw) : {};
      if (envelope.is_error || run.status !== 0) diagnostic = String(envelope.result ?? run.stderr);
      else if (envelope.subtype === 'success') response = envelope.result;
    } else {
      const events = run.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (events.some(e => e.item && /command_execution|mcp_tool_call|web_search|file_change/.test(e.item.type))) throw new Error('허용되지 않은 모델 도구 호출입니다.');
      if (run.status === 0 && events.some(e => e.type === 'turn.completed')) response = readFileSync(output, 'utf8');
      else diagnostic = events.filter(e => e.type === 'error' || e.type === 'turn.failed').map(e => e.message ?? e.error?.message).join(' ') || run.stderr;
    }
    if (typeof response !== 'string' || run.status !== 0) {
      const reason = unavailable(diagnostic);
      if (reason) throw new Unavailable(provider + '/' + reason);
      throw new Error(provider + ' 실행 실패 (exit ' + run.status + ')');
    }
    return JSON.parse(response);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
