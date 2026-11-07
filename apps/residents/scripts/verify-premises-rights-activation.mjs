// Compiled administrator CLI regression: route discovery, refusal, activation and idempotent replay.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
const root = mkdtempSync(join(tmpdir(), 'premises-rights-activation-'));
const m = createOpenSocietyManifest({ count: 2, life: false, societyKernel: false });
let r = new OpenSocietyRuntime(root, m);
r.close();
const call = (command) =>
  spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), command, '--root', root],
    {
      encoding: 'utf8',
      timeout: 30000,
    },
  );
try {
  const help = call('--help');
  assert.equal(help.status, 0);
  assert.ok(help.stdout.includes('enable-premises-rights'));
  const denied = call('enable-premises-rights');
  assert.equal(denied.status, 1);
  assert.equal(JSON.parse(denied.stdout).ok, false);
  assert.notEqual(JSON.parse(denied.stdout).error, 'unknown-command');
  r = new OpenSocietyRuntime(root);
  assert.equal(r.state.world.premisesRights, undefined);
  r.close();
  const foundation = call('enable-society-foundations');
  assert.equal(foundation.status, 0);
  assert.equal(JSON.parse(foundation.stdout).status, 'enabled');
  r = new OpenSocietyRuntime(root);
  const before = structuredClone(r.state.world);
  r.close();
  const enabled = call('enable-premises-rights');
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.equal(JSON.parse(enabled.stdout).ok, true);
  r = new OpenSocietyRuntime(root);
  const after = structuredClone(r.state);
  r.close();
  assert.ok(after.world.premisesRights);
  for (const key of ['agents', 'premises', 'moneySupply', 'clock'])
    assert.deepEqual(after.world[key], before[key]);
  const bytes = readFileSync(join(root, 'journal.jsonl'));
  assert.equal(call('enable-premises-rights').status, 0);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  r = new OpenSocietyRuntime(root);
  assert.deepEqual(r.state, after);
  r.close();
  console.log(
    JSON.stringify({
      passed: true,
      discoveredInHelp: true,
      missingPrerequisitesExitCode: denied.status,
      refusal: JSON.parse(denied.stdout).error,
      enabledThroughCompiledCli: true,
      existingFactsPreserved: true,
      replayMatched: true,
      retryCreatedNoCommits: true,
    }),
  );
} finally {
  r.close();
  rmSync(root, { recursive: true, force: true });
}
