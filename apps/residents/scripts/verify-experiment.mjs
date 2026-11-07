// Controlled experiment-runner diagnostics with a fake provider; no upstream model and no claim of
// autonomous behavior. Checks arm setup, pinned settings, resumable targets and engine records.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve(import.meta.dirname, '../dist/cli.js');
const root = mkdtempSync(join(tmpdir(), 'resident-experiment-'));
const executable = join(root, 'fake-provider.mjs');
writeFileSync(
  executable,
  `#!${process.execPath}
if (process.argv.includes('--version')) { console.log('controlled-fixture'); process.exit(0); }
console.log(JSON.stringify({ type: 'text', sessionID: 'fixture', part: { text: 'fixture handoff' } }));
`,
  { mode: 0o700 },
);
const arms = [
  {
    name: 'baseline',
    root: join(root, 'a'),
    profile: 'society-integrated-v4',
    count: 2,
    initialization: 'settled',
  },
  {
    name: 'interdependent',
    root: join(root, 'b'),
    profile: 'society-interdependent-v3',
    count: 2,
    initialization: 'settled',
  },
];
const definition = (changes = {}) => ({
  version: 'open-society-experiment-v1',
  name: 'fixture',
  model: 'fixture/model',
  opencode: executable,
  timeoutMs: 20000,
  concurrency: 2,
  targetOpportunities: 3,
  maxOutageMinutes: 0,
  arms,
  ...changes,
});
const experiment = (value) => {
  const file = join(root, 'experiment.json');
  writeFileSync(file, JSON.stringify(value));
  return spawnSync(process.execPath, [cli, 'experiment', '--file', file], { encoding: 'utf8' });
};
const opportunities = (town) =>
  JSON.parse(
    spawnSync(process.execPath, [cli, 'metrics', '--root', town], { encoding: 'utf8' }).stdout,
  ).attention.opportunities;
const runs = (town) => readFileSync(join(town, 'experiment-runs.jsonl'), 'utf8').trim().split('\n');
try {
  const first = experiment(definition());
  assert.equal(first.status, 0, first.stdout + first.stderr);
  for (const arm of arms) {
    assert.equal(opportunities(arm.root), 3);
    const manifest = JSON.parse(readFileSync(join(arm.root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.provenance.runProfile, arm.profile);
    assert.equal(
      JSON.parse(readFileSync(join(arm.root, 'experiment.json'), 'utf8')).arm.name,
      arm.name,
    );
    const [record] = runs(arm.root).map((line) => JSON.parse(line));
    assert.match(record.engine.skill, /^town-resident-skill-v\d+$/);
    assert.match(record.engine.worker, /^[0-9a-f]{64}$/);
  }
  // Extending the target resumes the same towns.
  const extended = experiment(definition({ targetOpportunities: 5 }));
  assert.equal(extended.status, 0, extended.stdout + extended.stderr);
  for (const arm of arms) {
    assert.equal(opportunities(arm.root), 5);
    assert.equal(runs(arm.root).length, 2);
  }
  // Changing what is compared is refused before anything runs.
  const changed = experiment(definition({ concurrency: 1, targetOpportunities: 6 }));
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /experiment-arm-settings-changed:baseline/);
  for (const arm of arms) assert.equal(opportunities(arm.root), 5);
  // An arm pointed at a town of another profile is refused.
  const swapped = experiment(
    definition({ name: 'other', arms: [{ ...arms[0], profile: 'society-interdependent-v3' }] }),
  );
  assert.notEqual(swapped.status, 0);
  assert.match(swapped.stderr, /experiment-arm-town-mismatch:baseline/);
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'controlled-local-process-diagnostics-not-real-provider',
        arms: arms.map((arm) => ({ name: arm.name, opportunities: opportunities(arm.root) })),
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
