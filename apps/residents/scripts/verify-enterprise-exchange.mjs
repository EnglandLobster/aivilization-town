// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  OpenSocietyRuntime,
  createOpenSocietyManifest,
  serializableWorldPolicy,
} from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'enterprise-exchange-cli-'));
const m = createOpenSocietyManifest({ count: 4, continuity: true, programActions: true });
const [a, b, c, d] = m.residents.map((r) => r.id),
  locationId = 'town-square';
const initialWorld = {
  ...m.initialWorld,
  agents: Object.fromEntries(
    Object.entries(m.initialWorld.agents).map(([id, agent]) => [
      id,
      {
        ...agent,
        job: null,
        locationId,
        inventory: id === a ? { Wood: 20, 'Iron Ingot': 5 } : { Wood: 2 },
        physiology: { energy: 100, satiety: 100, health: 100 },
      },
    ]),
  ),
};
const runtime = new OpenSocietyRuntime(root, {
  ...m,
  initialWorld,
  worldPolicies: serializableWorldPolicy(m.seed, initialWorld, m.rhythm),
});
const credentials = loadResidentCredentials(root, [a, b, c, d]),
  server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url)),
  results = [];
let ordinal = 0,
  closed = false;
async function cmd(actor, route, args = {}, expectedCode = 0, requestId) {
  const argv = [
      ...route.split('.'),
      ...Object.entries(args).flatMap(([key, value]) => {
        const flag = '--' + key.replace(/[A-Z]/g, (s) => '-' + s.toLowerCase());
        if (Array.isArray(value)) return value.flatMap((v) => [flag, String(v)]);
        return [flag, typeof value === 'object' ? JSON.stringify(value) : String(value)];
      }),
    ],
    id = requestId ?? `atomic-exchange-cli-${++ordinal}`;
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...argv, '--request-id', id], {
      env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (v) => (out += v));
    child.stderr.on('data', (v) => (err += v));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit atomic exchange CLI acceptance' });
  assert.equal(result.code, expectedCode, `${route}: ${result.out} ${result.err}`);
  const parsed = JSON.parse(result.out);
  results.push({
    route,
    exitCode: result.code,
    ok: parsed.ok,
    ...(parsed.error ? { error: parsed.error } : {}),
  });
  return parsed;
}

const definition = (version = 'resident-program-actions-v3') => ({
  actionPolicyVersion: version,
  steps: [
    {
      principalId: b,
      capability: 'resource.control',
      arguments: {
        resourceKind: 'enterprise',
        resourceId: 'firm',
        expectedRevision: 1,
        control: {
          type: 'offer',
          expectedVersion: 1,
          target: { kind: 'resident', id: c },
          expiresAt: 60000,
          terms: 'Management alone; all capital and obligations remain',
        },
      },
    },
    {
      principalId: c,
      capability: 'resource.control',
      arguments: {
        resourceKind: 'enterprise',
        resourceId: 'firm',
        expectedRevision: 2,
        control: { type: 'accept', expectedVersion: 2 },
      },
    },
    {
      principalId: c,
      capability: 'payments.transfer',
      arguments: { targetId: b, amount: 30, note: 'Agreed management handover price, not equity' },
    },
  ],
});
const publish = (version) =>
  cmd(
    b,
    'programs.publish',
    {
      id: 'exchange',
      title: 'Original agreement',
      purpose: 'Residents choose why',
      runners: [a],
      definition: definition(version),
    },
    1,
  );
