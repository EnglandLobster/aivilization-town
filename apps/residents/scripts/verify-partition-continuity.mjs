// Controlled interruption + lost handoff, followed by real unprompted persistent opportunities.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createIntegratedSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
import {
  startResidentServer,
  loadResidentCredentials,
  runResidentPartitionOpportunity,
  PARTITION_SCHEDULER_VERSION,
} from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/partition-continuity-acceptance');
assert.equal(existsSync(root), false, 'use-fresh-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const worldRoot = join(root, 'authority'),
  compute = join(root, 'compute'),
  manifest = createIntegratedSocietyManifest({ count: 1 });
let runtime = new OpenSocietyRuntime(worldRoot, manifest);
const actor = manifest.residents[0].id;
const credentials = loadResidentCredentials(worldRoot, [actor]);
const config = {
  version: PARTITION_SCHEDULER_VERSION,
  leaseMs: 600000,
  partitions: [{ id: 'p1', token: randomBytes(32).toString('hex'), actors: [actor] }],
};
const credentialFile = join(root, 'partition-credentials.json');
writeFileSync(credentialFile, JSON.stringify({ partitionToken: config.partitions[0].token }), {
  mode: 0o600,
});
let server = await startResidentServer(runtime, credentials, 0, { partitions: config });
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
let failure,
  processResult,
  injected = false,
  lostHandoff = false;
try {
  const abort = new globalThis.AbortController();
  const invoke = runtime.invoke.bind(runtime);
  runtime.invoke = (actor, request) => {
    const result = invoke(actor, request);
    if (result.ok && !injected) {
      injected = true;
      globalThis.setTimeout(() => abort.abort('controlled-after-first-authoritative-receipt'), 100);
    }
    return result;
  };
  runtime.finishTurn = () => {
    throw Error('controlled-lost-handoff');
  };
  console.log(
    JSON.stringify({ stage: 'real-provider-interruption-and-lost-handoff', status: 'running' }),
  );
  try {
    await runResidentPartitionOpportunity({
      connection: { endpoint: server.url, token: config.partitions[0].token },
      directory: compute,
      claimId: 'interrupted',
      model,
      timeoutMs: 180000,
      signal: abort.signal,
    });
  } catch (error) {
    assert.match(String(error), /town-http-400/);
    lostHandoff = true;
  }
  assert.equal(injected, true);
  assert.equal(lostHandoff, true);
  const observed = JSON.parse(readFileSync(join(compute, actor, 'observed-session.json'), 'utf8'));
  assert.equal(typeof observed.sessionId, 'string');
  const before = structuredClone(runtime.state);
  await server.close();
  runtime.close();
  runtime = new OpenSocietyRuntime(worldRoot);
  assert.deepEqual(runtime.state, before);
  server = await startResidentServer(runtime, credentials, 0, { partitions: config });
  const filesBefore = readdirSync(join(compute, actor)).filter(
    (x) => x.startsWith('turn-') && x.endsWith('.json'),
  );
  const restored = await runResidentPartitionOpportunity({
    connection: { endpoint: server.url, token: config.partitions[0].token },
    directory: compute,
    claimId: 'restore-handoff',
    model,
  });
  assert.equal(restored.status, 'provider-error');
  assert.deepEqual(
    readdirSync(join(compute, actor)).filter((x) => x.startsWith('turn-') && x.endsWith('.json')),
    filesBefore,
  );
  assert.equal(runtime.state.turns[observed.turnId].sessionId, observed.sessionId);
  console.log(JSON.stringify({ stage: 'persistent-free-continuation', status: 'running' }));
  processResult = await new Promise((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve('apps/residents/dist/cli.js'),
        'partition-daemon',
        '--root',
        compute,
        '--source',
        server.url,
        '--source-credentials',
        credentialFile,
        '--max-opportunities',
        '2',
        '--timeout',
        '300000',
        '--model',
        model,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '',
      err = '';
    const timer = globalThis.setTimeout(() => child.kill('SIGTERM'), 700000);
    child.stdout.on('data', (b) => {
      out += b;
    });
    child.stderr.on('data', (b) => (err += b));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      globalThis.clearTimeout(timer);
      done({ code, signal, out, err });
    });
  });
  writeFileSync(join(root, 'worker-process.json'), JSON.stringify(processResult, null, 2), {
    mode: 0o600,
  });
  assert.equal(processResult.code, 0, processResult.err);
  const turns = Object.values(runtime.state.turns);
  assert.equal(turns.length, 3);
  assert.ok(turns.every((t) => t.sessionId === observed.sessionId));
  assert.equal(turns[0].status, 'provider-error');
  assert.ok(turns.slice(1).every((t) => t.status === 'completed' || t.status === 'waiting'));
  assert.ok(runtime.state.world.clock.now > 0);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}
const state = structuredClone(runtime.state);
await server.close();
runtime.close();
const bytes = readFileSync(join(worldRoot, 'journal.jsonl'));
const replay = new OpenSocietyRuntime(worldRoot);
assert.deepEqual(replay.state, state);
replay.close();
assert.deepEqual(readFileSync(join(worldRoot, 'journal.jsonl')), bytes);
const providers = [];
const dir = join(compute, actor);
if (existsSync(dir))
  for (const name of readdirSync(dir).filter((x) => x.startsWith('turn-') && x.endsWith('.json'))) {
    const path = join(dir, name),
      raw = readFileSync(path),
      value = JSON.parse(raw);
    providers.push({
      artifact: path,
      sha256: createHash('sha256').update(raw).digest('hex'),
      status: value.status,
      sessionId: value.sessionId,
      task: value.task,
      elapsedMs: value.elapsedMs,
      termination: value.termination,
    });
  }
const report = {
  passed: !failure,
  failure: failure ?? null,
  evidenceClass: 'controlled-real-interruption-and-persistent-free-continuation-not-emergence',
  injected,
  lostHandoff,
  processCode: processResult?.code ?? null,
  providers,
  turns: Object.values(state.turns).map((t) => ({
    id: t.id,
    actorId: t.actorId,
    status: t.status,
    sessionId: t.sessionId,
    calls: t.calls,
  })),
  simulationTime: state.world.clock.now,
  fullReplayEqual: true,
};
writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (failure) process.exitCode = 1;
