// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous-emergence claim.
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

const root = mkdtempSync(join(tmpdir(), 'resident-public-goods-cli-'));
const manifest = createOpenSocietyManifest({
  count: 5,
  continuity: true,
  publicGovernance: true,
  publicProcurement: true,
  publicGoodsProcurement: true,
});
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
async function offerTrade(id, sourceKind, sourceId, amount = 30) {
  const source =
    sourceKind === 'freight'
      ? freight(sourceId)
      : runtime.state.world.serviceEngagements.engagements[sourceId];
  await call(a, 'trades.offer', {
    id,
    sourceKind,
    sourceId,
    sourceRevision: source.revision,
    payerSector: 'treasury',
    payerId: 'public-treasury',
    revenueSector: 'agent',
    revenueId: a,
    amount,
    acceptBy: runtime.state.world.clock.now + 600000,
    title: '居民定价与原文条款',
    terms: '基于真实履约；满意与事实分开确认',
  });
}
async function fund(id) {
  const pid = `fund-${id}`;
  const p = () => runtime.state.world.publicGovernance.authority.proposals[pid];
  await call(outsider, 'governance.propose', {
    id: pid,
    text: '明确受益人，由居民独立决定',
    action: {
      kind: 'fund-goods',
      orderId: id,
      expectedRevision: order(id).revision,
      amount: order(id).amount,
    },
    expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
    closesAt: runtime.state.world.clock.now + 60000,
  });
  for (const actor of [a, c, outsider])
    await call(actor, 'governance.vote', {
      id: pid,
      expectedRevision: p().revision,
      choice: 'yes',
    });
  time(60000);
  await call(b, 'governance.close', { id: pid, expectedRevision: p().revision });
  const before = runtime.state.world.treasury;
  const rev = p().revision;
  const request = `execute-${id}`;
  await call(outsider, 'governance.execute', { id: pid, expectedRevision: rev }, 0, request);
  await call(outsider, 'governance.execute', { id: pid, expectedRevision: rev }, 0, request);
  assert.equal(runtime.state.world.treasury, before - order(id).amount);
  await call(outsider, 'governance.execute', { id: pid, expectedRevision: p().revision }, 1);
}
try {
  const supply = runtime.state.world.moneySupply;
  await call(outsider, 'governance.status');
  await call(a, 'trades.rules');
  await call(a, 'stocks.create', { id: 'src', title: '来源', locationId: west });
  await call(c, 'stocks.create', { id: 'dst', title: '接收', locationId: east });
  await call(a, 'stocks.deposit', { id: 'src', expectedRevision: 1, items: { Wood: 8 } });
  await prepare('hand');
  await call(outsider, 'freight.read', { id: 'hand' }, 1);
  await offerTrade('goods', 'freight', 'hand');
  await call(outsider, 'trades.read', { id: 'goods' });
  await call(outsider, 'freight.read', { id: 'hand' });
  await trade(outsider, 'accept', 'goods', {}, 1);
  const beforeConsent = runtime.state.world.treasury;
  await trade(c, 'accept', 'goods');
  assert.equal(runtime.state.world.treasury, beforeConsent);
  assert.equal(order('goods').status, 'accepted');
  assert.equal(order('goods').escrow, 0);
  await op(b, 'load', 'hand', 1);
  await fund('goods');
  await op(b, 'load', 'hand');
  await call(b, 'travel.go', { targetLocationId: east });
  arrive();
  await op(b, 'deliver', 'hand');
  assert.equal(order('goods').status, 'awaiting-confirmation');
  assert.deepEqual(runtime.state.world.materials.stocks.dst.inventory, { Wood: 4 });
  await trade(outsider, 'confirm', 'goods', {}, 1);
  const beforeSeller = runtime.state.world.agents[a].balance;
  await trade(c, 'confirm', 'goods');
  assert.equal(runtime.state.world.agents[a].balance, beforeSeller + 30);
  assert.equal(order('goods').paid, 30);
  const ledger = await call(outsider, 'trades.ledger', { id: 'goods', limit: 30 });
  assert.match(JSON.stringify(ledger.data), /public-funder/);
  await call(outsider, 'freight.ledger', { id: 'hand', limit: 30 });
  await call(b, 'travel.go', { targetLocationId: west });
  arrive();
  await prepare('back');
  await offerTrade('returned', 'freight', 'back');
  await trade(c, 'accept', 'returned');
  await fund('returned');
  await op(b, 'load', 'back');
  await call(b, 'travel.go', { targetLocationId: east });
  await op(a, 'cancel', 'back');
  assert.equal(order('returned').escrow, 30);
  assert.equal(order('returned').refunded, 0);
  arrive();
  await call(b, 'travel.go', { targetLocationId: west });
  arrive();
  const beforeRefund = runtime.state.world.treasury,
    beforeRecipient = runtime.state.world.agents[c].balance;
  await op(b, 'return', 'back');
  assert.equal(order('returned').refunded, 30);
  assert.equal(runtime.state.world.treasury, beforeRefund + 30);
  assert.equal(runtime.state.world.agents[c].balance, beforeRecipient);
  assert.equal(runtime.state.world.moneySupply, supply);
  const before = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, before);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'directed-compiled-http-cli-acceptance-not-free-emergence',
        calls: results.length,
        expectedRefusals: results.filter((r) => !r.ok).length,
        results,
        independentBuyerConsent: true,
        exactPublicApproval: true,
        duplicateExecutionDebitedOnce: true,
        actualFreightDelivery: true,
        originalTreasuryRefundAfterPhysicalReturn: true,
        namedRecipientOwnership: true,
        privateFreightRemainedPrivateUntilPublicContract: true,
        publicLedger: true,
        moneySupplyUnchanged: true,
        replayEqual: true,
        journalBytesUnchanged: true,
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
