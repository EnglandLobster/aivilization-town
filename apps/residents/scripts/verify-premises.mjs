// Explicit compiled CLI/HTTP engineering acceptance; no model or spontaneous-emergence claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-premises-cli-'));
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
          inventory: { ...a.inventory, Wood: 30 },
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
      [executable, ...argv, '--request-id', `premises-cli-${++ordinal}`],
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
const stock = () => runtime.state.world.materials.stocks.s,
  project = (id) => runtime.state.world.premises.projects[id],
  building = () => runtime.state.world.premises.buildings.home,
  time = (ms) => {
    const result = runtime.advanceTime(ms, `time-${++ordinal}`);
    assert.equal(result.ok, true, result.error);
  };
const blueprint = {
  primaryUse: 'residence',
  floorArea: 8,
  capacity: 2,
  workstations: 0,
  careStations: 0,
  teachingStations: 0,
  storageUnits: 0,
};
async function reserve(id, consumerId, items) {
  await cmd(a, 'materials.reserve', {
    id,
    stockId: 's',
    expectedStockRevision: stock().revision,
    beneficiaryKind: 'resident',
    beneficiaryId: b,
    consumerDomain: 'premises',
    consumerId,
    items,
    terms: '仅用于此工程',
    expiresAt: runtime.state.world.clock.now + 1000000,
  });
}
async function create(id, kind, plan, refs) {
  const params = {
    id,
    kind,
    buildingId: 'home',
    siteId: site.id,
    expectedSiteRevision: runtime.state.world.premises.sites[site.id].revision,
    controllerKind: 'resident',
    controllerId: b,
    title: '自己设计的房屋',
    description: '名称不生成物理后果',
    workers: [b, c],
    ...plan,
  };
  if (refs.length) params.reservationRefs = refs;
  // CLI array flags omitted by the caller are encoded as an explicit empty array.
  else params.reservationRefs = [];
  if (kind !== 'build') params.expectedBuildingRevision = building().revision;
  const argv = argsOf('construction.create', params);
  await call(b, argv);
}
async function work(id) {
  const duration = project(id).plan.workMs;
  await cmd(c, 'construction.start', {
    id,
    expectedRevision: project(id).revision,
    until: runtime.state.world.clock.now + duration,
  });
  time(duration);
  assert.equal(project(id).status, 'completed');
}
try {
  await cmd(a, 'rules.read', { id: 'physical-premises' });
  await cmd(a, 'rules.read', { id: 'public-construction-use' });
  await cmd(a, 'sites.list', { limit: 2 });
  await cmd(a, 'sites.read', { id: site.id });
  await cmd(a, 'construction.plan', { kind: 'build', ...blueprint });
  await cmd(a, 'stocks.create', { id: 's', title: '真实材料', locationId });
  await cmd(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 20 } });
  await reserve('r', 'p', { Wood: 8 });
  await cmd(d, 'materials.read', { id: 'r' }, 1);
  await create('p', 'build', blueprint, ['r@1']);
  await cmd(a, 'materials.withdraw', { id: 'r', expectedRevision: 2 }, 1);
  await cmd(
    a,
    'construction.start',
    { id: 'p', expectedRevision: 1, until: runtime.state.world.clock.now + 480000 },
    1,
  );
  await cmd(c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: runtime.state.world.clock.now + 480000,
  });
  time(120000);
  assert.equal(runtime.state.world.locations['premises-home'], undefined);
  await cmd(c, 'construction.read', { id: 'p' });
  await cmd(c, 'construction.leave', { id: 'p', expectedRevision: project('p').revision });
  await cmd(b, 'construction.start', {
    id: 'p',
    expectedRevision: project('p').revision,
    until: runtime.state.world.clock.now + 360000,
  });
  time(360000);
  assert.equal(project('p').status, 'completed');
  assert.equal(runtime.state.world.locations['premises-home'].capacity, 2);
  await cmd(b, 'premises.read', { id: 'home' });
  const priorHome =
    manifest.initialWorld.agents[b].residenceLocationId ??
    manifest.initialWorld.agents[b].locationId;
  assert.equal(runtime.state.world.locations[priorHome].kind, 'residence');
  await cmd(b, 'travel.go', { targetLocationId: 'premises-home' });
  assert.notEqual(runtime.state.world.agents[b].locationId, 'premises-home');
  time(runtime.state.world.activityTimeByAgent[b].availableAt - runtime.state.world.clock.now);
  await cmd(b, 'housing.choose', { locationId: 'premises-home' });
  await cmd(b, 'premises.close', { id: 'home', expectedRevision: building().revision }, 1);
  await cmd(b, 'housing.build', { locationId: 'premises-home' }, 1);
  await cmd(b, 'travel.go', { targetLocationId: priorHome });
  time(runtime.state.world.activityTimeByAgent[b].availableAt - runtime.state.world.clock.now);
  await cmd(b, 'housing.choose', { locationId: priorHome });
  await cmd(b, 'travel.go', { targetLocationId: locationId });
  time(runtime.state.world.activityTimeByAgent[b].availableAt - runtime.state.world.clock.now);

  await cmd(d, 'travel.go', { targetLocationId: 'premises-home' }, 1);
  await cmd(
    d,
    'services.publish',
    {
      id: 'unauthorized-service',
      kind: 'event',
      locationId: 'premises-home',
      title: '无经营权',
      description: '名称不授予权利',
      capacity: 1,
    },
    1,
  );
  // Enlarge actual space with another independently reserved material contribution.
  const bigger = { ...blueprint, floorArea: 16, capacity: 4 };
  await reserve('r2', 'expansion', { Wood: 8 });
  await cmd(b, 'construction.plan', { kind: 'modify', buildingId: 'home', ...bigger });
  await create('expansion', 'modify', bigger, ['r2@1']);
  await work('expansion');
  assert.equal(runtime.state.world.locations['premises-home'].capacity, 4);
  // The natural day supplies an independently versioned clock; no command text invents wear or repairs.
  time(86400000);
  const repairPlan = (
    await cmd(b, 'construction.plan', { kind: 'maintain', buildingId: 'home', ...bigger })
  ).data.plan;
  assert.ok(repairPlan.repairPoints > 0);
  await reserve('r3', 'repair', repairPlan.materials);
  await create('repair', 'maintain', bigger, ['r3@1']);
  // Restore no body state: use the actor whose real remaining effort is sufficient.
  await work('repair');
  assert.equal(building().condition, 1000);
  await cmd(b, 'premises.close', { id: 'home', expectedRevision: building().revision });
  await create('demo', 'demolish', bigger, []);
  await work('demo');
  assert.equal(building().status, 'demolished');
  assert.equal(building().footprintReleased, false);
  const remains = { ...building().salvage };
  await cmd(b, 'premises.collect-salvage', {
    id: 'home',
    expectedRevision: building().revision,
    recipientId: b,
    items: remains,
  });
  assert.equal(building().footprintReleased, true);
  assert.equal(runtime.state.world.premises.sites[site.id].occupiedFloorArea, 0);
  await cmd(a, 'stocks.ledger', { id: 's', limit: 30 });
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
    capability: 'W02-M06-M09-material-backed-premises',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    explicitTestSeed: { residents: 4, woodPerResident: 30, colocatedAtExistingSite: true },
    cliCalls: results.length,
    results,
    donorConsentAndConsumerBinding: true,
    noBuildingBeforeLabor: true,
    personalWorkerSuccession: true,
    realSpaceAndBidirectionalRoute: true,
    independentEntryOperationResidence: true,
    materialBackedExpansionAndRepair: true,
    actualDemolitionSalvage: true,
    siteFreedOnlyAfterRubbleCollection: true,
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
