// Bounded unprompted observation. No desired social outcome is asserted.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createIntegratedSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
import {
  startResidentSocietyDaemon,
  loadResidentCredentials,
  townRequest,
  residentReport,
} from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/integrated-observation');
assert.equal(existsSync(root), false, 'use-fresh-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const manifest = createIntegratedSocietyManifest({
  count: 4,
  seed: 'integrated-observation-20261007',
});
const initialized = new OpenSocietyRuntime(root, manifest);
initialized.close();
const credentials = loadResidentCredentials(
  root,
  manifest.residents.map((r) => r.id),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = [
  'apps/residents/dist/index.js',
  'apps/residents/dist/residentShell.js',
  'apps/worker/dist/index.js',
];
const save = (name, value) =>
  writeFileSync(join(root, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
save('observation-plan.json', {
  evidenceClass: 'unprompted-free-observation',
  model: 'opencode-go/deepseek-v4.1-flash',
  residents: 4,
  maxOpportunities: 8,
  timeoutMs: 300000,
  seed: manifest.seed,
  sourceSha256: Object.fromEntries(sourceFiles.map((f) => [f, digest(readFileSync(f))])),
  limitations: [
    'single seed; finite observation, not stable emergence proof',
    'initial public institutions, assets, map and backgrounds are externally seeded',
    'provider failure stops this run and is retained',
  ],
});
const application = await startResidentSocietyDaemon({
  root,
  port: 0,
  model: 'opencode-go/deepseek-v4.1-flash',
  maxOpportunities: 8,
  timeoutMs: 300000,
  onProgress: (event) => console.log(JSON.stringify(event)),
});
let outcome;
try {
  outcome = await application.done;
  const live = await townRequest(
    { endpoint: application.url, token: credentials.admin },
    '/admin/report',
  );
  save('report.json', live);
  save('outcome.json', outcome);
} finally {
  await application.stop();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
const replay = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(
    JSON.parse(JSON.stringify(residentReport(replay))),
    JSON.parse(readFileSync(join(root, 'report.json'), 'utf8')),
  );
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  save('verification.json', {
    outcome,
    liveAdministratorReportMatchesReplay: true,
    journalUnchanged: true,
    journalSha256: digest(journal),
    simulationTime: replay.state.world.clock.now,
    limitations: [
      'administrator report comparison is not a full live-state snapshot',
      'no social success assertion; inspect events and original provider evidence',
    ],
  });
} finally {
  replay.close();
}
console.log(JSON.stringify({ stage: 'verified', ...outcome }));
