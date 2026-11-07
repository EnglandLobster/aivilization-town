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

const root = mkdtempSync(join(tmpdir(), 'resident-freight-cli-'));
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
      [executable, ...argv, '--request-id', requestId ?? `freight-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit freight CLI acceptance' });
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
  const r = runtime.advanceTime(ms, `freight-cli-tick-${++ordinal}`);
  assert.equal(r.ok, true, r.error);
};
const arrive = () =>
  time(runtime.state.world.transitByAgent[b].arrivesAt - runtime.state.world.clock.now);
const freight = (id) => runtime.state.world.logistics.freight[id];
const op = (actor, operation, id, code = 0) =>
  call(actor, `freight.${operation}`, { id, expectedRevision: freight(id).revision }, code);
async function prepare(id, vehicle = false, collectivePayer = false) {
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
    payerSector: collectivePayer ? 'collective' : 'agent',
    payerId: collectivePayer ? 'pool' : d,
    deliveryFee: 8,
    returnFee: 3,
    deadline: runtime.state.world.clock.now + 86400000,
    title: '居民自定运输',
    terms: '真实交付或实际退回才支付对应费用',
  });
  await op(c, 'accept', id);
  if (!collectivePayer) await op(d, 'fund', id);
}
try {
  await call(a, 'freight.rules');
  await call(a, 'rules.read', { id: 'physical-freight' });
  await call(a, 'stocks.create', { id: 'src', title: '来源材料', locationId: west });
  await call(c, 'stocks.create', { id: 'dst', title: '目的材料', locationId: east });
  await call(a, 'stocks.deposit', { id: 'src', expectedRevision: 1, items: { Wood: 8 } });
  await prepare('hand');
  await call(outsider, 'freight.read', { id: 'hand' }, 1);
  await op(a, 'load', 'hand', 1);
  await op(b, 'load', 'hand');
  assert.deepEqual(runtime.state.world.agents[b].inventory, { Wood: 1 });
  assert.equal(runtime.enableFreightCustody().ok, true);
  await call(b, 'freight.handoff', {
    id: 'hand',
    handoffId: 'relay',
    action: 'propose',
    nextCarrierId: outsider,
    expiresAt: runtime.state.world.clock.now + 100000,
  });
  await call(outsider, 'freight.handoffs', { id: 'hand', limit: 1 });
  await call(outsider, 'freight.read', { id: 'hand' });
  await call(
    outsider,
    'freight.handoff',
    { id: 'hand', handoffId: 'relay', action: 'accept', expectedRevision: 1 },
    1,
  );
  for (const [index, [actor, role]] of [
    [a, 'source'],
    [c, 'recipient'],
    [d, 'payer'],
    [b, 'previous-carrier'],
  ].entries())
    await call(actor, 'freight.handoff', {
      id: 'hand',
      handoffId: 'relay',
      action: 'consent',
      role,
      expectedRevision: index + 1,
    });
  const originalMaterials = structuredClone(runtime.state.world.materials);
  await call(
    outsider,
    'freight.handoff',
    { id: 'hand', handoffId: 'relay', action: 'accept', expectedRevision: 5 },
    0,
    'same-handoff',
  );
  await call(
    outsider,
    'freight.handoff',
    { id: 'hand', handoffId: 'relay', action: 'accept', expectedRevision: 5 },
    0,
    'same-handoff',
  );
  assert.equal(runtime.state.world.logistics.custody.proposals.relay.revision, 6);
  assert.deepEqual(runtime.state.world.materials, originalMaterials);
  assert.equal(
    (await call(outsider, 'freight.read', { id: 'hand' })).data.currentCustodian.carrierId,
    outsider,
  );

  await op(b, 'deliver', 'hand', 1);
  await call(outsider, 'travel.go', { targetLocationId: east });
  await op(outsider, 'deliver', 'hand', 1);
  time(runtime.state.world.transitByAgent[outsider].arrivesAt - runtime.state.world.clock.now);
  const version = freight('hand').revision,
    beforePay = runtime.state.world.agents[b].balance;
  await call(
    outsider,
    'freight.deliver',
    { id: 'hand', expectedRevision: version },
    0,
    'identical-delivery',
  );
  await call(
    outsider,
    'freight.deliver',
    { id: 'hand', expectedRevision: version },
    0,
    'identical-delivery',
  );
  assert.equal(runtime.state.world.agents[b].balance, beforePay + 8);
  assert.deepEqual(runtime.state.world.materials.stocks.dst.inventory, { Wood: 4 });
  const ledger = await call(d, 'freight.ledger', { id: 'hand' });
  assert.match(JSON.stringify(ledger.data), /escrowAfter/);
  await prepare('car', true);
  await call(a, 'vehicles.authorize', { id: 'seed-car-1', residentId: b, expectedRevision: 1 });
  await op(b, 'load', 'car');
  await call(a, 'vehicles.revoke', { id: 'seed-car-1', residentId: b, expectedRevision: 2 }, 1);
  await call(b, 'vehicles.drive', { id: 'seed-car-1', destinationId: east, expectedRevision: 2 });
  await op(a, 'cancel', 'car');
  const moving = await call(a, 'freight.read', { id: 'car' });
  assert.equal(freight('car').status, 'return-required');
  assert.equal(freight('car').escrow, 8);
  assert.doesNotMatch(JSON.stringify(moving.data), /"people"/);
  arrive();
  await op(b, 'return', 'car', 1);
  await call(b, 'vehicles.drive', {
    id: 'seed-car-1',
    destinationId: west,
    expectedRevision: runtime.state.world.residentMobility.vehicles['seed-car-1'].revision,
  });
  arrive();
  await op(b, 'return', 'car');
  assert.equal(freight('car').paid, 3);
  assert.equal(freight('car').refunded, 5);
  assert.deepEqual(runtime.state.world.materials.stocks.src.inventory, { Wood: 4 });
  await call(a, 'freight.list');
  await call(d, 'freight.ledger', { id: 'car' });
  assert.equal(runtime.enableCollectiveFreightCustody().ok, true);
  await call(a, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同运费',
      terms: '逐项确认',
      members: [a, d],
      voters: [a, d],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: runtime.state.world.clock.now + 100000,
  });
  await call(d, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  await call(a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '此次费用' });
  await call(d, 'funds.contribute', { id: 'pool', expectedRevision: 1, amount: 8, note: '原费用' });
  await prepare('collective', false, true);
  const decide = async (id, capability, args) => {
    await call(a, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: runtime.state.collectives.charters.club.version,
      terms: '只有列出的动作',
      action: { kind: 'resource', capability, resourceId: 'collective', arguments: args },
      closesAt: runtime.state.world.clock.now + 10000,
      executeBefore: runtime.state.world.clock.now + 20000,
    });
    for (const actor of [a, d])
      await call(actor, 'collectives.vote', {
        id,
        expectedRevision: runtime.state.collectives.decisions[id].revision,
        vote: 'yes',
      });
    await call(a, 'collectives.decide', {
      id,
      expectedRevision: runtime.state.collectives.decisions[id].revision,
    });
    await call(d, 'collectives.execute', {
      id,
      expectedRevision: runtime.state.collectives.decisions[id].revision,
    });
  };
  await decide('collective-pay', 'freight.fund', {
    expectedRevision: freight('collective').revision,
  });
  await op(b, 'load', 'collective');
  await call(b, 'freight.handoff', {
    id: 'collective',
    handoffId: 'collective-relay',
    action: 'propose',
    nextCarrierId: a,
    expiresAt: runtime.state.world.clock.now + 100000,
  });
  for (const [index, [actor, role]] of [
    [a, 'source'],
    [c, 'recipient'],
    [b, 'previous-carrier'],
  ].entries())
    await call(actor, 'freight.handoff', {
      id: 'collective',
      handoffId: 'collective-relay',
      action: 'consent',
      role,
      expectedRevision: index + 1,
    });
  await call(
    d,
    'freight.handoff',
    {
      id: 'collective',
      handoffId: 'collective-relay',
      action: 'consent',
      role: 'payer',
      expectedRevision: 4,
    },
    1,
  );
  await decide('collective-consent', 'freight.handoff', {
    handoffId: 'collective-relay',
    action: 'consent',
    role: 'payer',
    expectedRevision: 4,
  });
  assert.equal(runtime.state.collectives.decisions['collective-consent'].status, 'executed');
  await call(
    d,
    'freight.handoff',
    { id: 'collective', handoffId: 'collective-relay', action: 'accept', expectedRevision: 5 },
    1,
  );
  await call(a, 'freight.handoff', {
    id: 'collective',
    handoffId: 'collective-relay',
    action: 'accept',
    expectedRevision: 5,
  });
  await op(a, 'return', 'collective');
  assert.equal(runtime.state.world.commonAccounts.accounts.pool.balance, 5);
  assert.equal(freight('collective').paid, 3);
  assert.equal(freight('collective').carrierId, b);
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
    capability: 'W04-real-freight-custody',
    handoffPolicy: 'freight-custody-handoff-v1',
    collectiveHandoffPolicy: 'freight-custody-collective-grants-v1',
    exactCollectiveConsentConsumedOnce: true,
    consumedCollectiveConsentSupportsPersonalAcceptance: true,
    collectiveRepresentativeCannotAcceptForSuccessor: true,
    collectiveCargoReturnRefundsOriginalPool: true,
    independentHandoffSignatures: true,
    duplicateHandoffAppliedOnce: true,
    originalFeeBeneficiaryPreserved: true,
    invitedSuccessorReadsOnlyAfterProposal: true,
    actualSuccessorTravelAndDelivery: true,
    mode: 'real-compiled-cli-http-engineering-acceptance',
    modelInvoked: false,
    explicitTestSeed: {
      residents: 5,
      sourceWood: 10,
      otherWoodPerResident: 1,
      vehicleCargoUnits: 40,
      distinctRealLocations: [west, east],
      worldPolicyRecordedAfterSeed: true,
    },
    cliCalls: results.length,
    results,
    independentRecipientPayerAndCarrier: true,
    ordinaryInventorySeparateFromEntrustedCargo: true,
    actualHandTravelAndDelivery: true,
    duplicateDeliveryPaidOnce: true,
    actualVehicleJourney: true,
    loadedCancellationRetainsCargoAndEscrow: true,
    actualReturnAndPartialRefund: true,
    outsiderPrivacy: true,
    unrelatedPassengerIdentityNotDisclosed: true,
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
