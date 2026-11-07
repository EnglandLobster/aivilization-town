// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'construction-principals-cli-'));
const m = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  resourceControl: true,
  materials: true,
  premises: true,
  facilityUse: true,
  premisesRights: true,
  publicGovernance: true,
});
const [a, b, c] = m.residents.map((r) => r.id);
const site = Object.values(m.initialWorld.premises.sites)[0],
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
    id = requestId ?? `construction-principals-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Explicit resource principal CLI acceptance' });
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

const stock = () => runtime.state.world.materials.stocks.s;
const request = (command) => ({
  resourceKind: 'stock',
  resourceId: 's',
  resourceRevision: stock().revision,
  controlVersion: stock().control.version,
  command,
});
const operation = (command) => ({
  resourceKind: 'stock',
  resourceId: 's',
  resourceRevision: stock().revision,
  controlVersion: stock().control.version,
  operation: { capability: 'materials.' + command.type, arguments: command },
});
async function publicDecision(id, request) {
  const closesAt = runtime.state.world.clock.now + 60000;
  await cmd(a, 'governance.propose', {
    id,
    text: '精确公共授权',
    expectedProcedureRevision: runtime.state.world.publicGovernance.authority.procedureRevision,
    closesAt,
    action: {
      kind: 'operation' in request ? 'manage-resource' : 'control-resource',
      expectedRevision: request.resourceRevision,
      request,
    },
  });
  for (const actor of [a, b, c])
    await cmd(actor, 'governance.vote', {
      id,
      expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
      choice: 'yes',
    });
  assert.equal(
    runtime.advanceTime(closesAt - runtime.state.world.clock.now, 'close-' + id).ok,
    true,
  );
  await cmd(c, 'governance.close', {
    id,
    expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
  });
  await cmd(c, 'governance.execute', {
    id,
    expectedRevision: runtime.state.world.publicGovernance.authority.proposals[id].revision,
  });
}

function projectRequest(principal, id = 'p', buildingId = 'home', reservationId = 'r') {
  const current = runtime.state.world.premises.sites[site.id];
  return {
    resourceKind: 'construction-site',
    resourceId: site.id,
    resourceRevision: current.revision,
    controlVersion: runtime.state.world.premises.landUsePolicy.revision,
    operation: {
      capability: 'premises.create-construction',
      arguments: {
        type: 'create-construction',
        construction: {
          id,
          kind: 'build',
          buildingId,
          siteId: site.id,
          expectedSiteRevision: current.revision,
          controller: principal,
          title: '主体持有的空间',
          description: '工程验收，不是自主涌现',
          blueprint: {
            primaryUse: 'residence',
            floorArea: 8,
            capacity: 2,
            fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
          },
          workers: [c],
          reservations: [{ id: reservationId, revision: 1 }],
        },
      },
    },
  };
}
async function reserve(principal, id = 'r', projectId = 'p') {
  return cmd(b, 'principals.operate', {
    request: operation({
      type: 'reserve-materials',
      offer: {
        id,
        stockId: 's',
        expectedStockRevision: stock().revision,
        beneficiary: principal,
        consumer: { domain: 'premises', id: projectId },
        items: { Wood: 8 },
        terms: '真实预留',
        expiresAt: runtime.state.world.clock.now + 2000000,
      },
    }),
  });
}
try {
  const original = readFileSync(join(root, 'manifest.json'));
  assert.equal(runtime.enableResourcePrincipals().ok, true);
  await cmd(a, 'principals.read', { kind: 'construction-site', id: site.id }, 1);
  assert.equal(runtime.enablePremisesPrincipals().ok, true);
  await cmd(a, 'principals.read', { kind: 'construction-site', id: site.id });
  await cmd(a, 'stocks.create', { id: 's', title: '材料', locationId: location });
  await cmd(a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 16 } });
  await cmd(b, 'business.found', {
    enterpriseId: 'firm',
    name: '经营主体',
    occupationName: '自行安排',
    initialCapital: 100,
    maxEmployees: 3,
  });
  await cmd(a, 'principals.control', {
    request: request({
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      terms: '保管控制',
      expiresAt: 2000000,
    }),
  });
  await cmd(b, 'principals.control', { request: request({ type: 'accept' }) });
  const firm = { kind: 'enterprise', id: 'firm' };
  await reserve(firm);
  const create = projectRequest(firm);
  await cmd(c, 'principals.operate', { request: create }, 1);
  await cmd(b, 'principals.operate', { actorId: c, request: create }, 2);
  await cmd(b, 'principals.operate', { request: create }, 0, 'build-once');
  await cmd(b, 'principals.operate', { request: create }, 0, 'build-once');
  assert.equal(runtime.state.world.premises.buildings.home, undefined);
  await cmd(
    b,
    'construction.start',
    { id: 'p', expectedRevision: 1, until: runtime.state.world.clock.now + 480000 },
    1,
  );
  await cmd(c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: runtime.state.world.clock.now + 480000,
  });
  assert.equal(runtime.advanceTime(480000, 'actual-work').ok, true);
  const building = runtime.state.world.premises.buildings.home;
  assert.deepEqual(building.control.controller, firm);
  assert.equal(building.ownerId, b);
  assert.deepEqual(building.embodied, { Wood: 8 });
  assert.equal(runtime.state.world.premises.projects.p.progressMs, 480000);
  await cmd(c, 'principals.read', { kind: 'premises', id: 'home' }, 1);
  const config = {
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: building.revision,
    controlVersion: building.control.version,
    operation: {
      capability: 'premises.manage-premises',
      arguments: {
        type: 'manage-premises',
        id: 'home',
        expectedRevision: building.revision,
        command: {
          type: 'configure',
          title: '开放入口',
          access: { entry: 'public', visitors: [], operators: [], residents: [] },
        },
      },
    },
  };
  await cmd(c, 'principals.operate', { request: config }, 1);
  await cmd(b, 'principals.operate', { request: config });
  await cmd(b, 'business.close', { enterpriseId: 'firm' }, 1);
  await cmd(b, 'principals.read', { kind: 'premises', id: 'home' });
  await cmd(b, 'principals.list', { limit: 3 });
  // The source firm independently reserves goods for a public project; treasury payment cannot confer custody.
  const publicPrincipal = { kind: 'public', id: 'town' };
  await reserve(publicPrincipal, 'public-r', 'public-p');
  const pub = projectRequest(publicPrincipal, 'public-p', 'public-home', 'public-r');
  await cmd(a, 'principals.operate', { request: pub }, 1);
  await publicDecision('public-build', pub);
  const p = runtime.state.world.premises.projects['public-p'];
  assert.deepEqual(p.controller, publicPrincipal);
  assert.equal(p.session, undefined);
  const cancel = {
    resourceKind: 'construction-project',
    resourceId: p.id,
    resourceRevision: p.revision,
    controlVersion: 1,
    operation: {
      capability: 'premises.cancel-construction',
      arguments: { type: 'cancel-construction', id: p.id, expectedRevision: p.revision },
    },
  };
  await cmd(a, 'construction.cancel', { id: p.id, expectedRevision: p.revision }, 1);
  await publicDecision('public-cancel', cancel);
  assert.equal(runtime.state.world.premises.projects[p.id].status, 'cancelled');
  assert.equal(stock().inventory.Wood, 8);
  assert.deepEqual(stock().control.controller, firm);
  assert.equal(runtime.state.world.premises.buildings['public-home'], undefined);
  // Independent principal use contract: manager cannot consent for the public recipient or any body.
  assert.equal(runtime.enablePrincipalPermits().ok, true);
  const rightsBuilding = runtime.state.world.premises.buildings.home;
  const permitOffer = {
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: rightsBuilding.revision,
    controlVersion: rightsBuilding.control.version,
    operation: {
      capability: 'permits.offer',
      arguments: {
        type: 'offer',
        buildingRevision: rightsBuilding.revision,
        terms: {
          id: 'public-use',
          buildingId: 'home',
          grantee: publicPrincipal,
          users: [c],
          scopes: ['operate'],
          mode: 'shared',
          title: '共同工坊使用约定',
          terms: '本人决定进入和实际劳动',
          startAt: runtime.state.world.clock.now,
          endAt: runtime.state.world.clock.now + 3600000,
          acceptBy: runtime.state.world.clock.now + 600000,
        },
      },
    },
  };
  await cmd(c, 'principals.operate', { request: permitOffer }, 1);
  await cmd(b, 'principals.operate', { request: permitOffer });
  const permitBase = () => ({
    resourceKind: 'premises-permit',
    resourceId: 'public-use',
    resourceRevision: runtime.state.world.premisesRights.permits['public-use'].revision,
    controlVersion: runtime.state.world.premisesRights.permits['public-use'].issuerVersion,
  });
  const acceptPermission = {
    ...permitBase(),
    operation: {
      capability: 'permits.accept',
      arguments: { type: 'accept', id: 'public-use', revision: 1 },
    },
  };
  await cmd(c, 'permits.accept', { id: 'public-use', expectedRevision: 1 }, 1);
  await cmd(a, 'principals.operate', { request: acceptPermission }, 1);
  await publicDecision('accept-use', acceptPermission);
  const permitRead = await cmd(c, 'permits.read', { id: 'public-use' });
  assert.equal(permitRead.data.principalAuthorization.accepted.source.proposalId, 'accept-use');
  assert.equal(permitRead.data.requestBase.resourceKind, 'premises-permit');
  assert.equal(runtime.state.world.premisesRights.permits['public-use'].status, 'accepted');
  await cmd(
    b,
    'principals.operate',
    {
      request: {
        ...permitBase(),
        operation: {
          capability: 'permits.withdraw',
          arguments: { type: 'withdraw', id: 'public-use', revision: 2, side: 'issuer' },
        },
      },
    },
    1,
  );
  const buildingControl = (command) => ({
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: runtime.state.world.premises.buildings.home.revision,
    controlVersion: runtime.state.world.premises.buildings.home.control.version,
    command,
  });
  const retained = structuredClone(runtime.state.world.premises.buildings.home);
  await cmd(b, 'principals.control', {
    request: buildingControl({
      type: 'offer',
      target: publicPrincipal,
      expiresAt: 2000000,
      terms: '保留使用和实体',
    }),
  });
  await cmd(a, 'principals.read', { kind: 'premises', id: 'home' });
  await cmd(a, 'principals.control', { request: buildingControl({ type: 'accept' }) }, 1);
  await publicDecision('accept-building', buildingControl({ type: 'accept' }));
  assert.deepEqual(runtime.state.world.premises.buildings.home.control.controller, publicPrincipal);
  await publicDecision(
    'offer-building',
    buildingControl({
      type: 'offer',
      target: { kind: 'resident', id: c },
      expiresAt: 2000000,
      terms: '独立接收',
    }),
  );
  await cmd(c, 'principals.read', { kind: 'premises', id: 'home' });
  await cmd(b, 'principals.control', { request: buildingControl({ type: 'accept' }) }, 1);
  const takeRequest = buildingControl({ type: 'accept' });
  await cmd(c, 'principals.control', { request: takeRequest }, 0, 'take-building-once');
  await cmd(c, 'principals.control', { request: takeRequest }, 0, 'take-building-once');
  const moved = runtime.state.world.premises.buildings.home;
  assert.deepEqual(moved.control.controller, { kind: 'resident', id: c });
  for (const key of [
    'ownerId',
    'siteId',
    'locationId',
    'blueprint',
    'access',
    'embodied',
    'salvage',
    'status',
    'condition',
    'footprintReleased',
  ])
    assert.deepEqual(moved[key], retained[key]);
  assert.equal(runtime.state.world.premisesRights.permits['public-use'].status, 'accepted');
  await cmd(c, 'permits.read', { id: 'public-use' });
  await publicDecision('release-use', {
    ...permitBase(),
    operation: {
      capability: 'permits.release',
      arguments: { type: 'release', id: 'public-use', revision: 2 },
    },
  });
  assert.equal(runtime.state.world.premisesRights.permits['public-use'].status, 'released');
  // Explicit v3 migration and actual public purchase; no resident token can impersonate the treasury.
  assert.equal(runtime.enablePaidPermits().ok, true);
  assert.equal(runtime.enablePrincipalTrade().ok, true);
  await cmd(c, 'principals.control', {
    request: buildingControl({
      type: 'offer',
      target: firm,
      terms: '仍由原企业记费',
      expiresAt: runtime.state.world.clock.now + 600000,
    }),
  });
  await cmd(b, 'principals.control', { request: buildingControl({ type: 'accept' }) });
  const feeBuilding = runtime.state.world.premises.buildings.home;
  await cmd(b, 'principals.operate', {
    request: {
      resourceKind: 'premises',
      resourceId: 'home',
      resourceRevision: feeBuilding.revision,
      controlVersion: feeBuilding.control.version,
      operation: {
        capability: 'permits.offer',
        arguments: {
          type: 'offer',
          buildingRevision: feeBuilding.revision,
          terms: {
            id: 'fee-use',
            buildingId: 'home',
            grantee: publicPrincipal,
            users: [c],
            scopes: ['operate'],
            mode: 'shared',
            title: '明确收费许可',
            terms: '按实际许可可用时间，未履行退原付款方',
            startAt: runtime.state.world.clock.now,
            endAt: runtime.state.world.clock.now + 3600000,
            acceptBy: runtime.state.world.clock.now + 600000,
          },
        },
      },
    },
  });
  const feePermit = () => runtime.state.world.premisesRights.permits['fee-use'];
  const feePermitBase = () => ({
    resourceKind: 'premises-permit',
    resourceId: 'fee-use',
    resourceRevision: feePermit().revision,
    controlVersion: feePermit().issuerVersion,
  });
  const quote = {
    ...feePermitBase(),
    operation: {
      capability: 'trades.offer',
      arguments: {
        type: 'offer',
        id: 'fee-order',
        title: '公共使用费用',
        terms: '原国库付款，原企业收款',
        source: { kind: 'permit', id: 'fee-use', expectedRevision: 1 },
        amount: 36,
        payer: { sector: 'treasury', id: 'public-treasury' },
        revenue: { sector: 'enterprise', id: 'firm' },
        acceptBy: runtime.state.world.clock.now + 600000,
      },
    },
  };
  await cmd(a, 'principals.operate', { request: quote }, 1);
  await cmd(b, 'principals.operate', { request: quote });
  await cmd(
    c,
    'principals.operate',
    {
      request: {
        ...feePermitBase(),
        operation: {
          capability: 'permits.accept',
          arguments: { type: 'accept', id: 'fee-use', revision: 1 },
        },
      },
    },
    1,
  );
  await cmd(b, 'trades.read', { id: 'fee-order' });
  const acceptFee = {
    resourceKind: 'evidence-order',
    resourceId: 'fee-order',
    resourceRevision: 1,
    controlVersion: 1,
    operation: {
      capability: 'trades.accept',
      arguments: {
        type: 'accept',
        id: 'fee-order',
        expectedRevision: 1,
      },
    },
  };
  await cmd(c, 'principals.operate', { request: acceptFee }, 1);
  const treasury = runtime.state.world.treasury,
    firmCash = runtime.state.world.enterprises.firm.balance,
    managerCash = runtime.state.world.agents[b].balance;
  await publicDecision('pay-fee', acceptFee);
  assert.equal(runtime.state.world.treasury, treasury - 36);
  assert.equal(runtime.state.world.enterprises.firm.balance, firmCash);
  assert.equal(runtime.state.world.agents[b].balance, managerCash);
  assert.deepEqual(feePermit().principalAuthorization.accepted.request, acceptFee);
  await cmd(c, 'permits.read', { id: 'fee-use' });
  await cmd(a, 'trades.ledger', { id: 'fee-order' });
  await cmd(c, 'principals.operate', { request: acceptFee }, 1);
  assert.equal(runtime.advanceTime(900000, 'real-fee-availability').ok, true);
  const order = () => runtime.state.world.residentTrade.principalOrders.orders['fee-order'];
  assert.equal(order().paidMicros, 9000000);
  assert.equal(runtime.state.world.enterprises.firm.balance, firmCash + 9);
  assert.equal(runtime.state.world.agents[b].balance, managerCash);
  await publicDecision('release-fee', {
    ...feePermitBase(),
    operation: {
      capability: 'permits.release',
      arguments: { type: 'release', id: 'fee-use', revision: 2 },
    },
  });
  assert.equal(order().status, 'settled');
  assert.equal(order().escrowMicros, 0);
  assert.equal(order().paidMicros, 9600000);
  assert.equal(order().refundedMicros, 26400000);
  assert.equal(runtime.state.world.treasury, treasury - 9.6);
  assert.equal(runtime.state.world.enterprises.firm.balance, firmCash + 9.6);
  assert.equal(runtime.state.world.agents[b].balance, managerCash);
  await cmd(b, 'trades.rules');
  await cmd(a, 'trades.list', { limit: 3 });
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
        validation:
          'compiled-authenticated-construction-custody-principal-permits-and-fees-CLI-not-emergence',
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
