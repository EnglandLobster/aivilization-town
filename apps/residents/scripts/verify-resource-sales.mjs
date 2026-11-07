// Real compiled authenticated CLI/HTTP acceptance; explicit fixtures, no social emergence claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'paid-resource-cli-'));
const m = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  premises: true,
  premisesRights: true,
  resourcePrincipals: true,
  publicGovernance: true,
});
const [a, b, c] = m.residents.map((r) => r.id),
  site = Object.values(m.initialWorld.premises.sites)[0],
  location = site.parentLocationId;
const runtime = new OpenSocietyRuntime(root, {
  ...m,
  initialWorld: {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, v]) => [
        id,
        {
          ...v,
          locationId: location,
          inventory: { Wood: 20 },
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  },
});
const credentials = loadResidentCredentials(root, [a, b, c]),
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
    id = requestId ?? `paid-resource-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Actual paid resource CLI acceptance' });
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

try {
  const manifest = readFileSync(join(root, 'manifest.json'));
  assert.equal(runtime.enableResourceSales().ok, false);
  assert.equal(runtime.enablePremisesPrincipals().ok, true);
  const beforeEnable = structuredClone(runtime.state.world);
  assert.equal(runtime.enableResourceSales().ok, true);
  assert.deepEqual(runtime.state.world.agents, beforeEnable.agents);
  assert.deepEqual(runtime.state.world.premises, beforeEnable.premises);
  await cmd(a, 'stocks.create', { id: 's', title: '真实材料', locationId: location });
  await cmd(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 8 } });
  await cmd(a, 'materials.reserve', {
    id: 'materials',
    stockId: 's',
    expectedStockRevision: 2,
    beneficiaryKind: 'resident',
    beneficiaryId: b,
    consumerDomain: 'premises',
    consumerId: 'build',
    items: { Wood: 8 },
    terms: '仅建这座房屋',
    expiresAt: runtime.state.world.clock.now + 1000000,
  });
  await cmd(b, 'construction.create', {
    id: 'build',
    kind: 'build',
    buildingId: 'home',
    siteId: site.id,
    expectedSiteRevision: 1,
    controllerKind: 'resident',
    controllerId: b,
    title: '真实有限建筑',
    description: '原始作者与劳动保留',
    workers: [b, c],
    reservationRefs: ['materials@1'],
    primaryUse: 'residence',
    floorArea: 8,
    capacity: 2,
    workstations: 0,
    careStations: 0,
    teachingStations: 0,
    storageUnits: 0,
  });
  let project = runtime.state.world.premises.projects.build;
  await cmd(c, 'construction.start', {
    id: 'build',
    expectedRevision: project.revision,
    until: runtime.state.world.clock.now + project.plan.workMs,
  });
  assert.equal(runtime.advanceTime(project.plan.workMs, 'actual-build').ok, true);
  const building = () => runtime.state.world.premises.buildings.home,
    control = (command) => ({
      resourceKind: 'premises',
      resourceId: 'home',
      resourceRevision: building().revision,
      controlVersion: building().control.version,
      command,
    }),
    offer = () => ({
      type: 'offer',
      id: 'sale',
      title: '独立报价',
      terms: '真实交割不强制入住',
      resource: { kind: 'premises', id: 'home', expectedRevision: building().revision },
      payer: { sector: 'treasury', id: 'public-treasury' },
      revenue: { sector: 'agent', id: b },
      amount: 25,
      acceptBy: building().control.offer.expiresAt,
    }),
    at = runtime.state.world.clock.now,
    grant = runtime.state.world.publicGovernance.authority.grant;
  await cmd(b, 'principals.control', {
    request: control({
      type: 'offer',
      target: { kind: 'public', id: grant.id },
      terms: '公共接管确切房屋',
      expiresAt: at + 1000000,
    }),
  });
  const base = (await cmd(b, 'principals.read', { kind: 'premises', id: 'home' })).data;
  await cmd(b, 'principals.operate', {
    request: {
      ...base.resourceSaleOfferBase,
      resourceId: 'sale',
      operation: {
        capability: 'resource-sales.offer',
        arguments: { command: offer(), source: base.resourceSaleOfferSource },
      },
    },
  });
  const quoted = (await cmd(b, 'principals.read', { kind: 'resource-sale', id: 'sale' })).data;
  await cmd(c, 'principals.control', { request: control({ type: 'accept' }) }, 1);
  const accept = quoted.operations.accept;
  await cmd(c, 'principals.operate', { request: accept }, 1);
  await cmd(a, 'governance.propose', {
    id: 'purchase',
    text: '完整价格、收入账户和控制接管',
    action: { kind: 'manage-resource', expectedRevision: accept.resourceRevision, request: accept },
    closesAt: at + 60000,
    expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
  });
  for (const actor of [a, b, c])
    await cmd(actor, 'governance.vote', {
      id: 'purchase',
      choice: 'yes',
      expectedRevision: runtime.state.world.publicGovernance.authority.proposals.purchase.revision,
    });
  assert.equal(runtime.advanceTime(60000, 'actual-voting').ok, true);
  await cmd(c, 'governance.close', {
    id: 'purchase',
    expectedRevision: runtime.state.world.publicGovernance.authority.proposals.purchase.revision,
  });
  const before = structuredClone(runtime.state.world),
    execute = {
      id: 'purchase',
      expectedRevision: runtime.state.world.publicGovernance.authority.proposals.purchase.revision,
    };
  await cmd(c, 'governance.execute', execute);
  assert.deepEqual(building().control.controller, { kind: 'public', id: grant.id });
  assert.equal(runtime.state.world.treasury, before.treasury - 25);
  assert.equal(runtime.state.world.agents[b].balance, before.agents[b].balance + 25);
  assert.equal(runtime.state.world.agents[c].balance, before.agents[c].balance);
  assert.equal(runtime.state.world.moneySupply, before.moneySupply);
  assert.equal(building().ownerId, b);
  assert.deepEqual(building().embodied, before.premises.buildings.home.embodied);
  assert.deepEqual(runtime.state.world.materials, before.materials);
  await cmd(c, 'governance.execute', execute, 1);
  await cmd(c, 'principals.read', { kind: 'resource-sale', id: 'sale' });
  await cmd(c, 'principals.operate', { request: accept, actorId: b }, 2);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const replay = new OpenSocietyRuntime(root);
  assert.deepEqual(replay.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  replay.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        validation: 'compiled-authenticated-HTTP-CLI-not-emergence',
        policy: 'resident-resource-sales-v1',
        calls: results.length,
        refusals: results.filter((r) => !r.ok).length,
        checks: [
          'real-materials-and-own-labor',
          'explicit-fiscal-control-scope',
          'independent-public-price-vote',
          'atomic-payment-and-control',
          'manager-not-private-payee',
          'no-free-price-bypass',
          'old-author-assets-position-and-obligations',
          'one-time-execution',
          'identity-binding',
          'full-journal-replay',
        ],
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
