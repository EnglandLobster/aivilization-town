// Explicitly prompted model integration acceptance, never a free-society or emergence experiment.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import {
  loadResidentCredentials,
  startResidentServer,
  createOpenCodeResidentDriver,
  residentReport,
} from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/society-kernel-acceptance');
if (existsSync(join(root, 'manifest.json'))) throw new Error('use-a-fresh-acceptance-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 2 }));
const [a, b] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b]);
const server = await startResidentServer(runtime, credentials);
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
const turns = [];
const initial = {
  a: runtime.state.world.agents[a].balance,
  b: runtime.state.world.agents[b].balance,
  supply: runtime.state.world.moneySupply,
};
let failure;
try {
  const tasks = [
    `按需阅读 town wiki society/index.md 与子页面。创建 private register meta-ledger，唯一字段 note 类型 string，editors 指定 ${b}，无需其他 readers。发布 program meta-program，runner 仅你本人 ${a}，包含三步且 principalId 全为 ${b}：payments.transfer 向 ${a} 支付1元，note 原话自拟；records.append 向 meta-ledger 写入 note 原话；messages.send 向 ${a} 发送一段原话。定义和参数通过帮助查询，只发布，不运行、不代替对方授权。标题、目的和原文内容由你写。`,
    `按需查阅元能力指南，通过 programs read 阅读 meta-program 的当前完整版本。作为本人 ${b}，创建 mandate meta-consent，授权 runner ${a} 对 meta-program 当前精确版本运行最多2次，expires-at 为300000模拟毫秒。读取这个授权确认。不要代替执行人运行，不移动、不工作或其他经济活动。`,
    `查询 meta-program 和授权状态，运行 meta-program 当前版本一次；随后创建 schedule meta-schedule，program-id meta-program、program-revision 使用刚执行的版本，start-at 为60000模拟毫秒，interval-ms 为60000，runs 为1。读取执行记录与计划。不重复手动运行，不推进时间。`,
  ];
  for (let i = 0; i < tasks.length; i++) {
    const actorId = i === 1 ? b : a;
    const turn = runtime.beginTurn(actorId, 'society-kernel-prompted-acceptance');
    const previous = Object.values(runtime.state.turns)
      .filter((t) => t.actorId === actorId && t.sessionId)
      .at(-1);
    console.log(JSON.stringify({ stage: i + 1, actorId, status: 'running' }));
    const driver = createOpenCodeResidentDriver({
      connection: { endpoint: server.url, token: credentials.residents[actorId] },
      model,
      directory: join(root, 'opencode', actorId),
      ...(previous?.sessionId ? { sessionId: previous.sessionId } : {}),
      task: `这是明确提示的工程验收，不是自然社会实验。只执行本轮内容，使用 town CLI 与帮助，原文由你创作。\n${tasks[i]}\n结束当前轮即可，不要 schedule wait 或其他任务。`,
    });
    const result = await driver.run({
      actorId,
      turnId: turn.id,
      context: runtime.context(actorId),
      signal: globalThis.AbortSignal.timeout(300000),
      invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
    });
    runtime.finishTurn(actorId, result);
    turns.push({
      stage: i + 1,
      actorId,
      status: result.status,
      calls: runtime.state.turns[turn.id].calls,
    });
    console.log(JSON.stringify(turns.at(-1)));
    if (result.status !== 'completed') throw new Error('provider-error');
  }
  assert.equal(runtime.advanceTime(60000, 'scheduled-acceptance').ok, true);
} catch (error) {
  failure = error instanceof Error ? error.message : 'unknown-failure';
}
const s = runtime.state;
const checks = {
  independentConsent: s.coordination?.mandates['meta-consent']?.principalId === b,
  exactlyTwoExecutions:
    Object.values(s.coordination?.runs ?? {}).filter((r) => r.status === 'succeeded').length === 2,
  actualTransfer:
    s.world.agents[a].balance === initial.a + 2 && s.world.agents[b].balance === initial.b - 2,
  supplyPreserved: s.world.moneySupply === initial.supply,
  twoSharedRecords:
    Object.values(s.sharedRecords?.records ?? {}).filter(
      (r) => r.registerId === 'meta-ledger' && r.authorityId === b && r.editedBy === a,
    ).length === 2,
  delegatedMessages:
    Object.values(s.information.messages).filter(
      (m) =>
        m.senderId === b &&
        m.recipientId === a &&
        m.executedBy === a &&
        m.mandateId === 'meta-consent',
    ).length === 2,
  scheduleFinished: s.coordination?.schedules['meta-schedule']?.status === 'completed',
};
const state = structuredClone(s),
  bytes = readFileSync(join(root, 'journal.jsonl'));
writeFileSync(join(root, 'report.json'), JSON.stringify(residentReport(runtime), null, 2), {
  mode: 0o600,
});
await server.close();
runtime.close();
const reopened = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(reopened.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
} finally {
  reopened.close();
}
const result = {
  mode: 'prompted-model-integration-not-emergence',
  model,
  passed: !failure && Object.values(checks).every(Boolean),
  turns,
  checks,
  replayEqual: true,
  ...(failure ? { failure } : {}),
};
writeFileSync(join(root, 'verification.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
