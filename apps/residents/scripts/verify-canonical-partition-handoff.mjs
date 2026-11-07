// Same-host real handoff of an existing world, not a seeded story or a multi-host claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenSocietyRuntime } from '@aivilization/worker';
import {
  startResidentServer,
  loadResidentCredentials,
  PARTITION_SCHEDULER_VERSION,
  RESIDENT_CLI_VERSION,
  preserveResidentProviderWorkspace,
} from '../dist/index.js';

const [sourceArg, outputArg, model = 'opencode-go/deepseek-v4.1-flash'] = process.argv.slice(2);
assert.ok(sourceArg && outputArg, 'source root and fresh output directory required');
const source = resolve(sourceArg),
  output = resolve(outputArg);
assert.equal(existsSync(output), false, 'fresh-compute-evidence-directory-required');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function evidenceFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const name = join(prefix, entry.name);
      if (entry.isDirectory()) return evidenceFiles(root, name);
      assert.ok(entry.isFile(), 'regular-provider-evidence-required');
      return [name];
    })
    .sort();
}
let runtime = new OpenSocietyRuntime(source),
  server,
  child;
let stopped = false;
let bootVerified = false;
const stop = () => {
  stopped = true;
  child?.kill('SIGTERM');
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
const attempts = [],
  copied = [],
  providers = [];
let failure, before, after, originalJournal, originalManifest, config;
try {
  assert.ok(runtime.manifest.canonicalPolicyContinuation, 'canonical-source-required');
  before = structuredClone(runtime.state);
  assert.ok(
    Object.values(before.residents).every(
      (r) =>
        r.activeTurnId === undefined ||
        runtime.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
    ),
    'unfinished-native-turn',
  );
  originalJournal = readFileSync(join(source, 'journal.jsonl'));
  originalManifest = readFileSync(join(source, 'manifest.json'));
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(join(output, 'before-state.json'), JSON.stringify(before), { mode: 0o600 });
  const ids = Object.keys(before.residents).sort();
  config = {
    version: PARTITION_SCHEDULER_VERSION,
    leaseMs: 600000,
    partitions: [0, 1].map((i) => ({
      id: `p${i + 1}`,
      token: randomBytes(32).toString('hex'),
      actors: ids.filter((_, n) => n % 2 === i),
    })),
  };
  writeFileSync(join(output, 'partition-config.json'), JSON.stringify(config), { mode: 0o600 });
  for (const partition of config.partitions) {
    const directory = join(output, 'compute', partition.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(output, `${partition.id}-credentials.json`),
      JSON.stringify({ partitionToken: partition.token }),
      { mode: 0o600 },
    );
    for (const actor of partition.actors) {
      const prior = Object.values(before.turns)
        .filter((t) => t.actorId === actor && t.sessionId)
        .at(-1);
      assert.ok(prior?.sessionId, `actual-prior-session-required:${actor}`);
      const actorSource = join(source, 'opencode', actor),
        marker = readFileSync(join(actorSource, 'cli-session.json'));
      const saved = JSON.parse(marker);
      assert.equal(saved.version, RESIDENT_CLI_VERSION);
      assert.equal(saved.sessionId, prior.sessionId);
      cpSync(actorSource, join(directory, actor), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      assert.deepEqual(readFileSync(join(directory, actor, 'cli-session.json')), marker);
      const files = evidenceFiles(actorSource).map((path) => {
        const bytes = readFileSync(join(actorSource, path));
        assert.deepEqual(readFileSync(join(directory, actor, path)), bytes);
        return { path, sha256: hash(bytes) };
      });
      const workspace = preserveResidentProviderWorkspace(
        actorSource,
        join(directory, actor),
        prior.sessionId,
      );
      copied.push({
        actorId: actor,
        partitionId: partition.id,
        priorTurnId: prior.id,
        sessionId: prior.sessionId,
        markerHash: hash(marker),
        files,
        workspace,
      });
    }
  }
  const credentials = loadResidentCredentials(source, ids);
  server = await startResidentServer(runtime, credentials, 0, { partitions: config });
  assert.deepEqual(runtime.state, before);
  assert.deepEqual(readFileSync(join(source, 'journal.jsonl')), originalJournal);
  bootVerified = true;
  const completed = new Set();
  let opportunities = 0;
  console.log(
    JSON.stringify({
      stage: 'partition-handoff-started',
      beforeRevision: before.revision,
      residents: ids.length,
      partitions: 2,
      url: server.url,
    }),
  );
  // Round-robin live clients keep both partitions serviced; waiting is not an opportunity.
  for (
    let claim = 0;
    claim < 120 && opportunities < 12 && completed.size < 2 && !stopped;
    claim++
  ) {
    const partition = config.partitions[claim % 2],
      directory = join(output, 'compute', partition.id);
    console.log(JSON.stringify({ stage: 'claim', partitionId: partition.id, claim }));
    const result = await new Promise((done, reject) => {
      child = spawn(
        process.execPath,
        [
          resolve('apps/residents/dist/cli.js'),
          'partition-run',
          '--root',
          directory,
          '--source',
          server.url,
          '--source-credentials',
          join(output, `${partition.id}-credentials.json`),
          '--model',
          model,
          '--timeout',
          '300000',
          '--claim-id',
          `canonical-handoff-${claim}`,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (b) => {
        stdout += b;
      });
      child.stderr.on('data', (b) => {
        stderr += b;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        child = undefined;
        done({ code, stdout, stderr });
      });
    });
    writeFileSync(join(output, `claim-${claim}.json`), JSON.stringify(result), { mode: 0o600 });
    assert.ok(result.stdout.trim(), result.stderr || 'no-partition-result');
    const value = JSON.parse(result.stdout);
    attempts.push({
      claim,
      partitionId: partition.id,
      code: result.code,
      status: value.status,
      actorId: value.actorId ?? null,
      turnId: value.turnId ?? null,
    });
    console.log(JSON.stringify({ stage: 'claim-finished', ...attempts.at(-1) }));
    if (value.status === 'waiting') {
      await delay(250);
      continue;
    }
    opportunities++;
    assert.ok(partition.actors.includes(value.actorId), 'wrong-partition-actor');
    const file = join(directory, value.actorId, `${value.turnId}.json`),
      bytes = readFileSync(file),
      evidence = JSON.parse(bytes);
    assert.equal(evidence.mode, 'free');
    assert.equal(evidence.task, 'free-activity');
    const old = copied.find((x) => x.actorId === value.actorId);
    providers.push({
      partitionId: partition.id,
      actorId: value.actorId,
      turnId: value.turnId,
      model: evidence.model,
      skillVersion: evidence.skillVersion,
      status: evidence.status,
      sessionId: evidence.sessionId,
      previousSessionId: old.sessionId,
      sessionPreserved: evidence.sessionId === old.sessionId,
      workspacePreserved: evidence.workspaceId === old.workspace.workspaceId,
      termination: evidence.termination,
      elapsedMs: evidence.elapsedMs,
      sha256: hash(bytes),
    });
    assert.equal(result.code, 0, result.stderr || evidence.status);
    assert.equal(evidence.status, 'completed');
    assert.equal(evidence.sessionId, old.sessionId, 'provider-session-not-preserved');
    assert.equal(
      evidence.workspaceId,
      old.workspace.workspaceId,
      'provider-workspace-not-preserved',
    );
    assert.equal(runtime.state.turns[value.turnId].sessionId, evidence.sessionId);
    completed.add(partition.id);
  }
  assert.equal(completed.size, 2, 'two-partition-completion-not-achieved');
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  if (server) await server.close();
  after = structuredClone(runtime.state);
  runtime.close();
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
}
assert.ok(
  before && originalJournal && originalManifest && existsSync(output),
  failure ?? 'setup-not-captured',
);
const bytes = readFileSync(join(source, 'journal.jsonl'));
assert.deepEqual(bytes.subarray(0, originalJournal.length), originalJournal);
assert.deepEqual(readFileSync(join(source, 'manifest.json')), originalManifest);
runtime = new OpenSocietyRuntime(source);
try {
  assert.deepEqual(runtime.state, after);
} finally {
  runtime.close();
}
assert.deepEqual(readFileSync(join(source, 'journal.jsonl')), bytes);
const report = {
  ok: !failure,
  failure: failure ?? null,
  version: 'canonical-partition-handoff-verification-v1',
  evidenceClass: 'same-host-two-partition-unprompted-handoff-not-concurrent-or-multihost',
  beforeRevision: before.revision,
  afterRevision: after.revision,
  beforeClock: before.world.clock.now,
  afterClock: after.world.clock.now,
  bootStateUnchanged: bootVerified,
  copied,
  attempts,
  providers,
  journalHash: hash(bytes),
  historicalPrefixPreserved: true,
  manifestUnchanged: true,
  fullReplayEqual: true,
};
writeFileSync(join(output, 'verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify({
    stage: 'partition-handoff-finished',
    ok: report.ok,
    failure: report.failure,
    afterRevision: report.afterRevision,
    providers: providers.length,
  }),
);
if (failure) process.exitCode = 1;
