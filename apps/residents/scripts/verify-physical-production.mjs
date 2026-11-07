// Directed compiled CLI acceptance of finite extraction and actual food production, not autonomous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-physical-production-cli-'));
const manifest = createOpenSocietyManifest({
  count: 4,
  continuity: true,
  physicalProduction: true,
  initialization: 'newcomers',
});
const locationId = Object.values(manifest.initialWorld.locations).find(
  (l) => l.kind === 'production',
).locationId;
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
          inventory: {},
          residentialTier: 1,
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
      [executable, ...argv, '--request-id', `material-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit resource control CLI acceptance' });
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
const run = (actor, route, args = {}, code = 0) =>
  call(
    actor,
    [
      ...route.split('.'),
      ...Object.entries(args).flatMap(([k, v]) => {
        const flag = '--' + k.replace(/[A-Z]/g, (x) => '-' + x.toLowerCase());
        return Array.isArray(v)
          ? v.flatMap((x) => [flag, String(x)])
          : [flag, typeof v === 'object' ? JSON.stringify(v) : String(v)];
      }),
    ],
    code,
  );
const stock = () => runtime.state.world.materials.stocks.food;
const job = (id) => runtime.state.world.materials.productions[id];
const source = (id) => runtime.state.world.materials.extraction.sources[id];
const time = (ms) => {
  const v = runtime.advanceTime(ms, `time-${++ordinal}`);
  assert.equal(v.ok, true, v.error);
};
const start = async (id, ms) =>
  run(a, 'production.start', {
    id,
    expectedRevision: job(id).revision,
    until: runtime.state.world.clock.now + ms,
  });
try {
  const supply = runtime.state.world.moneySupply;
  await run(a, 'sources.list');
  await run(a, 'sources.read', { id: 'source-wheat' });
  await run(a, 'production.recipes', { limit: 30 });
  const mode = await run(a, 'city.observe', { view: 'rules', section: 'production' });
  assert.equal(
    mode.data.legacyProduction,
    'business produce is disabled in this explicitly enabled mode',
  );
  await run(
    a,
    'business.produce',
    { commodityName: 'Bread', quantity: 1, availableLaborSeconds: 600 },
    1,
  );
  await run(a, 'stocks.create', { id: 'food', title: '自己选择的食物', locationId });
  const gather = {
    id: 'grain',
    stockId: 'food',
    expectedRevision: stock().revision,
    sourceId: 'source-wheat',
    sourceRevision: 1,
    quantity: 1,
    workers: [a],
    productName: '谷物',
    description: '自己的选择',
  };
  const { workers, ...withoutWorkers } = gather;
  assert.deepEqual(workers, [a]);
  const beforeMissingWorkers = structuredClone(runtime.state.world.materials);
  const missingWorkers = await run(a, 'production.gather', withoutWorkers, 2);
  assert.equal(missingWorkers.error, 'missing-argument:workers');
  assert.deepEqual(runtime.state.world.materials, beforeMissingWorkers);
  await run(b, 'production.gather', gather, 1);
  await run(a, 'production.gather', gather);
  assert.deepEqual(stock().inventory, {});
  assert.equal(source('source-wheat').remaining, 99);
  await run(
    a,
    'stocks.withdraw',
    { id: 'food', expectedRevision: stock().revision, recipientId: a, items: { Wheat: 1 } },
    1,
  );
  await start('grain', 60000);
  time(30000);
  assert.deepEqual(stock().inventory, {});
  assert.equal(job('grain').progressMs, 30000);
  await run(a, 'production.leave', { id: 'grain', expectedRevision: job('grain').revision });
  await run(a, 'production.read', { id: 'grain' });
  await start('grain', 30000);
  time(30000);
  assert.deepEqual(stock().inventory, { Wheat: 1 });
  for (const [id, recipeId] of [
    ['flour', 'flour'],
    ['bread', 'bread'],
  ]) {
    await run(a, 'production.create', {
      id,
      stockId: 'food',
      expectedRevision: stock().revision,
      recipeId,
      quantity: 1,
      workers: [a],
      productName: '自制食物',
      description: '独立安排',
    });
    const duration = job(id).recipe.workMs;
    await start(id, duration);
    time(duration);
  }
  assert.deepEqual(stock().inventory, { Bread: 1 });
  assert.equal(runtime.state.world.agents[a].residentialTier, 1);
  await run(a, 'production.gather', {
    ...gather,
    id: 'cancelled',
    expectedRevision: stock().revision,
    sourceRevision: source('source-wheat').revision,
    quantity: 2,
  });
  assert.equal(source('source-wheat').remaining, 97);
  await run(a, 'production.cancel', {
    id: 'cancelled',
    expectedRevision: job('cancelled').revision,
  });
  assert.equal(source('source-wheat').remaining, 99);
  assert.deepEqual(stock().inventory, { Bread: 1 });
  await run(a, 'stocks.withdraw', {
    id: 'food',
    expectedRevision: stock().revision,
    recipientId: a,
    items: { Bread: 1 },
  });
  await run(a, 'travel.go', { targetLocationId: 'restaurant' });
  time(runtime.state.world.transitByAgent[a].arrivesAt - runtime.state.world.clock.now);
  const satiety = runtime.state.world.agents[a].physiology.satiety;
  await run(a, 'life.eat', { commodityName: 'Bread', quantity: 1 });
  assert.equal(runtime.state.world.agents[a].inventory.Bread ?? 0, 0);
  assert.ok(runtime.state.world.agents[a].physiology.satiety > satiety);
  assert.equal(runtime.state.world.moneySupply, supply);
  assert.equal(
    runtime.journal.commits
      .flatMap((c) => c.worldEvents ?? [])
      .some((e) => e.type === 'CommodityProduced'),
    false,
  );
  // Three independent actors compete for two source slots; indoor capacity is unrelated.
  const contenders = [b, c, d];
  for (const [i, actor] of contenders.entries()) {
    const stockId = `private-stock-${i}`,
      id = `private-job-${i}`;
    await run(actor, 'stocks.create', { id: stockId, title: stockId, locationId });
    await run(actor, 'production.gather', {
      id,
      stockId,
      expectedRevision: runtime.state.world.materials.stocks[stockId].revision,
      sourceId: 'source-wood',
      sourceRevision: source('source-wood').revision,
      quantity: 1,
      workers: [actor],
      productName: 'wood',
      description: 'private purpose',
    });
  }
  const compete = (i, code = 0) =>
    run(
      contenders[i],
      'production.start',
      {
        id: `private-job-${i}`,
        expectedRevision: job(`private-job-${i}`).revision,
        until: runtime.state.world.clock.now + job(`private-job-${i}`).recipe.workMs,
      },
      code,
    );
  await compete(0);
  await compete(1);
  const occupied = await run(d, 'sources.read', { id: 'source-wood' });
  assert.deepEqual(occupied.data.source.laborSlots, {
    version: 'material-source-labor-capacity-v1',
    capacity: 2,
    inUse: 2,
    available: 0,
  });
  assert.equal(JSON.stringify(occupied.data).includes('private-job'), false);
  assert.equal(JSON.stringify(occupied.data).includes('private-stock'), false);
  const blockedWorld = structuredClone(runtime.state.world);
  const refused = await compete(2, 1);
  assert.equal(refused.error, 'material-source-labor-capacity-unavailable');
  assert.deepEqual(runtime.state.world, blockedWorld);
  await run(b, 'production.leave', {
    id: 'private-job-0',
    expectedRevision: job('private-job-0').revision,
  });
  const released = await run(d, 'production.read', { id: 'private-job-2' });
  assert.equal(released.data.sourceWork.laborSlots.available, 1);
  await compete(2);
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
        finiteWheatConsumed: 1,
        residentialTier: 1,
        partialWorkResumed: true,
        cancellationDidNotGrantUnearnedGoods: true,
        actualGatherMillBakeEat: true,
        sourceContentionAndRelease: true,
        aggregateSourceQueryWithoutPrivateJobs: true,
        noLegacyProduction: true,
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
