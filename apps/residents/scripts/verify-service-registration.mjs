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
const directoryId = 'resident-services';
const request = (id, principal, enterpriseSupply = false) => ({
  resourceKind: 'service-directory',
  resourceId: directoryId,
  resourceRevision: runtime.state.services.registration.revision,
  controlVersion: 1,
  operation: {
    capability: 'services.create',
    arguments: {
      principal,
      command: {
        type: 'publish',
        id,
        kind: 'appointment',
        locationId: location,
        title: '居民原文目录',
        description: '不造设施或身体效果',
        capacity: 1,
      },
      ...(enterpriseSupply ? { enterpriseSupply: true } : {}),
    },
  },
});
const operate = (actor, request, expected = 0) =>
  cmd(actor, 'principals.operate', { request }, expected);
const serviceRequest = (id, capability, args) => {
  const v = runtime.state.services.services[id];
  return {
    resourceKind: 'service',
    resourceId: id,
    resourceRevision: v.revision,
    controlVersion: v.control.version,
    operation: { capability, arguments: args },
  };
};
const close = (actor, id) =>
  operate(
    actor,
    serviceRequest(id, 'services.close', {
      command: {
        type: 'close',
        id,
        expectedRevision: runtime.state.services.services[id].revision,
      },
    }),
  );
try {
  const manifestBytes = readFileSync(join(root, 'manifest.json'));
  assert.equal(runtime.enableServicePrincipals().ok, true);
  assert.equal(runtime.enableServiceSupply().ok, true);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifestBytes);
  await cmd(a, 'principals.read', { kind: 'service-directory', id: directoryId });
  await cmd(a, 'principals.list');
  await cmd(b, 'business.found', {
    enterpriseId: 'firm',
    name: '自拟供给企业',
    occupationName: '自拟',
    initialCapital: 100,
    maxEmployees: 3,
  });
  const create = request('firm-clinic', { kind: 'enterprise', id: 'firm' }, true);
  await operate(a, create, 1);
  const oldCash = runtime.state.world.enterprises.firm.balance;
  await operate(b, create);
  assert.equal(runtime.state.world.enterprises.firm.balance, oldCash);
  assert.deepEqual(runtime.state.services.services['firm-clinic'].namedProviders, []);
  assert.equal(runtime.state.services.services['firm-clinic'].enterpriseId, 'firm');
  await operate(b, create, 1);
  await cmd(b, 'principals.read', { kind: 'service', id: 'firm-clinic' });
  await cmd(b, 'business.close', { enterpriseId: 'firm' }, 1);
  await close(b, 'firm-clinic');
  const v = runtime.state.services.services['firm-clinic'],
    reopen = serviceRequest(v.id, 'services.reopen', { id: v.id, expectedRevision: v.revision });
  await operate(a, reopen, 1);
  await operate(b, reopen);
  assert.equal(runtime.state.services.services[v.id].active, true);
  await operate(b, reopen, 1);
  const publicId = runtime.state.world.publicGovernance.authority.grant.id,
    pub = request('public-clinic', { kind: 'public', id: publicId });
  await operate(c, pub, 1);
  await cmd(a, 'governance.propose', {
    id: 'create-public',
    text: '仅精确创建',
    action: { kind: 'manage-resource', expectedRevision: pub.resourceRevision, request: pub },
    closesAt: runtime.state.world.clock.now + 60000,
    expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
  });
  const rev = () =>
    runtime.state.world.publicGovernance.authority.proposals['create-public'].revision;
  for (const who of [a, b])
    await cmd(who, 'governance.vote', {
      id: 'create-public',
      expectedRevision: rev(),
      choice: 'yes',
    });
  assert.equal(runtime.advanceTime(60000, 'public-create-boundary').ok, true);
  await cmd(c, 'governance.close', { id: 'create-public', expectedRevision: rev() });
  await cmd(c, 'governance.execute', { id: 'create-public', expectedRevision: rev() });
  assert.equal(
    runtime.state.world.publicGovernance.authority.proposals['create-public'].status,
    'executed',
  );
  assert.deepEqual(runtime.state.services.services['public-clinic'].namedProviders, []);
  await cmd(b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '居民服务社团',
      terms: '逐项决定',
      members: [b, c],
      voters: [b, c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: 1000000,
  });
  await cmd(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  const collective = request('club-clinic', { kind: 'collective', id: 'club' });
  await cmd(b, 'collectives.propose', {
    id: 'create-club',
    collectiveId: 'club',
    expectedVersion: runtime.state.collectives.charters.club.version,
    terms: '仅精确创建',
    action: {
      kind: 'resource',
      capability: 'principals.operate',
      resourceId: directoryId,
      arguments: { request: collective },
    },
    closesAt: runtime.state.world.clock.now + 60000,
    executeBefore: 1000000,
  });
  const cr = () => runtime.state.collectives.decisions['create-club'].revision;
  for (const who of [b, c])
    await cmd(who, 'collectives.vote', { id: 'create-club', expectedRevision: cr(), vote: 'yes' });
  await cmd(b, 'collectives.decide', { id: 'create-club', expectedRevision: cr() });
  await operate(b, collective, 1);
  await cmd(b, 'collectives.execute', { id: 'create-club', expectedRevision: cr() });
  assert.equal(runtime.state.collectives.decisions['create-club'].status, 'executed');
  assert.deepEqual(runtime.state.services.services['club-clinic'].namedProviders, []);
  await cmd(c, 'principals.read', { kind: 'service', id: 'club-clinic' });
  const before = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, before);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify({
      passed: true,
      commands,
      expectedRefusals,
      policy: 'resident-service-supply-v3',
      checks: [
        'compiled-authenticated-cli',
        'explicit-migration-no-assets-or-manifest-rewrite',
        'positive-actual-directory-version',
        'enterprise-current-authority',
        'optional-enterprise-supply-separate',
        'no-created-provider-or-body-or-payment',
        'stale-approval-refused',
        'reopening-preserves-identity',
        'public-exact-approval-atomic',
        'collective-exact-approval-atomic',
        'external-service-estate-protected',
        'exact-journal-replay',
      ],
    }),
  );
} finally {
  if (!closed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
