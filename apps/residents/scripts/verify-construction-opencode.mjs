// Prompted cross-capability usability acceptance; not spontaneous housing cooperation.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import {
  createOpenCodeResidentDriver,
  loadResidentCredentials,
  startResidentServer,
} from '../dist/index.js';

const root = resolve(process.argv[2] ?? '.local/open-residents/construction-opencode-acceptance');
if (existsSync(join(root, 'manifest.json'))) throw Error('use-a-fresh-acceptance-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const base = createOpenSocietyManifest({
  count: 2,
  continuity: true,
  elapsedRest: true,
  housingOccupancy: true,
});
const [donor, builder] = base.residents.map((r) => r.id);
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
const credentials = loadResidentCredentials(root, [donor, builder]);
const server = await startResidentServer(runtime, credentials);
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
const turns = [];
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
  await run(
    donor,
    `你持有8单位Wood，希望自愿供给${builder}建一间住宅：项目ID home-project，建筑ID shared-home，面积8、容量2，无任何额外设施。请查询所需材料，建立库存home-stock并存入材料，保留给该人和该项目，保留ID home-materials，到期设为当前模拟时间之后24小时。不要替他创建或参加工程。`,
  );
  const reservation = runtime.state.world.materials.reservations.records['home-materials'];
  assert.ok(reservation, 'model did not reserve actual material');
  assert.deepEqual(reservation.beneficiary, { kind: 'resident', id: builder });
  assert.equal(runtime.state.world.agents[donor].inventory.Wood ?? 0, 0);
  assert.equal(Object.keys(runtime.state.world.premises.projects).length, 0);
  await run(
    builder,
    `另一居民${donor}已为你保留home-materials材料。你同意自己建房：项目home-project、建筑shared-home，住宅面积8、容量2、所有额外设施为0。请读取实际保留和场地，创建该工程，仅将你自己列为工人，然后本人开始足够完成的劳动。不要代供料人劳动或选择住所。`,
  );
  const project = runtime.state.world.premises.projects['home-project'];
  assert.ok(project?.session, 'model did not start actual construction');
  assert.equal(project.session.actorId, builder);
  assert.equal(project.progressMs, 0);
  assert.equal(runtime.state.world.premises.buildings['shared-home'], undefined);
  advanceTo(project.session.until, 'actual builder shift');
  assert.equal(runtime.state.world.premises.projects['home-project'].status, 'completed');
  const building = runtime.state.world.premises.buildings['shared-home'];
  assert.equal(building.status, 'operational');
  assert.equal(building.embodied.Wood, 8);
  assert.ok(runtime.state.world.agents[builder].physiology.energy < 100);
  await run(
    builder,
    `工程时间已经实际经过，请查询home-project和shared-home的真实结果。你希望允许${donor}进入和登记居住，请配置这栋建筑的相应权限。不要代他移动、登记住所或修改个人服务等级。`,
  );
  assert.ok(runtime.state.world.premises.buildings['shared-home'].access.residents.includes(donor));
  assert.notEqual(runtime.state.world.agents[donor].residenceLocationId, building.locationId);
  await run(
    donor,
    '供料的shared-home已经建成，对方给你居住许可。你决定搬入。请先自行核对真实建筑与使用权，再开始实际出行前往建筑。此轮只完成查询与出发；尚未到达就不要声称已经入住。',
  );
  assert.notEqual(runtime.state.world.agents[donor].locationId, building.locationId);
  advanceTo(runtime.state.world.activityTimeByAgent[donor].availableAt, 'actual resident travel');
  assert.equal(runtime.state.world.agents[donor].locationId, building.locationId);
  await run(
    donor,
    '实际出行时间已过。请核对到达事实，按本人意愿将shared-home登记为住所，再查询当前居住状态。不要改变服务等级、付款或开始其他活动。',
  );
  assert.equal(runtime.state.world.agents[donor].residenceLocationId, building.locationId);
  assert.equal(
    runtime.state.world.premises.projects['home-project'].progressMs,
    project.plan.workMs,
  );
  assert.equal(runtime.state.world.moneySupply, manifest.initialWorld.moneySupply);
  assert.equal(
    runtime.state.world.agents[donor].residentialTier,
    manifest.initialWorld.agents[donor].residentialTier,
  );
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
  mode: 'prompted-cross-capability-construction-not-emergence',
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
