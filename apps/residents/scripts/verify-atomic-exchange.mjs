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

const root = mkdtempSync(join(tmpdir(), 'resident-atomic-exchange-cli-'));
const m = createOpenSocietyManifest({ count: 4, continuity: true, programActions: true });
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
    id = requestId ?? `atomic-exchange-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Explicit atomic exchange CLI acceptance' });
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
  await cmd(a, 'rules.read', { id: 'physical-premises' });
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

  await cmd(a, 'rules.read', { id: 'resident-program-actions' });
  await cmd(b, 'stocks.create', { id: 'stock', title: '居民自己的库存', locationId });
  await cmd(b, 'stocks.deposit', { id: 'stock', expectedRevision: 1, items: { Wood: 1 } });
  await cmd(b, 'spaces.create', {
    id: 'space',
    title: '居民原文',
    visibility: 'private',
    posting: 'owner',
  });
  await cmd(b, 'files.create', {
    spaceId: 'space',
    path: 'original.md',
    content: '作者与控制分别记录',
  });
  await cmd(b, 'registers.create', {
    id: 'register',
    title: '居民数据',
    visibility: 'private',
    fields: { value: 'number' },
  });
  await cmd(b, 'records.put', {
    registerId: 'register',
    key: 'original',
    expectedRevision: 0,
    values: { value: 7 },
  });
  await cmd(b, 'groups.create', { id: 'group', title: '居民群组' });
  await cmd(b, 'groups.invite', { groupId: 'group', residentId: d });
  const startBalances = {
      buyer: runtime.state.world.agents[c].balance,
      seller: runtime.state.world.agents[b].balance,
    },
    supply = runtime.state.world.moneySupply,
    originals = structuredClone(runtime.state.information.documents),
    record = structuredClone(runtime.state.sharedRecords.records['register/original']);
  const resource = (kind) =>
    kind === 'premises'
      ? building()
      : kind === 'stock'
        ? runtime.state.world.materials.stocks.stock
        : kind === 'space'
          ? runtime.state.information.spaces.space
          : kind === 'register'
            ? runtime.state.sharedRecords.registers.register
            : runtime.state.communication.groups.group;
  async function publish(id, kind, amount) {
    const r = resource(kind),
      version = r.control?.version ?? 1;
    await cmd(b, 'programs.publish', {
      id,
      title: '双方定义的交换',
      purpose: '价格和组织形式由居民选择',
      runners: [a],
      definition: {
        actionPolicyVersion: 'resident-program-actions-v2',
        steps: [
          {
            principalId: b,
            capability: 'resource.control',
            arguments: {
              resourceKind: kind,
              resourceId: r.id,
              expectedRevision: r.revision,
              control: {
                type: 'offer',
                expectedVersion: version,
                target: { kind: 'resident', id: c },
                expiresAt: runtime.state.world.clock.now + 60000,
                terms: '这一固定程序内移交',
              },
            },
          },
          {
            principalId: c,
            capability: 'resource.control',
            arguments: {
              resourceKind: kind,
              resourceId: r.id,
              expectedRevision: r.revision + 1,
              control: { type: 'accept', expectedVersion: version + 1 },
            },
          },
          {
            principalId: c,
            capability: 'payments.transfer',
            arguments: { targetId: b, amount, note: '双方选定的价款' },
          },
        ],
      },
    });
  }
  async function grant(actor, id) {
    return cmd(actor, 'mandates.grant', {
      id: `${id}-${actor}`,
      programId: id,
      programRevision: 1,
      runnerId: a,
      maxRuns: 1,
      expiresAt: runtime.state.world.clock.now + 60000,
    });
  }
  // The resource steps would succeed, but the final payment cannot: no intermediate handoff may escape.
  await publish('insufficient', 'space', 1000000);
  await grant(b, 'insufficient');
  await grant(c, 'insufficient');
  const beforeFailure = structuredClone(resource('space'));
  const failed = await cmd(a, 'programs.run', { id: 'insufficient', expectedRevision: 1 }, 1);
  assert.equal(failed.error, 'insufficient-balance');
  assert.deepEqual(resource('space'), beforeFailure);
  assert.equal(runtime.state.coordination.mandates[`insufficient-${b}`].usedRuns, 0);
  assert.equal(runtime.state.coordination.mandates[`insufficient-${c}`].usedRuns, 0);
  for (const kind of ['premises', 'stock', 'space', 'register', 'group']) {
    const id = `exchange-${kind}`;
    await publish(id, kind, 3);
    await grant(b, id);
    const rejected = await cmd(a, 'programs.run', { id, expectedRevision: 1 }, 1);
    assert.equal(rejected.error, 'program-mandate-required');
    await grant(c, id);
    await cmd(d, 'programs.read', { id }, 1);
    const requestId = `commit-${kind}`,
      first = await cmd(a, 'programs.run', { id, expectedRevision: 1 }, 0, requestId),
      duplicate = await cmd(a, 'programs.run', { id, expectedRevision: 1 }, 0, requestId);
    assert.deepEqual(duplicate, first);
    assert.deepEqual(resource(kind).control.controller, { kind: 'resident', id: c });
    assert.equal(runtime.state.coordination.mandates[`${id}-${b}`].usedRuns, 1);
    assert.equal(runtime.state.coordination.mandates[`${id}-${c}`].usedRuns, 1);
    await cmd(c, 'programs.runs', { programId: id, limit: 1 });
    const again = await cmd(a, 'programs.run', { id, expectedRevision: 1 }, 1);
    assert.equal(again.error, 'program-mandate-required');
  }
  assert.equal(runtime.state.world.agents[c].balance, startBalances.buyer - 18);
  assert.equal(runtime.state.world.agents[b].balance, startBalances.seller + 18);
  assert.equal(runtime.state.world.moneySupply, supply);
  assert.deepEqual(runtime.state.information.documents, originals);
  assert.deepEqual(runtime.state.sharedRecords.records['register/original'], record);
  assert.deepEqual(runtime.state.world.materials.stocks.stock.inventory, { Wood: 1 });
  assert.equal(
    Object.values(runtime.state.communication.invitations).find((i) => i.groupId === 'group')
      .status,
    'rejected',
  );
  await cmd(
    b,
    'resources.offer',
    {
      kind: 'space',
      id: 'space',
      expectedRevision: resource('space').revision,
      expectedControlVersion: resource('space').control.version,
      target: { kind: 'resident', id: d },
      expiresAt: runtime.state.world.clock.now + 60000,
      terms: '旧管理人不能再处分',
    },
    1,
  );
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
    capability: 'W05-M04-M07-atomic-resource-exchange-foundation',
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
    resources: ['premises', 'stock', 'space', 'register', 'group'],
    results,
    actualConstruction: true,
    independentlyMandatedParties: true,
    lateFailureHasNoPartialEffects: true,
    missingMandateRejected: true,
    duplicateRequestSingleDebit: true,
    mandateConsumedOnce: true,
    exhaustedMandateRejected: true,
    privateProgramsNotReadableByOutsider: true,
    originalDocumentsAndRecordsUnchanged: true,
    stockNotMovedByControlChange: true,
    pendingGroupInviteInvalidated: true,
    previousControllerCannotAdminister: true,
    actualBalancedPayments: 18,
    moneySupplyConserved: true,
    replayEqual: true,
    journalBytesUnchanged: true,
    notYetCovered: [
      'collective program composition',
      'service resource control',
      'vehicle control',
      'enterprise control',
      'long-term obligations',
      'canonical and partition integration',
      'real-model use',
      'spontaneous emergence',
    ],
  };
  if (process.argv[2])
    writeFileSync(
      process.argv[2],
      `${JSON.stringify(evidence, null, 2)}
`,
    );
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (!closed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