try {
  const originalManifest = readFileSync(join(root, 'manifest.json'));
  await cmd(b, 'business.found', {
    enterpriseId: 'firm',
    name: 'Residents business',
    occupationName: 'Helper',
    initialCapital: 100,
    maxEmployees: 2,
  });
  await publish('resident-program-actions-v2');
  await publish('resident-program-actions-v3');
  assert.equal(runtime.enableEnterprisePrograms().ok, true);
  assert.equal(runtime.enableEnterprisePrograms().ok, true);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), originalManifest);
  await publish('resident-program-actions-v2');
  await cmd(b, 'programs.publish', {
    id: 'exchange',
    title: 'Original agreement',
    purpose: 'Residents choose why',
    runners: [a],
    definition: definition(),
  });
  await cmd(a, 'programs.run', { id: 'exchange', expectedRevision: 1 }, 1);
  for (const actor of [b, c])
    await cmd(actor, 'mandates.grant', {
      id: `mandate-${actor}`,
      programId: 'exchange',
      programRevision: 1,
      runnerId: a,
      maxRuns: 1,
      expiresAt: 60000,
    });
  await cmd(c, 'payments.transfer', {
    targetId: d,
    amount: runtime.state.world.agents[c].balance,
    note: 'Another independent purchase',
  });
  const before = structuredClone(runtime.state);
  await cmd(a, 'programs.run', { id: 'exchange', expectedRevision: 1 }, 1, 'failed-no-funds');
  assert.deepEqual(runtime.state.world.enterprises, before.world.enterprises);
  assert.deepEqual(runtime.state.world.agents, before.world.agents);
  assert.deepEqual(runtime.state.coordination.mandates, before.coordination.mandates);
  await cmd(d, 'payments.transfer', { targetId: c, amount: 30, note: 'Voluntary contribution' });
  const payer = runtime.state.world.agents[c].balance,
    payee = runtime.state.world.agents[b].balance,
    supply = runtime.state.world.moneySupply;
  const receipt = await cmd(
    a,
    'programs.run',
    { id: 'exchange', expectedRevision: 1 },
    0,
    'success-with-funds',
  );
  const { control, ...company } = runtime.state.world.enterprises.firm;
  assert.deepEqual(company, before.world.enterprises.firm);
  assert.deepEqual(control.controller, { kind: 'resident', id: c });
  assert.equal(runtime.state.world.agents[c].balance, payer - 30);
  assert.equal(runtime.state.world.agents[b].balance, payee + 30);
  assert.equal(runtime.state.world.moneySupply, supply);
  assert.deepEqual(
    await cmd(a, 'programs.run', { id: 'exchange', expectedRevision: 1 }, 0, 'success-with-funds'),
    receipt,
  );
  const successful = Object.values(runtime.state.coordination.runs).find(
    (r) => r.status === 'succeeded',
  );
  assert.deepEqual(
    successful.execution.steps.map((s) => s.authority.principalId),
    [b, c, c],
  );
  assert.ok(
    successful.execution.steps.every(
      (s) =>
        s.authority.executedBy === a && s.authority.policyVersion === 'resident-program-actions-v3',
    ),
  );
  for (const mandate of Object.values(runtime.state.coordination.mandates))
    assert.equal(mandate.usedRuns, 1);
  await cmd(b, 'business.post-job', { enterpriseId: 'firm', wageOffer: 30, openSlots: 2 }, 1);
  await cmd(c, 'business.post-job', { enterpriseId: 'firm', wageOffer: 30, openSlots: 2 });
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
    assert.deepEqual(readFileSync(join(root, 'manifest.json')), originalManifest);
  } finally {
    reopened.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'directed-compiled-http-cli-not-free-emergence',
        calls: results.length,
        expectedRefusals: results.filter((r) => !r.ok).length,
        explicitV3: true,
        legacyV2StillRejectsEnterprise: true,
        independentMandates: true,
        failedAtomicExchangeNoEffects: true,
        failedAttemptNoMandateConsumption: true,
        principalAndExecutorSeparate: true,
        capitalAndObligationsPreserved: true,
        moneySupplyConserved: true,
        idempotentSuccess: true,
        replayEqual: true,
        manifestBytesUnchanged: true,
        journalBytesUnchanged: true,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  if (!closed) {
    await server.close();
    runtime.close();
  }
  rmSync(root, { recursive: true, force: true });
}
