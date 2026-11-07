// Explicit compiled CLI/HTTP engineering acceptance; no model or spontaneous-emergence claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-facilities-cli-'));
const manifest = createOpenSocietyManifest({ count: 4, continuity: true });
const site = Object.values(manifest.initialWorld.premises.sites)[0];
const locationId = site.parentLocationId;
// Explicit engineering seed; no claim that these initial materials were manufactured.
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld: {
    ...manifest.initialWorld,
    agents: Object.fromEntries(
      Object.entries(manifest.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId,
          inventory: { ...a.inventory, Wood: 30, 'Iron Ingot': 5 },
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  },
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
      [executable, ...argv, '--request-id', `facilities-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit construction CLI acceptance' });
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
const stock = (id) => runtime.state.world.materials.stocks[id],
  job = (id) => runtime.state.world.materials.productions[id],
  building = () => runtime.state.world.premises.buildings.workroom;
const time = (ms) => {
  const r = runtime.advanceTime(ms, `tick-${++ordinal}`);
  assert.equal(r.ok, true, r.error);
};
const travel = async (actor) => {
  await cmd(actor, 'travel.go', { targetLocationId: 'premises-workroom' });
  time(runtime.state.world.activityTimeByAgent[actor].availableAt - runtime.state.world.clock.now);
};
const blueprint = {
  primaryUse: 'residence',
  floorArea: 8,
  capacity: 2,
  workstations: 1,
  careStations: 0,
  teachingStations: 0,
  storageUnits: 10,
};
const createJob = async (actor, id, sid, code = 0) =>
  cmd(
    actor,
    'production.create',
    {
      id,
      stockId: sid,
      expectedRevision: stock(sid).revision,
      recipeId: 'book',
      quantity: 1,
      productName: '自己的作品',
      description: '名称不决定物理规则',
      workers: [actor],
    },
    code,
  );
try {
  await cmd(a, 'rules.read', { id: 'physical-facility-use' });
  await cmd(a, 'stocks.create', { id: 'source', title: '工程投入', locationId });
  await cmd(a, 'stocks.deposit', {
    id: 'source',
    expectedRevision: 1,
    items: { Wood: 8.1, 'Iron Ingot': 1 },
  });
  await cmd(a, 'materials.reserve', {
    id: 'r',
    stockId: 'source',
    expectedStockRevision: 2,
    beneficiaryKind: 'resident',
    beneficiaryId: b,
    consumerDomain: 'premises',
    consumerId: 'p',
    items: { Wood: 8.1, 'Iron Ingot': 1 },
    terms: '明确建设',
    expiresAt: runtime.state.world.clock.now + 1000000,
  });
  await cmd(b, 'construction.create', {
    id: 'p',
    kind: 'build',
    buildingId: 'workroom',
    siteId: site.id,
    expectedSiteRevision: 1,
    controllerKind: 'resident',
    controllerId: b,
    title: '可以叫书房',
    description: '住宅内实际建有工作位',
    workers: [c],
    reservationRefs: ['r@1'],
    ...blueprint,
  });
  const duration = runtime.state.world.premises.projects.p.plan.workMs;
  await cmd(c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: runtime.state.world.clock.now + duration,
  });
  time(duration);
  await cmd(b, 'premises.configure', {
    id: 'workroom',
    expectedRevision: 1,
    title: '可以叫书房',
    entry: 'listed',
    visitors: [],
    operators: [b, c],
    residents: [],
  });
  await travel(b);
  await travel(c);
  await cmd(b, 'stocks.create', {
    id: 's1',
    title: '第一份保管记录',
    locationId: 'premises-workroom',
  });
  await cmd(c, 'stocks.create', {
    id: 's2',
    title: '第二份保管记录',
    locationId: 'premises-workroom',
  });
  await cmd(b, 'stocks.deposit', { id: 's1', expectedRevision: 1, items: { Wood: 6 } });
  await cmd(c, 'stocks.deposit', { id: 's2', expectedRevision: 1, items: { Wood: 4 } });
  await cmd(c, 'stocks.deposit', { id: 's2', expectedRevision: 2, items: { Wood: 0.1 } }, 1);
  await createJob(b, 'j1', 's1', 1);
  await cmd(b, 'stocks.withdraw', {
    id: 's1',
    expectedRevision: 2,
    recipientId: b,
    items: { Wood: 2 },
  });
  await createJob(b, 'j1', 's1');
  await createJob(c, 'j2', 's2');
  const workMs = job('j1').recipe.workMs;
  await cmd(b, 'production.start', {
    id: 'j1',
    expectedRevision: 1,
    until: runtime.state.world.clock.now + workMs,
  });
  await cmd(
    c,
    'production.start',
    { id: 'j2', expectedRevision: 1, until: runtime.state.world.clock.now + workMs },
    1,
  );
  await cmd(b, 'production.leave', { id: 'j1', expectedRevision: 2 });
  await cmd(c, 'production.start', {
    id: 'j2',
    expectedRevision: 1,
    until: runtime.state.world.clock.now + workMs,
  });
  time(workMs);
  await cmd(b, 'production.start', {
    id: 'j1',
    expectedRevision: job('j1').revision,
    until: runtime.state.world.clock.now + workMs,
  });
  time(workMs);
  assert.equal(stock('s1').inventory.Book, 1);
  assert.equal(stock('s2').inventory.Book, 1);
  const availability = (await cmd(b, 'premises.read', { id: 'workroom' })).data.facilityUse;
  assert.equal(availability.storageCapacity, 10);
  assert.equal(availability.storageUsage.total, 8);
  assert.equal(availability.workstationsInUse, 0);
  await cmd(b, 'materials.reserve', {
    id: 'return-space',
    stockId: 's1',
    expectedStockRevision: stock('s1').revision,
    beneficiaryKind: 'resident',
    beneficiaryId: b,
    consumerDomain: 'premises',
    consumerId: 'future',
    items: { Wood: 1 },
    terms: '未接收仍保留退回空间',
    expiresAt: runtime.state.world.clock.now + 1000,
  });
  await cmd(
    c,
    'stocks.deposit',
    { id: 's2', expectedRevision: stock('s2').revision, items: { Wood: 3 } },
    1,
  );
  await cmd(c, 'stocks.deposit', {
    id: 's2',
    expectedRevision: stock('s2').revision,
    items: { Wood: 2 },
  });
  time(1000);
  assert.equal(
    runtime.state.world.materials.reservations.records['return-space'].status,
    'settled',
  );
  await cmd(b, 'stocks.withdraw', {
    id: 's1',
    expectedRevision: stock('s1').revision,
    recipientId: b,
    items: { Wood: 1 },
  });
  await createJob(c, 'j3', 's2');
  await cmd(c, 'production.start', {
    id: 'j3',
    expectedRevision: 1,
    until: runtime.state.world.clock.now + workMs,
  });
  time(1000);
  const progress = job('j3').progressMs;
  await cmd(b, 'premises.configure', {
    id: 'workroom',
    expectedRevision: building().revision,
    title: '控制与财物分开',
    entry: 'listed',
    visitors: [],
    operators: [b],
    residents: [],
  });
  time(1000);
  assert.equal(job('j3').lastStop.reason, 'facility-unavailable');
  assert.equal(job('j3').progressMs, progress);
  await cmd(c, 'production.cancel', { id: 'j3', expectedRevision: job('j3').revision });
  await cmd(c, 'stocks.withdraw', {
    id: 's2',
    expectedRevision: stock('s2').revision,
    recipientId: c,
    items: { Wood: 1 },
  });
  await cmd(b, 'stocks.read', { id: 's1' });
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
    capability: 'W01-W02-physical-facility-use',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    explicitTestSeed: {
      residents: 4,
      woodPerResident: 30,
      ironIngotPerResident: 5,
      colocatedAtExistingSite: true,
    },
    cliCalls: results.length,
    results,
    actualFacilityConstruction: true,
    primaryUseDoesNotInventOrForbidWorkstations: true,
    crossStockStorageCapacity: true,
    refundAndFutureOutputHeadroom: true,
    sharedWorkstationContention: true,
    personalLeaveReleasesStation: true,
    revocationStopsFutureWorkWithoutConfiscation: true,
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
