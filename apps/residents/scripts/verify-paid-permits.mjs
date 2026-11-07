// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  OpenSocietyRuntime,
  createOpenSocietyManifest,
  serializableWorldPolicy,
} from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-paid-permits-cli-'));
const m = createOpenSocietyManifest({ count: 4, continuity: true });
const [a, b, c, d] = m.residents.map((r) => r.id),
  site = Object.values(m.initialWorld.premises.sites)[0],
  locationId = site.parentLocationId;
const initialWorld = {
  ...m.initialWorld,
  agents: Object.fromEntries(
    Object.entries(m.initialWorld.agents).map(([id, agent]) => [
      id,
      {
        ...agent,
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
    id = requestId ?? `paid-permit-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Explicit paid permission CLI acceptance' });
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
const time = (ms) => {
  const r = runtime.advanceTime(ms, `time-${++ordinal}`);
  assert.equal(r.ok, true, r.error);
};
const project = () => runtime.state.world.premises.projects.p,
  building = () => runtime.state.world.premises.buildings.home;
try {
  await cmd(a, 'permits.rules');
  await cmd(a, 'rules.read', { id: 'premises-use-rights' });
  await cmd(a, 'stocks.create', { id: 'materials', title: '实际供料', locationId });
  await cmd(a, 'stocks.deposit', {
    id: 'materials',
    expectedRevision: 1,
    items: { Wood: 8.1, 'Iron Ingot': 1 },
  });
  await cmd(a, 'materials.reserve', {
    id: 'supplies',
    stockId: 'materials',
    expectedStockRevision: 2,
    items: { Wood: 8.1, 'Iron Ingot': 1 },
    beneficiaryKind: 'resident',
    beneficiaryId: b,
    consumerDomain: 'premises',
    consumerId: 'p',
    terms: '这一建筑实际投入',
    expiresAt: runtime.state.world.clock.now + 1000000,
  });
  await cmd(b, 'construction.create', {
    id: 'p',
    kind: 'build',
    buildingId: 'home',
    siteId: site.id,
    expectedSiteRevision: 1,
    controllerKind: 'resident',
    controllerId: b,
    title: '居民命名的工坊',
    description: '材料与施工创造空间',
    workers: [c],
    reservationRefs: ['supplies@1'],
    primaryUse: 'production',
    floorArea: 8,
    capacity: 2,
    workstations: 1,
    careStations: 0,
    teachingStations: 0,
    storageUnits: 10,
  });
  await cmd(c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: runtime.state.world.clock.now + project().plan.workMs,
  });
  time(project().plan.workMs);
  assert.equal(project().status, 'completed');
  await cmd(c, 'travel.go', { targetLocationId: building().locationId }, 1);
  const duration = runtime.state.world.materials.policy.recipes.find((r) => r.id === 'book').workMs;
  const endAt = runtime.state.world.clock.now + 60000 + duration;
  await cmd(b, 'permits.offer', {
    id: 'permit',
    buildingId: 'home',
    buildingRevision: building().revision,
    granteeKind: 'resident',
    granteeId: c,
    users: [c],
    scopes: ['operate', 'store'],
    mode: 'exclusive',
    title: '约定的工坊时段',
    terms: '真实劳动自己开始，到期仍保留物品。',
    startAt: runtime.state.world.clock.now,
    endAt,
    acceptBy: runtime.state.world.clock.now + 30000,
  });
  await cmd(b, 'permits.accept', { id: 'permit', expectedRevision: 1 }, 1);
  await cmd(d, 'permits.read', { id: 'permit' }, 1);
  await cmd(c, 'permits.read', { id: 'permit' });
  const payerBefore = runtime.state.world.agents[c].balance;
  const sellerBefore = runtime.state.world.agents[b].balance;
  const moneySupply = runtime.state.world.moneySupply;
  await cmd(b, 'trades.offer', {
    id: 'price',
    sourceKind: 'permit',
    sourceId: 'permit',
    sourceRevision: 1,
    payerSector: 'agent',
    payerId: c,
    revenueSector: 'agent',
    revenueId: b,
    amount: 30,
    acceptBy: runtime.state.world.clock.now + 30000,
    title: '工坊使用价格',
    terms: '可用权限计时，不替居民评判满意',
  });
  await cmd(c, 'permits.accept', { id: 'permit', expectedRevision: 1 }, 1);
  await cmd(b, 'trades.accept', { id: 'price', expectedRevision: 1 }, 1);
  await cmd(d, 'trades.read', { id: 'price' }, 1);
  await cmd(c, 'trades.accept', { id: 'price', expectedRevision: 1 }, 0, 'accept-paid-once');
  await cmd(c, 'trades.accept', { id: 'price', expectedRevision: 1 }, 0, 'accept-paid-once');
  assert.equal(runtime.state.world.agents[c].balance, payerBefore - 30);
  assert.equal(runtime.state.world.agents[b].balance, sellerBefore);
  assert.equal(runtime.state.world.premisesRights.provisions.permit.orderId, 'price');
  assert.equal(runtime.state.world.premisesRights.permits.permit.revision, 2);
  assert.equal(
    (await cmd(b, 'permits.access', { buildingId: 'home' })).data.permissions.operate.allowed,
    false,
  );
  await cmd(c, 'travel.go', { targetLocationId: building().locationId });
  time(60000);
  await cmd(c, 'stocks.create', {
    id: 'own',
    title: '自己的物品',
    locationId: building().locationId,
  });
  await cmd(c, 'stocks.deposit', { id: 'own', expectedRevision: 1, items: { Wood: 1 } });
  await cmd(c, 'production.create', {
    id: 'book',
    stockId: 'own',
    expectedRevision: 2,
    recipeId: 'book',
    quantity: 1,
    productName: '居民作品',
    description: '署名作品',
    workers: [c],
  });
  await cmd(c, 'production.start', { id: 'book', expectedRevision: 1, until: endAt + 1 }, 1);
  await cmd(c, 'production.start', { id: 'book', expectedRevision: 1, until: endAt });
  await cmd(c, 'permits.release', { id: 'permit', expectedRevision: 2 }, 1);
  time(duration);
  assert.equal(runtime.state.world.materials.productions.book.status, 'completed');
  assert.equal(runtime.state.world.materials.stocks.own.inventory.Book, 1);
  assert.equal(runtime.state.world.premisesRights.permits.permit.status, 'expired');
  const access = (await cmd(c, 'permits.access', { buildingId: 'home' })).data.permissions;
  assert.equal(access.operate.allowed, false);
  assert.equal(access.store.allowed, false);
  assert.equal(access.entry.allowed, true);
  await cmd(
    c,
    'stocks.deposit',
    {
      id: 'own',
      expectedRevision: runtime.state.world.materials.stocks.own.revision,
      items: { Wood: 1 },
    },
    1,
  );
  await cmd(c, 'stocks.withdraw', {
    id: 'own',
    expectedRevision: runtime.state.world.materials.stocks.own.revision,
    recipientId: c,
    items: { Book: 1 },
  });
  assert.equal(runtime.state.world.agents[c].inventory.Book, 1);
  await cmd(c, 'permits.list', { limit: 1 });
  await cmd(c, 'permits.read', { id: 'permit' });
  assert.equal(
    runtime.state.experiences[d].some((e) => e.summary.includes('ResidentPremisesRightsCommitted')),
    false,
  );
  const order = () => runtime.state.world.residentTrade.orders.price;
  assert.equal(order().status, 'awaiting-confirmation');
  assert.equal(order().earned, 30);
  assert.equal(order().paid, 0);
  await cmd(c, 'trades.read', { id: 'price' });
  await cmd(c, 'trades.confirm', { id: 'price', expectedRevision: order().revision });
  assert.equal(order().status, 'completed');
  assert.equal(runtime.state.world.agents[b].balance, sellerBefore + 30);
  assert.equal(runtime.state.world.agents[c].balance, payerBefore - 30);
  assert.equal(runtime.state.world.moneySupply, moneySupply);
  await cmd(c, 'trades.ledger', { id: 'price' });
  const expected = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, expected);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    reopened.close();
  }
  const evidence = {
    capability: 'W05-paid-fixed-term-premises-rights',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    explicitTestSeed: {
      residents: 4,
      donor: { Wood: 20, 'Iron Ingot': 5 },
      otherResidents: { Wood: 2 },
      colocatedAtExistingSite: true,
    },
    cliCalls: results.length,
    expectedRefusals: results.filter((r) => r.exitCode !== 0).length,
    results,
    actualConstructionAndMovement: true,
    independentConsent: true,
    paymentAndPermissionAtomic: true,
    duplicateAcceptanceSingleDebit: true,
    directPermissionBypassRejected: true,
    termAvailabilityMetered: true,
    expirationDoesNotImplySatisfaction: true,
    exactPaymentAfterIndependentConfirmation: true,
    moneySupplyConserved: true,
    duplicateAcceptanceNoDuplicateRight: true,
    exclusiveScopeConstrainsController: true,
    fullWorkIntervalAuthorized: true,
    elapsedWorkSurvivesExpiry: true,
    newStorageDeniedAfterExpiry: true,
    physicalGoodsRetrieved: true,
    privateOriginals: true,
    replayEqual: true,
    journalBytesUnchanged: true,
  };
  if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (!closed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
