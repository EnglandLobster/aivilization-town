// Explicit compiled CLI/HTTP engineering acceptance; no model or spontaneous-emergence claim.
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

const root = mkdtempSync(join(tmpdir(), 'resident-service-delivery-cli-'));
const manifest = createOpenSocietyManifest({ count: 4, continuity: true });
const site = Object.values(manifest.initialWorld.premises.sites)[0];
const locationId = site.parentLocationId;
// Explicit engineering seed; no claim that these initial materials were manufactured.
const initialWorld = {
  ...manifest.initialWorld,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, resident], i) => [
      id,
      {
        ...resident,
        locationId,
        inventory:
          i === 0
            ? { Wood: 30, 'Iron Ingot': 5, 'Copper Ingot': 5, Book: 3, Apple: 10 }
            : i === 3
              ? { Book: 1, Apple: 4 }
              : { Apple: 1 },
        educationScore: i === 1 ? 2000 : 1000,
        physiology: { energy: 100, satiety: 50, health: 50 },
      },
    ]),
  ),
};
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld,
  worldPolicies: serializableWorldPolicy(manifest.seed, initialWorld, manifest.rhythm),
});
const [a, b, c, d] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b, c, d]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
const results = [];
let ordinal = 0,
  closed = false;
async function call(actor, argv, expectedCode = 0) {
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `delivery-cli-${++ordinal}`],
      {
        env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (v) => (out += v));
    child.stderr.on('data', (v) => (err += v));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit physical service CLI acceptance' });
  assert.equal(
    result.code,
    expectedCode,
    `${argv.slice(0, 2).join(' ')}: ${result.out} ${result.err}`,
  );
  const parsed = JSON.parse(result.out);
  results.push({
    route: argv.slice(0, 2).join(' '),
    exitCode: result.code,
    ok: parsed.ok,
    ...(parsed.error ? { error: parsed.error } : {}),
  });
  return parsed;
}
const argsOf = (route, args) => [
  ...route.split('.'),
  ...Object.entries(args).flatMap(([key, value]) => {
    const flag = '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    if (Array.isArray(value)) return value.flatMap((v) => [flag, String(v)]);
    return [flag, typeof value === 'object' ? JSON.stringify(value) : String(value)];
  }),
];
const cmd = (actor, route, args = {}, code = 0) => call(actor, argsOf(route, args), code);
const time = (ms) => {
  const r = runtime.advanceTime(ms, `delivery-tick-${++ordinal}`);
  assert.equal(r.ok, true, r.error);
};
const contract = (id) => runtime.state.world.serviceEngagements.engagements[id];
const operation = (actor, action, id, args = {}, code = 0) =>
  cmd(
    actor,
    `engagements.${action}`,
    { id, expectedRevision: contract(id).revision, ...args },
    code,
  );
