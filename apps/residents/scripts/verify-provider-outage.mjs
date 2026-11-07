// Controlled runner diagnostics with a fake provider; no upstream model and no claim of
// autonomous behavior. Checks that provider failures before any call are handed back and retried
// instead of consuming residents' opportunities, and that a long outage stops the run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve(import.meta.dirname, '../dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'resident-provider-outage-'));
const counter = join(root, 'calls');
const executable = join(root, 'fake-provider.mjs');
// Fails while the shared call counter is at most FAIL_FIRST, then answers normally.
writeFileSync(
  executable,
  `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) { console.log('controlled-fixture'); process.exit(0); }
const file = ${JSON.stringify(counter)};
let n = 0; try { n = Number(readFileSync(file, 'utf8')); } catch {}
writeFileSync(file, String(++n));
const emit = (value) => console.log(JSON.stringify(value));
if (n <= Number(process.env.FAIL_FIRST)) {
  emit({ type: 'error', sessionID: 'fixture', error: { name: 'APIError', data: { message: 'socket closed' } } });
  process.exit(1);
}
emit({ type: 'text', sessionID: 'fixture-' + n, part: { text: 'fixture handoff ' + n } });
`,
  { mode: 0o700 },
);
const run = (town, failFirst, extra) => {
  writeFileSync(counter, '0');
  return spawnSync(
    process.execPath,
    [
      cli,
      'run',
      '--root',
      town,
      '--mode',
      'free',
      '--model',
      'fixture/model',
      '--opencode',
      executable,
      '--timeout',
      '20000',
      '--outage-backoff-ms',
      '100',
      ...extra,
    ],
    { encoding: 'utf8', env: { ...process.env, FAIL_FIRST: String(failFirst) } },
  );
};
const metrics = (town) =>
  JSON.parse(
    spawnSync(process.execPath, [cli, 'metrics', '--root', town], { encoding: 'utf8' }).stdout,
  );
const init = (town) => {
  const result = spawnSync(process.execPath, [cli, 'init', '--root', town, '--count', '2'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
};
try {
  // 1. A short outage: three failed calls, then recovery. The run reaches its target exactly.
  const town = join(root, 'recovering');
  init(town);
  const recovering = run(town, 3, ['--target-opportunities', '4', '--concurrency', '2']);
  assert.equal(recovering.status, 0, recovering.stderr);
  assert.match(recovering.stdout, /"status": "provider-unavailable"/);
  const m = metrics(town);
  assert.equal(m.attention.opportunities, 4);
  assert.equal(m.attention.requeuedProviderFailures, 3);
  // Resuming with the same target does nothing more.
  const again = run(town, 0, ['--target-opportunities', '4', '--concurrency', '2']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(metrics(town).attention.opportunities, 4);

  // 2. A provider that never answers: no opportunity is consumed and the run stops.
  const down = join(root, 'down');
  init(down);
  const before = JSON.parse(readFileSync(join(down, 'manifest.json'), 'utf8')).residents.length;
  const outage = run(down, 1_000_000, ['--target-opportunities', '2', '--max-outage-minutes', '0']);
  assert.equal(outage.status, 1);
  assert.match(outage.stdout, /"status": "provider-outage"/);
  const d = metrics(down);
  assert.equal(d.attention.opportunities, 0);
  assert.ok(d.attention.requeuedProviderFailures >= 1);
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'controlled-local-process-diagnostics-not-real-provider',
        recovering: {
          opportunities: m.attention.opportunities,
          requeued: m.attention.requeuedProviderFailures,
        },
        down: {
          residents: before,
          opportunities: d.attention.opportunities,
          requeued: d.attention.requeuedProviderFailures,
        },
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
