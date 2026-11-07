// Real compiled authenticated CLI/HTTP acceptance; explicit fixtures, no social emergence claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'paid-stock-vehicle-cli-'));
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
  runtime.finishTurn(actor, { summary: 'Actual stock/vehicle CLI acceptance' });
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
  assert.equal(runtime.enablePremisesPrincipals().ok, true);
  assert.equal(runtime.enableVehiclePrincipals().ok, true);
  assert.equal(runtime.enableResourceSales().ok, true);
  const beforeEnable = structuredClone(runtime.state.world);
  assert.equal(runtime.enableResourceSalesV2().ok, true);
  assert.deepEqual(runtime.state.world.agents, beforeEnable.agents);
  assert.deepEqual(runtime.state.world.materials, beforeEnable.materials);
  assert.deepEqual(runtime.state.world.residentMobility, beforeEnable.residentMobility);
  await cmd(a, 'stocks.create', { id: 's', title: '真实材料保管', locationId: location });
  await cmd(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 8 } });
  const stock = () => runtime.state.world.materials.stocks.s;
  const vehicle = () => runtime.state.world.residentMobility.vehicles['seed-car-1'];
  const resource = (kind) => (kind === 'stock' ? stock() : vehicle());
  const control = (kind, command) => ({
    resourceKind: kind,
    resourceId: resource(kind).id,
    resourceRevision: resource(kind).revision,
    controlVersion: resource(kind).control?.version ?? 1,
    command,
  });
  const at = runtime.state.world.clock.now,
    grant = runtime.state.world.publicGovernance.authority.grant;
  for (const kind of ['stock', 'vehicle']) {
    const publicPurchase = kind === 'vehicle';
    await cmd(a, 'principals.control', {
      request: control(kind, {
        type: 'offer',
        target: publicPurchase ? { kind: 'public', id: grant.id } : { kind: 'resident', id: b },
        terms: '保留库存、位置、身体、历史',
        expiresAt: at + 1000000,
      }),
    });
    const base = (await cmd(a, 'principals.read', { kind, id: resource(kind).id })).data;
    const saleId = `price-${kind}`;
    const command = {
      type: 'offer',
      id: saleId,
      title: '实际控制交易',
      terms: '不瞬移或冒领货物',
      resource: { kind, id: resource(kind).id, expectedRevision: resource(kind).revision },
      payer: publicPurchase
        ? { sector: 'treasury', id: 'public-treasury' }
        : { sector: 'agent', id: b },
      revenue: { sector: 'agent', id: a },
      amount: 25,
      acceptBy: resource(kind).control.offer.expiresAt,
    };
    await cmd(a, 'principals.operate', {
      request: {
        ...base.resourceSaleOfferBase,
        resourceId: saleId,
        operation: {
          capability: 'resource-sales.offer',
          arguments: { command, source: base.resourceSaleOfferSource },
        },
      },
    });
    const quote = (await cmd(a, 'principals.read', { kind: 'resource-sale', id: saleId })).data;
    const accept = quote.operations.accept;
    await cmd(b, 'principals.control', { request: control(kind, { type: 'accept' }) }, 1);
    await cmd(c, 'principals.operate', { request: accept }, 1);
    const beforeResource = structuredClone(resource(kind));
    let before = structuredClone(runtime.state.world);
    if (publicPurchase) {
      await cmd(a, 'governance.propose', {
        id: 'purchase',
        text: '新范围下独立批准确切车辆价格',
        action: {
          kind: 'manage-resource',
          expectedRevision: accept.resourceRevision,
          request: accept,
        },
        closesAt: runtime.state.world.clock.now + 60000,
        expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
      });
      assert.equal(
        runtime.state.world.publicGovernance.authority.proposals.purchase.resourceSalesScopeVersion,
        'public-paid-resource-control-v2',
      );
      for (const actor of [a, b, c])
        await cmd(actor, 'governance.vote', {
          id: 'purchase',
          choice: 'yes',
          expectedRevision:
            runtime.state.world.publicGovernance.authority.proposals.purchase.revision,
        });
      assert.equal(runtime.advanceTime(60000, 'actual-public-ballot').ok, true);
      await cmd(c, 'governance.close', {
        id: 'purchase',
        expectedRevision:
          runtime.state.world.publicGovernance.authority.proposals.purchase.revision,
      });
      before = structuredClone(runtime.state.world);
      const execute = {
        id: 'purchase',
        expectedRevision:
          runtime.state.world.publicGovernance.authority.proposals.purchase.revision,
      };
      await cmd(c, 'governance.execute', execute);
      await cmd(c, 'governance.execute', execute, 1);
      assert.equal(runtime.state.world.treasury, before.treasury - 25);
      assert.equal(runtime.state.world.agents[c].balance, before.agents[c].balance);
      assert.deepEqual(resource(kind).authorized, beforeResource.authorized);
      assert.deepEqual(resource(kind).cargoCapacity, beforeResource.cargoCapacity);
      assert.deepEqual(resource(kind).control.controller, { kind: 'public', id: grant.id });
    } else {
      await cmd(b, 'principals.operate', { request: accept });
      assert.equal(runtime.state.world.agents[b].balance, before.agents[b].balance - 25);
      assert.deepEqual(resource(kind).inventory, { Wood: 8 });
      assert.deepEqual(resource(kind).control.controller, { kind: 'resident', id: b });
    }
    assert.equal(runtime.state.world.agents[a].balance, before.agents[a].balance + 25);
    assert.equal(runtime.state.world.moneySupply, before.moneySupply);
    assert.equal(resource(kind).ownerId, beforeResource.ownerId);
    assert.equal(resource(kind).locationId, beforeResource.locationId);
    for (const actor of [a, b, c]) {
      assert.deepEqual(runtime.state.world.agents[actor].inventory, before.agents[actor].inventory);
      assert.deepEqual(
        runtime.state.world.agents[actor].physiology,
        before.agents[actor].physiology,
      );
      assert.equal(runtime.state.world.agents[actor].locationId, before.agents[actor].locationId);
    }
    await cmd(b, 'principals.operate', { request: accept }, 1);
    await cmd(c, 'principals.operate', { request: accept, actorId: a }, 2);
  }
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
        policy: 'resident-resource-sales-v2',
        calls: results.length,
        refusals: results.filter((r) => !r.ok).length,
        checks: [
          'stock-inventory-remains-physical',
          'vehicle-location-and-drivers-preserved',
          'public-fresh-v2-independent-ballot',
          'no-free-price-bypass',
          'actual-party-account',
          'no-body-or-cargo-assignment',
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
