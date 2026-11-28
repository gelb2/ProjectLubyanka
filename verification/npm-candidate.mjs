import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkCandidate(statuses, integrity, ownerId) {
  // GitHub lists statuses newest first. A newer failure revokes an older success.
  const status = statuses.find(row => row.context === 'release/installed-candidate');
  assert.ok(status, 'Missing installed-candidate status on this commit');
  assert.equal(status.creator?.id, ownerId, 'Unknown candidate verifier');
  assert.equal(status.state, 'success', 'Candidate verification did not pass');
  assert.equal(status.description, integrity, 'Tarball differs from the tested candidate');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [archive, pages] = process.argv.slice(2);
  const integrity = 'sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64');
  checkCandidate(JSON.parse(readFileSync(pages)).flat(), integrity, Number(process.env.GITHUB_REPOSITORY_OWNER_ID));
  console.log(integrity);
}
