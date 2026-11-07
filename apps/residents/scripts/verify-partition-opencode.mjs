// Two real compute processes and free model opportunities; no social task is injected.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createIntegratedSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
import {
  startResidentServer,
  loadResidentCredentials,
  PARTITION_SCHEDULER_VERSION,
} from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/partition-opencode-acceptance');
assert.equal(existsSync(root), false, 'use-fresh-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const manifest = createIntegratedSocietyManifest({ count: 2 });
const authorityRoot = join(root, 'authority');
const runtime = new OpenSocietyRuntime(authorityRoot, manifest);
const credentials = loadResidentCredentials(
  authorityRoot,
  manifest.residents.map((r) => r.id),
);
const config = {
  version: PARTITION_SCHEDULER_VERSION,
  leaseMs: 600000,
  partitions: manifest.residents.map((r, i) => ({
    id: `p${i + 1}`,
    token: randomBytes(32).toString('hex'),
    actors: [r.id],
  })),
};
writeFileSync(join(root, 'partitions.json'), JSON.stringify(config), { mode: 0o600 });
const server = await startResidentServer(runtime, credentials, 0, { partitions: config });
const results = [];
try {
  await Promise.all(
    config.partitions.map(async (p) => {
      const credentialPath = join(root, `${p.id}-credentials.json`);
      writeFileSync(credentialPath, JSON.stringify({ partitionToken: p.token }), { mode: 0o600 });
      const result = await new Promise((done, reject) => {
        const child = spawn(
          process.execPath,
          [
            resolve('apps/residents/dist/cli.js'),
            'partition-run',
            '--root',
            join(root, p.id),
            '--source',
            server.url,
            '--source-credentials',
            credentialPath,
            '--claim-id',
            `acceptance-${p.id}`,
            '--model',
            process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash',
            '--timeout',
            '300000',
          ],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let out = '',
          err = '';
        child.stdout.on('data', (b) => (out += b));
        child.stderr.on('data', (b) => (err += b));
        child.once('error', reject);
        child.once('close', (code, signal) => done({ partition: p.id, code, signal, out, err }));
      });
      results.push(result);
      writeFileSync(join(root, `${p.id}-process.json`), JSON.stringify(result, null, 2), {
        mode: 0o600,
      });
      console.log(
        JSON.stringify({ partition: p.id, code: result.code, status: 'process-finished' }),
      );
    }),
  );
} finally {
  await server.close();
  runtime.close();
}
const replay = new OpenSocietyRuntime(authorityRoot);
const state = structuredClone(replay.state);
const actors = new Set(manifest.residents.map((r) => r.id));
const calls = replay.journal.commits.filter(
  (c) => actors.has(c.actorId) && !c.capability.startsWith('turn.'),
);
replay.close();
const bytes = readFileSync(join(authorityRoot, 'journal.jsonl'));
const second = new OpenSocietyRuntime(authorityRoot);
assert.deepEqual(second.state, state);
second.close();
assert.deepEqual(readFileSync(join(authorityRoot, 'journal.jsonl')), bytes);
const providers = [];
for (const p of config.partitions) {
  const directory = join(root, p.id, p.actors[0]);
  if (existsSync(directory))
    for (const f of readdirSync(directory).filter(
      (f) => f.startsWith('turn-') && f.endsWith('.json'),
    )) {
      const path = join(directory, f),
        raw = readFileSync(path),
        d = JSON.parse(raw);
      providers.push({
        artifact: path,
        sha256: createHash('sha256').update(raw).digest('hex'),
        status: d.status,
        task: d.task,
        elapsedMs: d.elapsedMs,
        termination: d.termination,
      });
    }
}
const actorAssignmentCorrect =
  JSON.stringify(
    Object.values(state.turns)
      .map((t) => t.actorId)
      .sort(),
  ) === JSON.stringify(manifest.residents.map((r) => r.id).sort());
const clockBarrierHeld = state.world.clock.now === 0;
const report = {
  actorAssignmentCorrect,
  clockBarrierHeld,
  passed:
    actorAssignmentCorrect &&
    clockBarrierHeld &&
    results.every((r) => r.code === 0) &&
    providers.length === 2 &&
    providers.every((p) => p.status === 'completed'),
  evidenceClass: 'two-real-partition-free-opportunities-not-stable-emergence',
  partitions: results.map(({ partition, code, signal }) => ({ partition, code, signal })),
  providers,
  turns: Object.values(state.turns).map((t) => ({
    actorId: t.actorId,
    status: t.status,
    calls: t.calls,
  })),
  calls: calls.length,
  refusals: calls
    .filter((c) => !c.result.ok)
    .map((c) => ({ capability: c.capability, error: c.result.error })),
  simulationTime: state.world.clock.now,
  fullReplayEqual: true,
};
writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
