// Authenticated compiled CLI acceptance; this is an engineering scenario, not an emergence claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'service-principals-cli-'));
const manifest = createOpenSocietyManifest({ count: 3, continuity: true, publicGovernance: true });
const [a, b, c] = manifest.residents.map((v) => v.id);
const location = Object.values(manifest.initialWorld.locations).find(
  (l) => l.kind === 'market',
).locationId;
const initialWorld = {
  ...manifest.initialWorld,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, actor]) => [
      id,
      { ...actor, locationId: location },
    ]),
  ),
};
const runtime = new OpenSocietyRuntime(root, { ...manifest, initialWorld });
const credentials = loadResidentCredentials(root, [a, b, c]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let commands = 0,
  expectedRefusals = 0,
  closed = false;
async function cmd(actor, route, args = {}, expected = 0) {
  const argv = [
    ...route.split('.'),
    ...Object.entries(args).flatMap(([key, value]) => [
      '--' + key.replace(/[A-Z]/g, (v) => '-' + v.toLowerCase()),
      typeof value === 'object' ? JSON.stringify(value) : String(value),
    ]),
  ];
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `service-cli-${++commands}`],
      {
        env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    p.stdout.on('data', (v) => (out += v));
    p.stderr.on('data', (v) => (err += v));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit service authority CLI acceptance' });
  assert.equal(result.code, expected, `${route}: ${result.out} ${result.err}`);
  if (expected) expectedRefusals++;
  return JSON.parse(result.out);
}

const control = (command) => {
  const v = runtime.state.services.services.clinic;
  return {
    resourceKind: 'service',
    resourceId: 'clinic',
    resourceRevision: v.revision,
    controlVersion: v.control?.version ?? 1,
    command,
  };
};
const approval = (request, expiresAt = runtime.state.world.clock.now + 1000000) => {
  const v = runtime.state.services.services.clinic;
  return {
    resourceKind: 'service',
    resourceId: v.id,
    resourceRevision: v.revision,
    controlVersion: v.control?.version ?? 1,
    operation: {
      capability: 'services.approve-control',
      arguments: {
        type: 'services.approve-control',
        request,
        expiresAt,
        registryRevision: runtime.state.services.affiliations.revision,
      },
    },
  };
};
const approve = (actor, request) =>
  cmd(actor, 'principals.operate', { request: approval(request) });
const execute = (actor, request, expected = 0) =>
  cmd(actor, 'principals.control', { request }, expected);
const offer = (id) =>
  control({
    type: 'offer',
    target: { kind: 'resident', id },
    expiresAt: runtime.state.world.clock.now + 1000000,
    terms: '原目录、关联和义务保留',
  });
try {
  const manifestBytes = readFileSync(join(root, 'manifest.json'));
  assert.equal(runtime.enableServicePrincipals().ok, true);
  assert.equal(runtime.enableServiceSupply().ok, true);
  assert.equal(runtime.enableServiceAffiliations().ok, true);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifestBytes);
  assert.deepEqual(runtime.state.services.affiliations.consents, {});
  await cmd(b, 'business.found', {
    enterpriseId: 'firm',
    name: '自拟企业',
    occupationName: '自拟',
    initialCapital: 100,
    maxEmployees: 3,
  });
  await cmd(b, 'services.publish', {
    id: 'clinic',
    kind: 'appointment',
    locationId: location,
    enterpriseId: 'firm',
    title: '居民原文',
    description: '企业关联独立于目录控制',
    capacity: 1,
  });
  const before = structuredClone(runtime.state.world),
    directoryRevision = runtime.state.services.services.clinic.revision;
  await execute(b, offer(a));
  const accept = control({ type: 'accept' });
  await execute(a, accept, 1);
  await cmd(a, 'principals.operate', { request: approval(accept) }, 1);
  await approve(b, accept);
  assert.equal(runtime.state.services.services.clinic.revision, directoryRevision + 1);
  await cmd(b, 'principals.read', { kind: 'service', id: 'clinic' });
  await execute(a, accept);
  assert.equal(runtime.state.services.affiliations.consents.clinic.status, 'used');
  const next = offer(c);
  await execute(a, next, 1);
  await approve(b, next);
  await execute(a, { ...next, command: { ...next.command, terms: '擅自改原文' } }, 1);
  const consent = runtime.state.services.affiliations.consents.clinic;
  const revoke = {
    ...approval(next),
    operation: {
      capability: 'services.revoke-control',
      arguments: {
        type: 'services.revoke-control',
        expectedConsentVersion: consent.version,
        registryRevision: runtime.state.services.affiliations.revision,
      },
    },
  };
  await cmd(a, 'principals.operate', { request: revoke }, 1);
  await cmd(b, 'principals.operate', { request: revoke });
  await execute(a, next, 1);
  await cmd(b, 'principals.operate', { request: approval(next, 1000) });
  assert.equal(runtime.advanceTime(1000, 'affiliation-cli-expiry').ok, true);
  await execute(a, next, 1);
  await approve(b, next);
  await execute(a, next);
  const finalAccept = control({ type: 'accept' });
  await approve(b, finalAccept);
  await execute(a, finalAccept, 1);
  await execute(c, finalAccept);
  const durable = offer(b);
  await approve(b, durable);
  await cmd(b, 'resources.offer', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 1,
    expectedControlVersion: 1,
    target: { kind: 'resident', id: a },
    expiresAt: 1000000,
    terms: '管理交接不抹旧企业同意',
  });
  await cmd(a, 'resources.accept', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 2,
    expectedControlVersion: 2,
  });
  await execute(c, durable);
  const returnAccept = control({ type: 'accept' });
  await cmd(b, 'principals.operate', { request: approval(returnAccept) }, 1);
  await approve(a, returnAccept);
  await execute(b, returnAccept);
  const publicOffer = control({
    type: 'offer',
    target: { kind: 'public', id: runtime.state.world.publicGovernance.authority.grant.id },
    expiresAt: 1000000,
    terms: '公共控制，仍保留原关联',
  });
  await approve(a, publicOffer);
  await execute(b, publicOffer);
  const publicAccept = control({ type: 'accept' });
  await approve(a, publicAccept);
  await cmd(a, 'governance.propose', {
    id: 'public-accept',
    text: '只有目录控制',
    action: {
      kind: 'control-resource',
      expectedRevision: publicAccept.resourceRevision,
      request: publicAccept,
    },
    closesAt: runtime.state.world.clock.now + 60000,
    expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
  });
  const revision = () =>
    runtime.state.world.publicGovernance.authority.proposals['public-accept'].revision;
  for (const who of [a, b])
    await cmd(who, 'governance.vote', {
      id: 'public-accept',
      expectedRevision: revision(),
      choice: 'yes',
    });
  assert.equal(runtime.advanceTime(60000, 'affiliation-cli-public').ok, true);
  await cmd(c, 'governance.close', { id: 'public-accept', expectedRevision: revision() });
  await cmd(c, 'governance.execute', { id: 'public-accept', expectedRevision: revision() });
  assert.equal(runtime.state.services.services.clinic.control.controller.kind, 'public');
  assert.equal(runtime.state.services.services.clinic.ownerId, b);
  assert.equal(runtime.state.services.services.clinic.enterpriseId, 'firm');
  assert.equal(runtime.state.services.affiliations.consents.clinic.status, 'used');
  assert.equal(runtime.state.world.moneySupply, before.moneySupply);
  assert.deepEqual(runtime.state.services.slots, {});
  assert.deepEqual(runtime.state.services.bookings, {});
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify({
      passed: true,
      commands,
      expectedRefusals,
      policy: 'resident-service-affiliation-v4',
      checks: [
        'compiled-authenticated-cli',
        'explicit-migration-no-consent-or-manifest-rewrite',
        'independent-manager-and-controller',
        'approval-does-not-stale-directory',
        'exact-full-terms',
        'revocation-and-expiry',
        'manager-succession-preserves-grant',
        'public-exact-execution',
        'no-implied-provider-body-or-payment',
        'exact-journal-replay',
      ],
    }),
  );
} finally {
  if (!closed) {
    await server.close();
    runtime.close();
  }
  rmSync(root, { recursive: true, force: true });
}
