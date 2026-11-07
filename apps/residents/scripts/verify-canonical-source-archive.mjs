// Real canonical writer process exits before the compiled operator CLI archives its source.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { bootstrapLocalSimulationRuntimeHostFromManifest } from '@aivilization/worker';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = resolve(process.argv[3] ?? process.argv[2] ?? '.local/canonical-archive-verification');
if (process.argv[2] === 'seed') {
  const presets = ['a', 'b'].map((id) => ({
    id,
    name: id,
    description: 'explicit canonical archive engineering fixture',
    clock: { now: 0, tickDurationMs: 1000 },
    timeScale: 35,
    locations: [
      {
        locationId: 'square',
        name: 'Square',
        kind: 'social',
        activityAffinities: ['study'],
        capacity: null,
        source: 'test',
      },
    ],
    agentSeeds: [
      {
        agentId: id,
        displayName: id,
        profile: { personality: { mbti: 'INTJ' }, source: 'test' },
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
        locationId: 'square',
        source: 'test',
        tags: ['test'],
      },
    ],
    source: 'test',
  }));
  const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
    rootDir: root,
    bootstrappedAt: 100,
    manifest: {
      id: 'archive-verification',
      defaults: { tickBatchSize: 1, tickIntervalMs: 100, commandConsumerIdPrefix: 'worker' },
      partitions: presets.map((p) => ({
        simulationId: 'archive-world',
        partitionKey: p.id,
        scenarioPresetId: p.id,
        marketPools: [
          { commodity: 'Fish', commodityReserve: 100, currencyReserve: 1000, source: 'test' },
        ],
        moneySupply: 1000,
      })),
    },
    scenarioPresets: presets,
    policies: {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 10,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 1, health: 1 },
    },
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
    simulationWideAuthority: {
      enabled: true,
      workerId: 'archive-verifier',
      leaseDurationMs: 30000,
    },
  });
  assert.ok(host.authority);
  host.authority.settleTrade({
    operationId: 'actual-buy',
    agentId: 'a',
    trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
    workerId: 'archive-verifier',
    observedAt: 200,
    durationMs: 30000,
  });
  const snapshot = host.authority.getSnapshot();
  assert.equal(snapshot.projection.agents.a.inventory.Fish, 1);
  writeFileSync(join(root, 'verification-capture.json'), JSON.stringify(snapshot));
} else {
  assert.equal(existsSync(root), false, 'fresh-verification-root-required');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const source = join(root, 'source'),
    target = join(root, 'archive');
  const seed = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'seed', source], {
    encoding: 'utf8',
  });
  assert.equal(seed.status, 0, seed.stderr);
  assert.equal(seed.signal, null);
  const before = readFileSync(join(source, 'verification-capture.json'));
  const cli = resolve('apps/server/dist/localRuntimeTownCliMain.js');
  const run = (args) =>
    spawnSync(process.execPath, [cli, 'export-society-source', ...args], { encoding: 'utf8' });
  const args = ['--source', source, '--target', target, '--confirm-source-stopped'];
  const first = run(args);
  assert.equal(first.status, 0, first.stderr);
  const second = run(args);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
  assert.deepEqual(readFileSync(join(target, 'source', 'verification-capture.json')), before);
  assert.deepEqual(readFileSync(join(source, 'verification-capture.json')), before);
  const noConfirmation = run(['--source', source, '--target', join(root, 'refused')]);
  assert.notEqual(noConfirmation.status, 0);
  assert.equal(existsSync(join(root, 'refused')), false);
  const metadata = JSON.parse(readFileSync(join(target, 'archive.json'), 'utf8'));
  for (const entry of metadata.entries)
    if (entry.kind === 'file') {
      assert.equal(digest(readFileSync(join(target, 'source', entry.path))), entry.sha256);
      assert.equal(digest(readFileSync(join(source, entry.path))), entry.sha256);
    }
  const report = {
    passed: true,
    root,
    actualCanonicalPartitions: 2,
    actualTrade: 'actual-buy',
    sourceWriterProcessExited: true,
    sourceCaptureSha256: digest(before),
    entries: metadata.entries.length,
    sourceTreeSha256: metadata.sourceTreeSha256,
    compiledCliCalls: 3,
    expectedRejections: 1,
    idempotent: true,
    allSourceAndArchiveFileHashesEqual: true,
    stopEvidence: metadata.stopEvidence,
    limitations: [
      'Controlled seed writer actually exited; generic CLI does not fence arbitrary existing writers.',
      'Archive preserves bytes including undelivered operations; not semantic migration or free emergence.',
    ],
  };
  writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
