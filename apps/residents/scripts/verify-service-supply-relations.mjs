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
    resourceId: v.id,
    resourceRevision: v.revision,
    controlVersion: v.control?.version ?? 1,
    command,
  };
};
const relation = (command) => {
  const v = runtime.state.services.services.clinic;
  return {
    resourceKind: 'service',
    resourceId: v.id,
    resourceRevision: v.revision,
    controlVersion: v.control?.version ?? 1,
    operation: { capability: command.type, arguments: command },
  };
};
const operate = (actor, request, expected = 0) =>
  cmd(actor, 'principals.operate', { request }, expected);
const execute = (actor, request, expected = 0) =>
  cmd(actor, 'principals.control', { request }, expected);
const approve = (actor, request) =>
  operate(actor, {
    ...relation({ type: 'services.approve-control' }),
    operation: {
      capability: 'services.approve-control',
      arguments: {
        type: 'services.approve-control',
        request,
        expiresAt: runtime.state.world.clock.now + 1000000,
        registryRevision: runtime.state.services.affiliations.revision,
      },
    },
  });
const publicExecute = async (request, id) => {
  await cmd(a, 'governance.propose', {
    id,
    text: '仅这项资源动作',
    action: {
      kind: 'operation' in request ? 'manage-resource' : 'control-resource',
      expectedRevision: request.resourceRevision,
      request,
    },
    closesAt: runtime.state.world.clock.now + 60000,
    expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
  });
  const rev = () => runtime.state.world.publicGovernance.authority.proposals[id].revision;
  for (const who of [a, b])
    await cmd(who, 'governance.vote', { id, expectedRevision: rev(), choice: 'yes' });
  assert.equal(runtime.advanceTime(60000, `supply-cli-${id}`).ok, true);
  await cmd(c, 'governance.close', { id, expectedRevision: rev() });
  await cmd(c, 'governance.execute', { id, expectedRevision: rev() });
};
try {
  const manifestBytes = readFileSync(join(root, 'manifest.json'));
  for (const enable of [
    'enableServicePrincipals',
    'enableServiceSupply',
    'enableServiceAffiliations',
    'enableServiceSupplyRelations',
  ])
    assert.equal(runtime[enable]().ok, true);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifestBytes);
  assert.deepEqual(runtime.state.services.services, {});
  await cmd(b, 'business.found', {
    enterpriseId: 'firm',
    name: '原供给企业',
    occupationName: '自拟',
    initialCapital: 100,
    maxEmployees: 3,
  });
  await cmd(b, 'services.publish', {
    id: 'clinic',
    kind: 'appointment',
    locationId: location,
    enterpriseId: 'firm',
    title: '原文',
    description: '历史来源不是永久资产权',
    capacity: 1,
  });
  await cmd(b, 'services.schedule', {
    id: 'slot',
    serviceId: 'clinic',
    start: 0,
    end: 60000,
    capacity: 1,
  });
  await cmd(b, 'services.start', { id: 'slot', expectedRevision: 1, until: 60000 });
  const end = () =>
    relation({ type: 'services.end-supply', subject: { kind: 'enterprise', id: 'firm' } });
  await operate(b, end(), 1);
  await cmd(b, 'services.stop', {
    id: 'slot',
    expectedRevision: runtime.state.services.slots.slot.revision,
  });
  const before = structuredClone(runtime.state.world);
  await operate(c, end(), 1);
  await operate(b, end());
  assert.deepEqual(runtime.state.world, before);
  assert.equal(runtime.state.services.services.clinic.enterpriseId, 'firm');
  assert.equal(runtime.state.services.services.clinic.supplyRelation.enterpriseId, null);
  await cmd(b, 'business.close', { enterpriseId: 'firm' });
  assert.equal(runtime.state.world.enterprises.firm.status, 'closed');
  await execute(
    b,
    control({
      type: 'offer',
      target: { kind: 'resident', id: a },
      expiresAt: 1000000,
      terms: '原公司关闭不锁目录',
    }),
  );
  await execute(a, control({ type: 'accept' }));
  await cmd(c, 'business.found', {
    enterpriseId: 'new-firm',
    name: '新未来供给方',
    occupationName: '自拟',
    initialCapital: 100,
    maxEmployees: 3,
  });
  const invite = () =>
    relation({
      type: 'services.offer-supply',
      enterpriseId: 'new-firm',
      expiresAt: 1000000,
      terms: '新双方关系，旧账仍保留',
    });
  await operate(c, invite(), 1);
  await operate(a, invite());
  await cmd(c, 'principals.read', { kind: 'service', id: 'clinic' });
  const view = await cmd(b, 'services.read', { id: 'clinic' });
  assert.equal(view.data.supplyRelation, undefined);
  assert.equal(view.data.currentEnterpriseAffiliation, null);
  await operate(a, relation({ type: 'services.accept-supply' }), 1);
  await operate(c, relation({ type: 'services.accept-supply' }));
  assert.equal(runtime.state.services.services.clinic.supplyRelation.enterpriseId, 'new-firm');
  assert.equal(runtime.state.services.services.clinic.enterpriseId, 'firm');
  const offer = control({
    type: 'offer',
    target: { kind: 'resident', id: b },
    expiresAt: 1000000,
    terms: '目录与当前供给独立',
  });
  await execute(a, offer, 1);
  await approve(c, offer);
  await execute(a, offer);
  const accept = control({ type: 'accept' });
  await approve(c, accept);
  await execute(b, accept);
  await operate(
    c,
    relation({ type: 'services.end-supply', subject: { kind: 'enterprise', id: 'new-firm' } }),
  );
  assert.equal(runtime.state.services.services.clinic.supplyRelation.enterpriseId, null);
  await operate(
    b,
    relation({
      type: 'services.offer-supply',
      enterpriseId: 'new-firm',
      expiresAt: 1000,
      terms: '期限测试',
    }),
  );
  assert.equal(runtime.advanceTime(1000, 'supply-expiry').ok, true);
  await operate(c, relation({ type: 'services.accept-supply' }), 1);
  await operate(
    c,
    relation({ type: 'services.cancel-supply', subject: { kind: 'enterprise', id: 'new-firm' } }),
  );
  const publicId = runtime.state.world.publicGovernance.authority.grant.id;
  await execute(
    b,
    control({
      type: 'offer',
      target: { kind: 'public', id: publicId },
      expiresAt: 1000000,
      terms: '公共目录',
    }),
  );
  await publicExecute(control({ type: 'accept' }), 'public-take');
  await publicExecute(
    relation({
      type: 'services.offer-supply',
      enterpriseId: 'new-firm',
      expiresAt: 1000000,
      terms: '公共程序邀请，公司独立接受',
    }),
    'public-invite',
  );
  await operate(c, relation({ type: 'services.accept-supply' }));
  await publicExecute(
    relation({ type: 'services.end-supply', subject: { kind: 'public', id: publicId } }),
    'public-end',
  );
  assert.equal(runtime.state.services.services.clinic.control.controller.kind, 'public');
  assert.equal(runtime.state.services.services.clinic.enterpriseId, 'firm');
  assert.equal(runtime.state.services.services.clinic.supplyRelation.enterpriseId, null);
  assert.deepEqual(runtime.state.services.services.clinic.namedProviders, [b]);
  const state = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify({
      passed: true,
      commands,
      expectedRefusals,
      policy: 'resident-service-supply-relations-v5',
      checks: [
        'compiled-authenticated-cli',
        'explicit-migration-no-relationship-or-manifest-rewrite',
        'actual-provider-body-protected',
        'both-current-parties-separate',
        'historical-firm-close-independent-directory',
        'directory-invitation-enterprise-acceptance',
        'current-source-for-control',
        'old-source-and-obligations-preserved',
        'private-grants-not-public-text',
        'expiry-and-rejection',
        'public-exact-invite-and-end',
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
