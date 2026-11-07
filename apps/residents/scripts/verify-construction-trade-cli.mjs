// Deterministic compiled CLI + authenticated HTTP acceptance; not a model or emergence run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/construction-trade-cli');
if (existsSync(join(root, 'manifest.json'))) throw Error('fresh-directory-required');
mkdirSync(root, { recursive: true, mode: 0o700 });
const base = createOpenSocietyManifest({
  count: 4,
  continuity: true,
  publicGovernance: true,
  resourcePrincipals: true,
  premisesPrincipals: true,
  constructionTrade: true,
});
const [donor, buyer, seller, stranger] = base.residents.map((r) => r.id),
  site = Object.values(base.initialWorld.premises.sites)[0];
const manifest = {
  ...base,
  initialWorld: {
    ...base.initialWorld,
    agents: Object.fromEntries(
      Object.entries(base.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId: site.parentLocationId,
          inventory: { Wood: 20 },
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  },
};
let runtime = new OpenSocietyRuntime(root, manifest);
const credentials = loadResidentCredentials(
  root,
  base.residents.map((r) => r.id),
);
const server = await startResidentServer(runtime, credentials),
  cli = fileURLToPath(new URL('../dist/town.js', import.meta.url));
const calls = [];
const constructionTradeRequest = (c) => ({
  resourceKind: c.type === 'offer' ? 'construction-project' : 'construction-order',
  resourceId: c.type === 'offer' ? c.terms.projectId : c.id,
  resourceRevision: c.type === 'offer' ? c.terms.sourceRevision : c.expectedRevision,
  controlVersion: 1,
  operation: { capability: `construction-trades.${c.type}`, arguments: c },
});
const escrow = () =>
  runtime.state.world.residentTrade.constructionOrders.orders.order.escrowMicros / 1e6;
async function call(actor, route, args = {}, accepted = true) {
  const argv = [cli, ...route.split(' ')];
  for (const [k, v] of Object.entries(args))
    for (const value of Array.isArray(v) ? v : [v])
      argv.push(
        '--' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()),
        typeof value === 'object' ? JSON.stringify(value) : String(value),
      );
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  runtime.finishTurn(actor, { summary: 'Deterministic CLI acceptance' });
  const value = JSON.parse(result.stdout);
  calls.push({ actor, route, code: result.code, result: value });
  assert.equal(result.code, accepted ? 0 : 1, result.stdout + result.stderr);
  assert.equal(value.ok, accepted);
  return value;
}
let failure;
try {
  await call(donor, 'stocks create', {
    id: 's',
    title: '自愿供料',
    locationId: site.parentLocationId,
  });
  await call(donor, 'stocks deposit', { id: 's', expectedRevision: 1, items: { Wood: 8 } });
  await call(donor, 'materials reserve', {
    id: 'r',
    stockId: 's',
    expectedStockRevision: 2,
    beneficiaryKind: 'resident',
    beneficiaryId: buyer,
    consumerDomain: 'premises',
    consumerId: 'p',
    items: { Wood: 8 },
    terms: '独立供料',
    expiresAt: 1000000,
  });
  await call(buyer, 'construction create', {
    id: 'p',
    kind: 'build',
    buildingId: 'home',
    siteId: site.id,
    expectedSiteRevision: site.revision,
    controllerKind: 'resident',
    controllerId: buyer,
    title: '居民约定房屋',
    description: '原文',
    workers: [seller],
    reservationRefs: ['r@1'],
    primaryUse: 'residence',
    floorArea: 8,
    capacity: 2,
    workstations: 0,
    careStations: 0,
    teachingStations: 0,
    storageUnits: 0,
  });
  const project = runtime.state.world.premises.projects.p;
  await call(seller, 'principals read', { kind: 'construction-project', id: 'p' });
  const offer = {
    type: 'offer',
    terms: {
      id: 'order',
      projectId: 'p',
      sourceRevision: project.revision,
      seller: { kind: 'resident', id: seller },
      buyer: { kind: 'resident', id: buyer },
      payer: { sector: 'agent', id: buyer },
      revenue: { sector: 'agent', id: seller },
      amount: 30,
      acceptBy: 10000,
      title: '施工约定',
      terms: '原文，真实完成后支付',
    },
  };
  const probe = {
    ...offer,
    terms: {
      ...offer.terms,
      id: 'probe',
      seller: { kind: 'resident', id: stranger },
      revenue: { sector: 'agent', id: stranger },
    },
  };
  await call(stranger, 'principals operate', { request: constructionTradeRequest(probe) }, false);
  assert.equal(runtime.state.world.residentTrade.constructionOrders.orders.probe, undefined);
  await call(seller, 'principals operate', { request: constructionTradeRequest(offer) });
  await call(stranger, 'principals read', { kind: 'construction-order', id: 'order' }, false);
  const before = runtime.state.world.agents[buyer].balance;
  await call(buyer, 'principals operate', {
    request: constructionTradeRequest({
      type: 'accept',
      id: 'order',
      expectedRevision: 1,
      side: 'buyer',
    }),
  });
  assert.equal(runtime.state.world.agents[buyer].balance, before - 30);
  assert.equal(escrow(), 30);
  await call(seller, 'construction start', {
    id: 'p',
    expectedRevision: project.revision,
    until: runtime.state.world.clock.now + project.plan.workMs,
  });
  assert.equal(runtime.advanceTime(project.plan.workMs, 'actual-work').ok, true);
  const earnings = runtime.state.world.agents[seller].balance;
  await call(seller, 'principals operate', {
    request: constructionTradeRequest({
      type: 'observe',
      id: 'order',
      expectedRevision: 2,
      side: 'seller',
    }),
  });
  assert.equal(runtime.state.world.agents[seller].balance, earnings + 30);
  assert.equal(escrow(), 0);
  const read = await call(buyer, 'principals read', { kind: 'construction-order', id: 'order' });
  assert.equal(read.data.order.status, 'completed');
  await call(buyer, 'rules read', { id: 'construction-procurement' });
  const state = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'), 'utf8');
  await server.close();
  runtime.close();
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, state);
  assert.equal(readFileSync(join(root, 'journal.jsonl'), 'utf8'), bytes);
} catch (e) {
  failure = e;
} finally {
  await server.close().catch(() => {});
  runtime.close();
  writeFileSync(
    join(root, 'acceptance.json'),
    JSON.stringify(
      {
        passed: !failure,
        mode: 'compiled-cli-authenticated-http-not-model',
        calls,
        ...(failure ? { failure: String(failure) } : {}),
      },
      null,
      2,
    ) + '\n',
  );
}
if (failure) throw failure;
console.log(
  JSON.stringify({
    passed: true,
    root,
    calls: calls.length,
    expectedRefusals: calls.filter((c) => c.code !== 0).length,
    replay: true,
  }),
);
