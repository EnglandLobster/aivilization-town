// Compiled HTTP/CLI acceptance. This is a directed engineering check, not spontaneous Agent evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  OpenSocietyRuntime,
  createOpenSocietyManifest,
  serializableWorldPolicy,
} from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'resident-procurement-cli-'));
const manifest = createOpenSocietyManifest({ count: 4, continuity: true, publicGovernance: true });
const [a, b, c, d] = manifest.residents.map((r) => r.id);
const initialWorld = {
  ...manifest.initialWorld,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, agent]) => [
      id,
      {
        ...agent,
        locationId: manifest.initialWorld.agents[a].locationId,
        job: null,
        physiology: { health: 50, energy: 100, satiety: 100 },
      },
    ]),
  ),
};
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld,
  worldPolicies: serializableWorldPolicy(manifest.seed, initialWorld, manifest.rhythm),
});
const credentials = loadResidentCredentials(root, [a, b, c, d]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let ordinal = 0,
  refused = 0,
  closed = false;
async function call(actor, command, args = {}, expected = 0, requestId) {
  const argv = [...command.split(' ')];
  for (const [k, v] of Object.entries(args)) {
    const flag = `--${k.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`)}`;
    if (Array.isArray(v)) for (const item of v) argv.push(flag, String(item));
    else argv.push(flag, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  ordinal++;
  argv.push('--request-id', requestId ?? `procurement-cli-${ordinal}`);
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...argv], {
      env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (x) => {
      out += x;
    });
    child.stderr.on('data', (x) => {
      err += x;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit public procurement CLI acceptance' });
  assert.equal(result.code, expected, `${command}: ${result.out} ${result.err}`);
  if (expected) refused++;
  return JSON.parse(result.out);
}
const service = () => runtime.state.world.serviceEngagements.engagements.svc;
const proposal = () => runtime.state.world.publicGovernance.authority.proposals.purchase;
try {
  const bytes = readFileSync(join(root, 'manifest.json'));
  const terms = {
    id: 'svc',
    controllerKind: 'resident',
    controllerId: a,
    title: '自主服务名（测试）',
    terms: '本合同公开资金、时长账目；本人自愿参与。',
    locationId: initialWorld.agents[a].locationId,
    providerId: a,
    recipientId: b,
    payerSector: 'treasury',
    payerId: 'public-treasury',
    revenueSector: 'agent',
    revenueId: a,
    providerShareBps: 5000,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: 0,
    endAt: 7200000,
    reservationRefs: [],
  };
  await call(a, 'engagements offer', terms, 1);
  assert.equal(runtime.enablePublicProcurement().ok, true);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), bytes);
  assert.equal((await call(d, 'governance status')).data.procurement.abstractBudget, 'disabled');
  await call(a, 'engagements offer', { ...terms, id: 'private', payerSector: 'agent', payerId: a });
  await call(d, 'engagements read', { id: 'private' }, 1);
  await call(a, 'engagements offer', terms);
  assert.equal((await call(d, 'engagements read', { id: 'svc' })).data.maximumCharge, 36);
  await call(a, 'engagements accept', { id: 'svc', expectedRevision: 1 }, 1);
  await call(b, 'engagements accept', { id: 'svc', expectedRevision: 1 });
  await call(a, 'engagements fund', { id: 'svc', expectedRevision: 2 }, 1);
  await call(c, 'governance propose', {
    id: 'purchase',
    text: '工程验收选定合同，不是自由实验任务',
    action: { kind: 'fund-service', engagementId: 'svc', expectedRevision: 2, maximumCharge: 36 },
    closesAt: 60000,
    expectedProcedureRevision: 1,
  });
  await call(d, 'governance read', { id: 'purchase' });
  await call(c, 'governance execute', { id: 'purchase', expectedRevision: proposal().revision }, 1);
  for (const actor of [a, b, c])
    await call(actor, 'governance vote', {
      id: 'purchase',
      expectedRevision: proposal().revision,
      choice: 'yes',
    });
  assert.equal(runtime.advanceTime(60000, 'ballot-time').ok, true);
  await call(d, 'governance close', { id: 'purchase', expectedRevision: proposal().revision });
  const beforeTreasury = runtime.state.world.treasury,
    supply = runtime.state.world.moneySupply;
  const exactExecution = { id: 'purchase', expectedRevision: proposal().revision };
  const first = await call(c, 'governance execute', exactExecution, 0, 'exact-purchase');
  const retry = await call(c, 'governance execute', exactExecution, 0, 'exact-purchase');
  assert.deepEqual(first, retry);
  assert.equal(runtime.state.world.treasury, beforeTreasury - 36);
  assert.equal(service().progressMs, 0);
  assert.equal(service().escrow, 36);
  await call(c, 'governance execute', { id: 'purchase', expectedRevision: proposal().revision }, 1);
  for (const actor of [a, b])
    await call(actor, 'engagements start', {
      id: 'svc',
      expectedRevision: service().revision,
      until: 3660000,
    });
  assert.equal(runtime.advanceTime(600000, 'actual-service-time').ok, true);
  const ledger = (await call(d, 'engagements ledger', { id: 'svc', limit: 2 })).data;
  assert.match(JSON.stringify(ledger), /charge/);
  assert.doesNotMatch(
    JSON.stringify(ledger),
    /providerBefore|recipientBefore|ownBefore|educationScore|health|satiety|energy/,
  );
  assert.match(
    JSON.stringify((await call(b, 'engagements ledger', { id: 'svc', limit: 1 })).data),
    /ownBefore/,
  );
  const beforeRefund = runtime.state.world.treasury;
  await call(b, 'engagements leave', { id: 'svc', expectedRevision: service().revision });
  const finalService = (await call(d, 'engagements read', { id: 'svc' })).data;
  assert.equal(finalService.charged, 6);
  assert.equal(finalService.refunded, 30);
  assert.equal(finalService.status, 'ended');
  assert.equal(runtime.state.world.treasury, beforeRefund + 30);
  assert.equal(runtime.state.world.moneySupply, supply);
  assert.equal(
    runtime.journal.commits
      .flatMap((c) => c.worldEvents ?? [])
      .some((e) => e.type === 'PublicBudgetSpent'),
    false,
  );
  const finalState = structuredClone(runtime.state),
    journalBytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, finalState);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journalBytes);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        calls: ordinal,
        expectedRefusals: refused,
        actualProgressMs: finalService.progressMs,
        charge: finalService.charged,
        refund: finalService.refunded,
        moneySupplyUnchanged: true,
        replayVerified: true,
        manifestPreserved: true,
        privateBodyRedacted: true,
        publicDecisionAtomic: true,
        evidenceKind: 'directed-compiled-http-cli-acceptance-not-free-emergence',
      },
      null,
      2,
    ),
  );
} finally {
  if (!closed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
