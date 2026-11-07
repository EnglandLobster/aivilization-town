// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous-emergence claim.
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

const root = mkdtempSync(join(tmpdir(), 'resident-evidence-trade-cli-'));
const manifest = createOpenSocietyManifest({ count: 5, continuity: true });
const [a, b, c, d, outsider] = manifest.residents.map((r) => r.id);
const west = manifest.initialWorld.agents[a].locationId;
const east = Object.values(manifest.initialWorld.locations).find(
  (l) => l.locationId !== west && l.kind === 'market',
).locationId;
// Explicit finite engineering seeds. These initial goods and vehicle are not historical purchases.
const initialWorld = {
  ...manifest.initialWorld,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, actor]) => [
      id,
      {
        ...actor,
        inventory: { Wood: id === a ? 10 : 1 },
        locationId: id === c ? east : west,
        physiology: { health: 100, energy: 100, satiety: 100 },
      },
    ]),
  ),
  residentMobility: {
    ...manifest.initialWorld.residentMobility,
    vehicles: Object.fromEntries(
      Object.entries(manifest.initialWorld.residentMobility.vehicles).map(([id, v]) => [
        id,
        { ...v, locationId: west },
      ]),
    ),
  },
};
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld,
  worldPolicies: serializableWorldPolicy(manifest.seed, initialWorld, manifest.rhythm),
});
const credentials = loadResidentCredentials(root, [a, b, c, d, outsider]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
const results = [];
let ordinal = 0,
  closed = false;
async function call(actor, route, args = {}, expectedCode = 0, requestId) {
  const argv = [
    ...route.split('.'),
    ...Object.entries(args).flatMap(([key, value]) => {
      const flag = '--' + key.replace(/[A-Z]/g, (char) => '-' + char.toLowerCase());
      return Array.isArray(value)
        ? value.flatMap((v) => [flag, String(v)])
        : [flag, typeof value === 'object' ? JSON.stringify(value) : String(value)];
    }),
  ];
  runtime.beginTurn(actor);
  const response = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', requestId ?? `evidence-trade-cli-${++ordinal}`],
      {
        env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit evidence trade CLI acceptance' });
  assert.equal(response.code, expectedCode, `${route}: ${response.out} ${response.err}`);
  const parsed = JSON.parse(response.out);
  results.push({
    route,
    exitCode: response.code,
    ok: parsed.ok,
    ...(parsed.error ? { error: parsed.error } : {}),
  });
  return parsed;
}
const time = (ms) => {
  const r = runtime.advanceTime(ms, `evidence-trade-cli-tick-${++ordinal}`);
  assert.equal(r.ok, true, r.error);
};
const arrive = () =>
  time(runtime.state.world.transitByAgent[b].arrivesAt - runtime.state.world.clock.now);
const freight = (id) => runtime.state.world.logistics.freight[id];
const op = (actor, operation, id, code = 0) =>
  call(actor, `freight.${operation}`, { id, expectedRevision: freight(id).revision }, code);
async function prepare(id, vehicle = false) {
  await call(a, 'materials.reserve', {
    id: `goods-${id}`,
    stockId: 'src',
    expectedStockRevision: runtime.state.world.materials.stocks.src.revision,
    beneficiaryKind: 'resident',
    beneficiaryId: a,
    consumerDomain: 'logistics',
    consumerId: id,
    items: { Wood: 4 },
    terms: '只运送这一份真实原物',
    expiresAt: runtime.state.world.clock.now + 86400000,
  });
  await call(a, 'freight.offer', {
    id,
    controllerKind: 'resident',
    controllerId: a,
    recipientKind: 'resident',
    recipientId: c,
    sourceStockId: 'src',
    destinationStockId: 'dst',
    sourceLocationId: west,
    destinationLocationId: east,
    reservationId: `goods-${id}`,
    reservationRevision: 1,
    items: { Wood: 4 },
    carrierId: b,
    ...(vehicle ? { vehicleId: 'seed-car-1' } : {}),
    payerSector: 'agent',
    payerId: d,
    deliveryFee: 8,
    returnFee: 3,
    deadline: runtime.state.world.clock.now + 86400000,
    title: '居民自定运输',
    terms: '真实交付或实际退回才支付对应费用',
  });
  await op(c, 'accept', id);
  await op(d, 'fund', id);
}
const order = (id) => runtime.state.world.residentTrade.orders[id];
const trade = (actor, operation, id, args = {}, code = 0, requestId) =>
  call(
    actor,
    `trades.${operation}`,
    { id, expectedRevision: order(id).revision, ...args },
    code,
    requestId,
  );
async function offerTrade(id, sourceKind, sourceId, payerId, amount = 30) {
  const source =
    sourceKind === 'freight'
      ? freight(sourceId)
      : runtime.state.world.serviceEngagements.engagements[sourceId];
  await call(a, 'trades.offer', {
    id,
    sourceKind,
    sourceId,
    sourceRevision: source.revision,
    payerSector: 'agent',
    payerId,
    revenueSector: 'agent',
    revenueId: a,
    amount,
    acceptBy: runtime.state.world.clock.now + 600000,
    title: '居民定价与原文条款',
    terms: '基于真实履约；满意与事实分开确认',
  });
}
try {
  await call(a, 'trades.rules');
  await call(a, 'rules.read', { id: 'evidence-trade' });
  await call(a, 'stocks.create', { id: 'src', title: '来源', locationId: west });
  await call(c, 'stocks.create', { id: 'dst', title: '接收', locationId: east });
  await call(a, 'stocks.deposit', { id: 'src', expectedRevision: 1, items: { Wood: 8 } });
  await prepare('hand');
  await offerTrade('goods', 'freight', 'hand', c);
  await call(outsider, 'trades.read', { id: 'goods' }, 1);
  await call(b, 'trades.ledger', { id: 'goods' }, 1);
  await op(b, 'load', 'hand', 1);
  await trade(c, 'accept', 'goods');
  await call(
    c,
    'trades.observe',
    { id: 'goods', expectedRevision: order('goods').revision, evidence: { status: 'delivered' } },
    2,
  );
  await op(b, 'load', 'hand');
  await call(b, 'travel.go', { targetLocationId: east });
  await trade(c, 'withdraw', 'goods', {}, 1);
  arrive();
  await op(b, 'deliver', 'hand');
  assert.equal(order('goods').status, 'awaiting-confirmation');
  assert.deepEqual(runtime.state.world.materials.stocks.dst.inventory, { Wood: 4 });
  await trade(c, 'dispute', 'goods', { content: '收到真实货物，对描述有不同理解' });
  await trade(a, 'propose-settlement', 'goods', {
    content: '协商退回十，卖方收取二十',
    refund: 10,
  });
  await trade(a, 'respond-settlement', 'goods', { accept: true }, 1);
  const beforeSeller = runtime.state.world.agents[a].balance;
  await trade(c, 'respond-settlement', 'goods', { accept: true });
  assert.equal(order('goods').paid, 20);
  assert.equal(order('goods').refunded, 10);
  assert.equal(runtime.state.world.agents[a].balance, beforeSeller + 20);
  const ledger = await call(c, 'trades.ledger', { id: 'goods', limit: 30 });
  assert.match(JSON.stringify(ledger.data), /escrowAfter/);
  await call(c, 'trades.read', { id: 'goods' });
  await call(b, 'travel.go', { targetLocationId: west });
  arrive();
  await prepare('back');
  await offerTrade('returned', 'freight', 'back', c);
  await trade(c, 'accept', 'returned');
  await op(b, 'load', 'back');
  await call(b, 'travel.go', { targetLocationId: east });
  await op(a, 'cancel', 'back');
  assert.equal(order('returned').escrow, 30);
  assert.equal(freight('back').status, 'return-required');
  arrive();
  await call(b, 'travel.go', { targetLocationId: west });
  arrive();
  await op(b, 'return', 'back');
  assert.equal(order('returned').status, 'refunded');
  assert.equal(order('returned').refunded, 30);
  assert.equal(freight('back').paid, 3);
  assert.equal(freight('back').refunded, 5);
  const now = runtime.state.world.clock.now;
  await call(a, 'engagements.offer', {
    id: 'help',
    controllerKind: 'resident',
    controllerId: a,
    title: '居民安排帮助',
    terms: '本人实际参与',
    locationId: west,
    providerId: b,
    recipientId: a,
    payerSector: 'agent',
    payerId: d,
    revenueSector: 'agent',
    revenueId: a,
    providerShareBps: 0,
    pricePerHour: 0,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 60000,
    startAt: now,
    endAt: now + 120000,
    reservationRefs: [],
  });
  const service = () => runtime.state.world.serviceEngagements.engagements.help;
  await call(a, 'engagements.accept', { id: 'help', expectedRevision: service().revision });
  await call(d, 'engagements.fund', { id: 'help', expectedRevision: service().revision });
  // Acceptance must fit the real source window.
  await call(a, 'trades.offer', {
    id: 'service',
    sourceKind: 'service',
    sourceId: 'help',
    sourceRevision: service().revision,
    payerSector: 'agent',
    payerId: d,
    revenueSector: 'agent',
    revenueId: a,
    amount: 20,
    acceptBy: now + 30000,
    title: '他人赞助的服务',
    terms: '按真实重叠时长，未履行部分退回',
  });
  await call(
    b,
    'engagements.start',
    { id: 'help', expectedRevision: service().revision, until: now + 60000 },
    1,
  );
  await trade(d, 'accept', 'service');
  await call(b, 'engagements.start', {
    id: 'help',
    expectedRevision: service().revision,
    until: now + 60000,
  });
  await call(a, 'engagements.start', {
    id: 'help',
    expectedRevision: service().revision,
    until: now + 60000,
  });
  time(30000);
  await call(a, 'engagements.leave', { id: 'help', expectedRevision: service().revision });
  assert.equal(service().progressMs, 30000);
  assert.equal(service().charged, 0);
  assert.equal(order('service').earned, 10);
  assert.equal(order('service').refunded, 10);
  const revision = order('service').revision,
    beforePayment = runtime.state.world.agents[a].balance;
  await call(
    d,
    'trades.confirm',
    { id: 'service', expectedRevision: revision },
    0,
    'identical-confirmation',
  );
  await call(
    d,
    'trades.confirm',
    { id: 'service', expectedRevision: revision },
    0,
    'identical-confirmation',
  );
  assert.equal(runtime.state.world.agents[a].balance, beforePayment + 10);
  await call(a, 'trades.list');
  await call(d, 'trades.ledger', { id: 'service', limit: 30 });
  assert.doesNotMatch(
    JSON.stringify(runtime.state.experiences[outsider] ?? []),
    /town trades read --id/,
  );
  const before = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, before);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    reopened.close();
  }
  const evidence = {
    capability: 'W05-evidence-orders-foundation',
    mode: 'real-compiled-cli-http-engineering-acceptance',
    modelInvoked: false,
    explicitTestSeed: {
      residents: 5,
      sourceWood: 10,
      otherWoodPerResident: 1,
      distinctRealLocations: [west, east],
      worldPolicyRecordedAfterSeed: true,
    },
    cliCalls: results.length,
    results,
    buyerIndependentAcceptance: true,
    unfundedPhysicalStartRefused: true,
    noResidentProofInjection: true,
    actualFreightBeforeOrderFulfillment: true,
    carrierNotAutomaticallyGoodsParty: true,
    originalDisputeAndIndependentSettlement: true,
    inTransitCancellationPreservesEscrow: true,
    actualReturnRefundsOrder: true,
    carrierFeesSeparateFromGoodsPrice: true,
    actualPartialServiceAndRefund: true,
    sponsorSeparateFromPhysicalParticipants: true,
    noImplicitDoubleServiceCharge: true,
    duplicateConfirmationPaidOnce: true,
    outsiderPrivacy: true,
    replayEqual: true,
    journalBytesUnchanged: true,
    remainingScope: [
      'property-and-use-right-transfer',
      'long-term-obligations',
      'enterprise-and-public-procurement',
      'all-runtime-modes',
      'real-model-and-free-emergence-acceptance',
    ],
  };
  if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (!closed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
