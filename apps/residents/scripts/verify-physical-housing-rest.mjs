// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'physical-housing-rest-cli-'));
const m = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  elapsedRest: true,
  premises: true,
});
const [a, b, c] = m.residents.map((r) => r.id),
  site = Object.values(m.initialWorld.premises.sites)[0],
  location = site.parentLocationId;
const runtime = new OpenSocietyRuntime(root, {
  ...m,
  initialWorld: {
    ...m.initialWorld,
    premises: {
      ...m.initialWorld.premises,
      policy: { ...m.initialWorld.premises.policy, wearIntervalMs: 600000, wearPerInterval: 250 },
    },
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, actor]) => [
        id,
        {
          ...actor,
          locationId: location,
          inventory: { Wood: 20 },
          physiology: { energy: 30, satiety: 100, health: 100 },
          ...(id === c ? { residentialTier: 3, upkeepArrears: 17 } : {}),
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
    id = requestId ?? `housing-occupancy-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Explicit occupancy CLI acceptance' });
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
  const original = readFileSync(join(root, 'manifest.json'));
  assert.equal(runtime.enablePhysicalHousingRest().ok, false);
  assert.equal(runtime.enableHousingOccupancy().ok, true);
  const before = structuredClone(runtime.state.world),
    enabled = runtime.enablePhysicalHousingRest();
  assert.equal(enabled.ok, true);
  assert.deepEqual(runtime.enablePhysicalHousingRest(), enabled);
  assert.deepEqual(runtime.state.world.agents, before.agents);
  assert.deepEqual(runtime.state.world.premises, before.premises);
  assert.equal((await cmd(c, 'housing.occupancy')).data.physicalRest.source.kind, 'unsheltered');
  await cmd(b, 'housing.occupancy', { actorId: c }, 2);
  await cmd(a, 'stocks.create', { id: 'supplies', title: 'Actual material', locationId: location });
  await cmd(a, 'stocks.deposit', { id: 'supplies', expectedRevision: 1, items: { Wood: 8 } });
  await cmd(a, 'materials.reserve', {
    id: 'material',
    stockId: 'supplies',
    expectedStockRevision: 2,
    beneficiaryKind: 'resident',
    beneficiaryId: b,
    consumerDomain: 'premises',
    consumerId: 'build',
    items: { Wood: 8 },
    terms: 'Exactly this home',
    expiresAt: 1000000,
  });
  const blueprint = {
    primaryUse: 'residence',
    floorArea: 8,
    capacity: 2,
    workstations: 0,
    careStations: 0,
    teachingStations: 0,
    storageUnits: 0,
  };
  await cmd(b, 'construction.create', {
    id: 'build',
    kind: 'build',
    buildingId: 'home',
    siteId: site.id,
    expectedSiteRevision: runtime.state.world.premises.sites[site.id].revision,
    controllerKind: 'resident',
    controllerId: b,
    title: 'Name creates no effect',
    description: 'Physical construction',
    workers: [b],
    reservationRefs: ['material@1'],
    ...blueprint,
  });
  assert.equal(runtime.state.world.locations['premises-home'], undefined);
  await cmd(c, 'construction.start', { id: 'build', expectedRevision: 1, until: 480000 }, 1);
  const project = runtime.state.world.premises.projects.build;
  await cmd(b, 'construction.start', {
    id: 'build',
    expectedRevision: project.revision,
    until: project.plan.workMs,
  });
  assert.equal(runtime.state.world.premises.buildings.home, undefined);
  assert.equal(runtime.advanceTime(project.plan.workMs, 'actual-building').ok, true);
  assert.deepEqual(runtime.state.world.premises.buildings.home.embodied, { Wood: 8 });
  assert.deepEqual(runtime.state.world.materials.stocks.supplies.inventory, {});
  await cmd(c, 'housing.choose', { locationId: 'premises-home' }, 1);
  const at = runtime.state.world.clock.now;
  await cmd(b, 'permits.offer', {
    id: 'living',
    buildingId: 'home',
    buildingRevision: runtime.state.world.premises.buildings.home.revision,
    granteeKind: 'resident',
    granteeId: c,
    users: [c],
    scopes: ['reside'],
    mode: 'shared',
    title: 'Original terms',
    terms: 'Independent right',
    startAt: at,
    endAt: at + 600000,
    acceptBy: at + 60000,
  });
  await cmd(c, 'permits.accept', { id: 'living', expectedRevision: 1 });
  assert.equal((await cmd(c, 'housing.occupancy')).data.physicalRest.source.kind, 'unsheltered');
  await cmd(c, 'travel.go', { targetLocationId: 'premises-home' });
  assert.equal(
    runtime.advanceTime(
      runtime.state.world.activityTimeByAgent[c].availableAt - runtime.state.world.clock.now,
      'actual-arrival',
    ).ok,
    true,
  );
  await cmd(c, 'housing.choose', { locationId: 'premises-home' });
  const house = (await cmd(c, 'housing.occupancy')).data;
  assert.equal(house.physicalRest.source.buildingId, 'home');
  assert.equal(house.physicalRest.source.condition, 1000);
  const body = structuredClone(runtime.state.world.agents[c].physiology);
  await cmd(c, 'life.sleep', { durationSeconds: 1500 });
  assert.deepEqual(runtime.state.world.agents[c].physiology, body);
  const session = Object.values(runtime.state.world.residentRest.sessions).find(
    (s) => s.actorId === c,
  );
  await cmd(b, 'life.wake', { id: session.id, expectedRevision: session.revision }, 1);
  assert.equal(runtime.advanceTime(1500000, 'real-sleep-and-wear').ok, true);
  assert.ok(runtime.state.world.agents[c].physiology.energy > body.energy);
  const after = (await cmd(c, 'housing.occupancy')).data;
  assert.equal(after.currentPermission, false);
  assert.equal(after.residenceId, 'premises-home');
  assert.equal(after.physicalRest.source.kind, 'resident-built-residence');
  assert.equal(after.physicalRest.source.condition, 500);
  const effects = runtime.journal.commits
    .flatMap((commit) => commit.worldEvents ?? [])
    .filter(
      (e) =>
        e.type === 'PhysiologyChanged' &&
        e.payload.agentId === c &&
        e.payload.elapsed?.physicalHousing,
    );
  assert.ok(effects.some((e) => e.payload.elapsed.physicalHousing.multiplier === 1));
  assert.ok(effects.some((e) => e.payload.elapsed.physicalHousing.multiplier < 1));
  await cmd(c, 'travel.go', { targetLocationId: location });
  assert.equal(
    runtime.advanceTime(
      runtime.state.world.activityTimeByAgent[c].availableAt - runtime.state.world.clock.now,
      'leave-actual-location',
    ).ok,
    true,
  );
  const outside = (await cmd(c, 'housing.occupancy')).data;
  assert.equal(outside.residenceId, 'premises-home');
  assert.equal(outside.physicalRest.source.kind, 'unsheltered');
  const tier = runtime.state.world.agents[c].residentialTier,
    arrears = runtime.state.world.agents[c].upkeepArrears;
  await cmd(c, 'housing.leave', {
    expectedResidenceId: 'premises-home',
    expectedRevision: outside.revision,
  });
  assert.equal(runtime.state.world.agents[c].residenceLocationId, null);
  assert.equal(runtime.state.world.agents[c].residentialTier, tier);
  assert.equal(runtime.state.world.agents[c].upkeepArrears, arrears);
  await cmd(
    c,
    'housing.leave',
    { expectedResidenceId: 'premises-home', expectedRevision: outside.revision },
    1,
  );
  const outdoorBody = runtime.state.world.agents[c].physiology.energy;
  await cmd(c, 'life.sleep', { durationSeconds: 120 });
  assert.equal(runtime.advanceTime(120000, 'outdoor-real-sleep').ok, true);
  const actualOutside = runtime.journal.commits
    .flatMap((commit) => commit.worldEvents ?? [])
    .filter(
      (e) =>
        e.type === 'PhysiologyChanged' &&
        e.payload.agentId === c &&
        e.payload.elapsed?.physicalHousing?.source.kind === 'unsheltered',
    );
  assert.ok(actualOutside.length > 0);
  assert.equal(actualOutside[0].payload.elapsed.physicalHousing.multiplier, 0.5);
  assert.ok(runtime.state.world.agents[c].physiology.energy > outdoorBody);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), original);
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
        policy: 'resident-physical-housing-rest-v1',
        checks: [
          'explicit-activation-no-asset-or-body-rewrite',
          'real-materials-labor-and-construction',
          'independent-right-and-real-arrival',
          'actual-location-not-registered-home',
          'actual-sleep-not-prepaid',
          'wear-boundary-and-source-evidence',
          'rights-expiry-does-not-remove-roof',
          'personal-departure-keeps-contracts-tier-and-arrears',
          'outdoor-sleep-not-blocked',
          'identity-refusals',
          'exact-journal-replay',
        ],
        calls: results.length,
        refusals: results.filter((r) => !r.ok).length,
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
