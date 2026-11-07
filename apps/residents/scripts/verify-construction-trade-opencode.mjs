import { createHash } from 'node:crypto';
// Prompted model usability of construction procurement; engineering project setup is explicitly separate.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import {
  createOpenCodeResidentDriver,
  loadResidentCredentials,
  startResidentServer,
} from '../dist/index.js';

const root = resolve(
  process.argv[2] ?? '.local/open-residents/construction-trade-opencode-acceptance',
);
if (existsSync(join(root, 'manifest.json'))) throw Error('use-a-fresh-acceptance-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const base = createOpenSocietyManifest({
  count: 3,
  publicGovernance: true,
  resourcePrincipals: true,
  premisesPrincipals: true,
  constructionTrade: true,
  continuity: true,
  elapsedRest: true,
  housingOccupancy: true,
});
const [donor, buyer, builder] = base.residents.map((r) => r.id);
const site = Object.values(base.initialWorld.premises.sites)[0];
// Explicit initial test stock and co-location, not manufactured material or historical travel.
const manifest = {
  ...base,
  initialWorld: {
    ...base.initialWorld,
    agents: Object.fromEntries(
      Object.entries(base.initialWorld.agents).map(([id, agent]) => [
        id,
        {
          ...agent,
          locationId: site.parentLocationId,
          inventory: { ...agent.inventory, Wood: id === donor ? 8 : 0 },
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  },
};
const runtime = new OpenSocietyRuntime(root, manifest);
const credentials = loadResidentCredentials(root, [donor, buyer, builder]);
const server = await startResidentServer(runtime, credentials);
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
function compiledHashes() {
  const paths = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) paths.push(p);
    }
  };
  for (const parent of ['apps', 'packages'])
    for (const name of readdirSync(parent)) {
      const dir = join(parent, name, 'dist');
      if (existsSync(dir)) walk(dir);
    }
  return Object.fromEntries(
    paths.sort().map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]),
  );
}
const compiledBefore = compiledHashes();
const turns = [];
const setup = [];
function engineering(actorId, name, args) {
  runtime.beginTurn(actorId, 'explicit-engineering-project-setup');
  const result = runtime.invoke(actorId, {
    name,
    arguments: args,
    requestId: `setup-${setup.length + 1}`,
  });
  runtime.finishTurn(actorId, { summary: 'Explicit engineering setup, not model behavior' });
  setup.push({ actorId, name, result });
  assert.equal(result.ok, true, result.error);
}
const boundaries = [];
let failure;
async function run(actorId, task) {
  const turn = runtime.beginTurn(actorId, 'prompted-construction-usability');
  const start = runtime.journal.commits.length;
  const directory = join(root, 'opencode', actorId);
  console.log(JSON.stringify({ stage: turns.length + 1, actorId, status: 'running' }));
  const driver = createOpenCodeResidentDriver({
    connection: { endpoint: server.url, token: credentials.residents[actorId] },
    model,
    directory,
    task: `这是明确提示的跨能力可用性验收，不是自由社会实验。自行查阅平台帮助选择操作；不能冒充对方或把文字当实物。不转账、不发布无关内容、不安排等待；需要实际时间时由验收运行者在轮次间推进。\n${task}\n完成本阶段后结束本轮。`,
  });
  const result = await driver.run({
    actorId,
    turnId: turn.id,
    context: runtime.context(actorId),
    signal: globalThis.AbortSignal.timeout(300000),
    invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
  });
  runtime.finishTurn(actorId, result);
  const calls = runtime.journal.commits
    .slice(start)
    .filter((c) => c.capability)
    .map((c) => ({
      actorId: c.actorId,
      capability: c.capability,
      ok: c.result.ok,
      error: c.result.error,
    }));
  turns.push({ actorId, turnId: turn.id, result, calls });
  assert.equal(result.status, 'completed');
}
function advanceTo(at, reason) {
  const delta = at - runtime.state.world.clock.now;
  assert.ok(Number.isSafeInteger(delta) && delta > 0 && delta <= 86400000);
  const result = runtime.advanceTime(delta, `construction-check-${boundaries.length + 1}`);
  boundaries.push({ at, reason, ok: result.ok, error: result.error });
  assert.equal(result.ok, true, result.error);
}
try {
  engineering(donor, 'stocks.create', {
    id: 'stock',
    title: '工程验收供料',
    locationId: site.parentLocationId,
  });
  engineering(donor, 'stocks.deposit', { id: 'stock', expectedRevision: 1, items: { Wood: 8 } });
  engineering(donor, 'materials.reserve', {
    id: 'material',
    stockId: 'stock',
    expectedStockRevision: 2,
    beneficiaryKind: 'resident',
    beneficiaryId: buyer,
    consumerDomain: 'premises',
    consumerId: 'project',
    items: { Wood: 8 },
    terms: '显式工程验收供料',
    expiresAt: 86400000,
  });
  engineering(buyer, 'construction.create', {
    id: 'project',
    kind: 'build',
    buildingId: 'home',
    siteId: site.id,
    expectedSiteRevision: site.revision,
    controllerKind: 'resident',
    controllerId: buyer,
    title: '验收工程',
    description: '预先实际供料工程，尚未开工',
    workers: [builder],
    reservationRefs: ['material@1'],
    primaryUse: 'residence',
    floorArea: 8,
    capacity: 2,
    workstations: 0,
    careStations: 0,
    teachingStations: 0,
    storageUnits: 0,
  });
  const buyerBefore = runtime.state.world.agents[buyer].balance;
  await run(
    builder,
    `已有实际工程project，受益人是${buyer}，你已被列为可参与者但尚未劳动。你希望向他报价承担施工，总价30，订单ID order，原文由你写，到期为当前模拟时间后1小时，收款到你本人的账户。请自行查帮助和实际工程，发出需要买方独立接受的报价。不要提前劳动，不替对方接受，不直接转账。`,
  );
  let order = runtime.state.world.residentTrade.constructionOrders.orders.order;
  assert.equal(order?.status, 'offered', 'model must create a real offer');
  assert.equal(order.amount, 30);
  assert.equal(runtime.state.world.agents[buyer].balance, buyerBefore);
  assert.equal(order.escrowMicros, 0);
  await run(
    buyer,
    `居民${builder}已对你的实际工程project发出施工订单order，总价30。你愿意接受。请先读取真实条款和版本，再按你本人的意愿接受并核对资金已托管。此轮不要劳动、单独转账或代对方确认完成。`,
  );
  order = runtime.state.world.residentTrade.constructionOrders.orders.order;
  assert.equal(order.status, 'funded');
  assert.equal(order.escrowMicros, 30000000);
  assert.equal(runtime.state.world.agents[buyer].balance, buyerBefore - 30);
  await run(
    builder,
    '买方已接受order并实际托管资金。你自愿开始project的实际施工，请核对订单、工程和所需工时，然后本人开始足够完成的劳动。这一轮不提前声称完工或领款，实际时间由运行者推进。',
  );
  const project = runtime.state.world.premises.projects.project;
  assert.equal(project.session?.actorId, builder);
  assert.equal(project.progressMs, 0);
  advanceTo(project.session.until, 'actual personal construction');
  assert.equal(runtime.state.world.premises.projects.project.status, 'completed');
  assert.equal(runtime.state.world.premises.buildings.home.embodied.Wood, 8);
  const sellerBefore = runtime.state.world.agents[builder].balance;
  await run(
    builder,
    '实际施工时间已经过去。请核对project的客观完成事实，按order原约定申请实际付款结算，并核对订单托管与收款结果；不要单独转账、修改条款或以文字代替执行。',
  );
  order = runtime.state.world.residentTrade.constructionOrders.orders.order;
  assert.equal(order.status, 'completed');
  assert.equal(order.escrowMicros, 0);
  assert.equal(order.paidMicros, 30000000);
  assert.equal(runtime.state.world.agents[builder].balance, sellerBefore + 30);
  assert.equal(runtime.state.world.moneySupply, manifest.initialWorld.moneySupply);
  assert.deepEqual(compiledHashes(), compiledBefore, 'compiled code changed during model run');
} catch (error) {
  failure = error instanceof Error ? error.message : 'unknown-error';
}
// Persist failure evidence as well as successes, and independently reopen the committed journal.
const state = structuredClone(runtime.state);
const bytes = readFileSync(join(root, 'journal.jsonl'));
await server.close();
runtime.close();
const reopened = new OpenSocietyRuntime(root);
let replayEqual = false;
try {
  assert.deepEqual(reopened.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  replayEqual = true;
} finally {
  reopened.close();
}
const report = {
  mode: 'prompted-construction-trade-not-emergence',
  setup,
  compiledBefore,
  compiledAfter: compiledHashes(),
  model,
  passed: !failure && replayEqual,
  turns,
  boundaries,
  replayEqual,
  ...(failure ? { failure } : {}),
};
writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