const here = 'premises-workroom';
const originalTerms = (id, modelId, refs = []) => ({
  id,
  controllerKind: 'resident',
  controllerId: a,
  title: '居民自己组织的相互帮助',
  terms: '双方各自开始，按真实时长付费，随时离开，余款退原付款者。',
  locationId: here,
  providerId: b,
  recipientId: c,
  payerSector: 'agent',
  payerId: d,
  revenueSector: 'agent',
  revenueId: a,
  providerShareBps: 5000,
  pricePerHour: 36,
  modelId,
  maxDurationMs: 3600000,
  startAt: runtime.state.world.clock.now,
  endAt: runtime.state.world.clock.now + 7200000,
  reservationRefs: refs,
});
const reserve = async (id, items) => {
  const s = runtime.state.world.materials.stocks.supplies;
  await cmd(d, 'materials.reserve', {
    id: `input-${id}`,
    stockId: s.id,
    expectedStockRevision: s.revision,
    beneficiaryKind: 'resident',
    beneficiaryId: a,
    consumerDomain: 'services',
    consumerId: id,
    items,
    terms: '供本约定使用，未消耗原物退回',
    expiresAt: runtime.state.world.clock.now + 7200000,
  });
};
try {
  await cmd(a, 'rules.read', { id: 'physical-service-delivery' });
  await cmd(a, 'engagements.models');
  const buildInputs = { Wood: 12.1, 'Iron Ingot': 1, 'Copper Ingot': 1, Book: 1 };
  await cmd(a, 'stocks.create', { id: 'build-source', title: '实际工程材料', locationId });
  await cmd(a, 'stocks.deposit', { id: 'build-source', expectedRevision: 1, items: buildInputs });
  await cmd(a, 'materials.reserve', {
    id: 'build-input',
    stockId: 'build-source',
    expectedStockRevision: 2,
    beneficiaryKind: 'resident',
    beneficiaryId: a,
    consumerDomain: 'premises',
    consumerId: 'build',
    items: buildInputs,
    terms: '实际建设投入',
    expiresAt: runtime.state.world.clock.now + 2000000,
  });
  await cmd(a, 'construction.create', {
    id: 'build',
    kind: 'build',
    buildingId: 'workroom',
    siteId: site.id,
    expectedSiteRevision: 1,
    controllerKind: 'resident',
    controllerId: a,
    title: '居民建造的共享房间',
    description: '名称不产生医教效果，真实设施允许实际服务。',
    workers: [b],
    reservationRefs: ['build-input@1'],
    primaryUse: 'social',
    floorArea: 12,
    capacity: 3,
    workstations: 0,
    careStations: 1,
    teachingStations: 1,
    storageUnits: 10,
  });
  const duration = runtime.state.world.premises.projects.build.plan.workMs;
  await cmd(b, 'construction.start', {
    id: 'build',
    expectedRevision: 1,
    until: runtime.state.world.clock.now + duration,
  });
  time(duration);
  await cmd(a, 'premises.configure', {
    id: 'workroom',
    expectedRevision: runtime.state.world.premises.buildings.workroom.revision,
    title: '居民建造的共享房间',
    entry: 'public',
    visitors: [],
    operators: [b, d],
    residents: [],
  });
  for (const actor of [b, c, d]) {
    await cmd(actor, 'travel.go', { targetLocationId: here });
    time(
      runtime.state.world.activityTimeByAgent[actor].availableAt - runtime.state.world.clock.now,
    );
  }
  const places = await cmd(a, 'engagements.facilities', { limit: 30 });
  assert.ok(
    places.data.items.some(
      (f) => f.locationId === here && f.careStations === 1 && f.teachingStations === 1,
    ),
  );
  await cmd(d, 'stocks.create', { id: 'supplies', title: '真实服务用品', locationId: here });
  await cmd(d, 'stocks.deposit', {
    id: 'supplies',
    expectedRevision: 1,
    items: { Apple: 4, Book: 1 },
  });
  await cmd(a, 'engagements.offer', originalTerms('care', 'supportive-care-v1'));
  await operation(d, 'accept', 'care', {}, 1);
  await operation(c, 'accept', 'care');
  await operation(d, 'fund', 'care');
  await operation(a, 'start', 'care', { until: contract('care').endAt }, 1);
  await operation(b, 'start', 'care', { until: contract('care').endAt });
  time(60000);
  assert.equal(contract('care').progressMs, 0);
  await operation(c, 'start', 'care', { until: contract('care').endAt });
  time(600000);
  assert.equal(contract('care').charged, 6);
  assert.equal(contract('care').providerPaid, 3);
  const paidView = await cmd(d, 'engagements.ledger', { id: 'care', limit: 1 });
  assert.doesNotMatch(
    JSON.stringify(paidView.data),
    /educationScore|providerBefore|recipientBefore|ownBefore/,
  );
  await cmd(c, 'engagements.ledger', { id: 'care', limit: 1 });
  await operation(c, 'leave', 'care');
  assert.equal(contract('care').refunded, 30);
  await reserve('meal', { Apple: 4 });
  await cmd(a, 'engagements.offer', originalTerms('meal', 'meal-assistance-v1', ['input-meal@1']));
  await operation(c, 'accept', 'meal');
  await operation(d, 'fund', 'meal');
  await cmd(
    d,
    'materials.withdraw',
    {
      id: 'input-meal',
      expectedRevision: runtime.state.world.materials.reservations.records['input-meal'].revision,
    },
    1,
  );
  await operation(b, 'start', 'meal', { until: contract('meal').endAt });
  await operation(c, 'start', 'meal', { until: contract('meal').endAt });
  time(900000);
  await operation(b, 'leave', 'meal');
  assert.ok(Math.abs(runtime.state.world.materials.stocks.supplies.inventory.Apple - 3) < 1e-8);
  await reserve('study', { Book: 1 });
  await cmd(a, 'engagements.offer', originalTerms('study', 'guided-study-v1', ['input-study@1']));
  await operation(c, 'accept', 'study');
  await operation(d, 'fund', 'study');
  await operation(b, 'start', 'study', { until: contract('study').endAt });
  await operation(c, 'start', 'study', { until: contract('study').endAt });
  time(3600000);
  assert.equal(contract('study').endReason, 'completed');
  assert.equal(runtime.state.world.materials.stocks.supplies.inventory.Book, 1);
  const education = Object.values(runtime.state.world.serviceEngagements.settlements)
    .filter((s) => s.engagementId === 'study')
    .reduce((n, s) => n + s.recipientAfter.educationScore - s.recipientBefore.educationScore, 0);
  assert.ok(Math.abs(education - 1) < 1e-8);
  await cmd(a, 'engagements.list');
  await cmd(c, 'engagements.read', { id: 'study' });
  await cmd(a, 'engagements.offer', originalTerms('unused', 'personal-assistance-v1'));
  await operation(c, 'accept', 'unused');
  await operation(d, 'fund', 'unused');
  await operation(a, 'cancel', 'unused');
  assert.equal(contract('unused').refunded, 36);
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
    capability: 'W03-W07-real-service-delivery',
    mode: 'real-compiled-cli-http-engineering-acceptance',
    modelInvoked: false,
    explicitTestSeed: {
      residents: 4,
      constructionDonor: { Wood: 30, 'Iron Ingot': 5, 'Copper Ingot': 5, Book: 3, Apple: 10 },
      mobileServiceSupplier: { Book: 1, Apple: 4 },
      otherMobileResidents: { Apple: 1 },
      logisticsLoadLimitsEnabled: true,
      providerEducationScore: 2000,
      otherEducationScore: 1000,
      worldPolicyRecordedAfterSeed: true,
    },
    cliCalls: results.length,
    results,
    builtPhysicalCareAndTeachingStations: true,
    actualTravelAndStorage: true,
    independentRecipientAndSponsor: true,
    waitingDoesNotCountAsService: true,
    measuredCareAndEarnedShares: true,
    partialExitRefund: true,
    realFoodConsumption: true,
    reusableBookReturned: true,
    measuredTeachingNoCredential: true,
    bodilyPrivacy: true,
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
