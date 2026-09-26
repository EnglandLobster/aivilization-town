// Deliberately prompted acceptance. Does not change the free-mode scheduler or infer emergence.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import {
  loadResidentCredentials,
  startResidentServer,
  createOpenCodeResidentDriver,
  residentReport,
} from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/life-acceptance');
if (existsSync(join(root, 'manifest.json'))) throw Error('use-a-fresh-acceptance-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 2 }));
const [a, b] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b]);
const server = await startResidentServer(runtime, credentials);
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
let completed = false;
try {
  for (let i = 0; i < 8; i++) {
    const actorId = i % 2 === 0 ? a : b;
    const delay = runtime.state.residents[actorId].nextWakeAt - runtime.state.world.clock.now;
    if (delay > 0) assert.equal(runtime.advanceTime(delay, `wake-${i}`).ok, true);
    const now = runtime.state.world.clock.now;
    const tasks = [
      `阅读 town wiki life/index.md 和按需子页面。建立群 life-group 并邀请 ${b}；提出 proposal life-proposal，参与者仅 ${b}，有效期 ${now + 86400000}，条款由你写；提出 family 类型 life-family 与 ${b}；发布 service 报价 life-offer，commodity service，unit-price 1，max-quantity 1，服务描述由你写；以你自己为照护接受者向 ${b} 请求 life-care，地点 town-square，duration-ms 1000。这里只是验证命令链路，你可以自由写内容。`,
      `读取索引和邀请列表，以本人身份接受 life-group 邀请、life-proposal 提议及 life-family 关系。向 life-offer 下单 life-order，报价版本 1、数量 1；接受你作为照护提供者的 life-care。使用查询获取当前版本，不要替另一人同意。`,
      `接受 life-order（当前版本从 orders read 获取），在 life-group 发一段自己的原话。给自己添加 health note life-health 并授权 ${b} 访问。发布 event 服务 life-event，地点 town-square，容量 1，标题和描述自主；创建时段 life-slot，start ${now}，end ${now + 14400000}，capacity 1。`,
      `支付已经被卖方接受的 life-order。读取 life-group 原始消息和 ${a} 授权给你的 health records。向 life-slot 提出 booking life-booking，units 1。`,
      `查看 life-order 并执行 deliver，双方仍在 town-square，交付声明由你写；接受 life-booking。向 ${b} 创建付款请求 life-split，amount-each 1，原始说明自拟。`,
      `读取并确认 life-order，支付你在 life-split 的份额。自愿锁入押金 life-deposit，受益人 ${a}，amount 1，说明自拟。你是 life-care 提供者，现在双方都空闲，执行 care start；这会让双方忙碌 1000 模拟毫秒。`,
      `作为受益人将 life-deposit 返还付款人。撤销 ${b} 对你病历的访问。将 life-group 群主转交给已有成员 ${b}，然后自己退出。可查询帮助和当前群 revision。`,
      `你仍是 life-group 的成员/群主，读取保留下来的消息。读取 life-booking 并真实 check-in；其截止时间尚未到且地点为 town-square。不要声称已完成活动；只有系统推进到结束时才会完成。`,
    ];
    const turn = runtime.beginTurn(actorId, 'life-integration-acceptance');
    const previous = Object.values(runtime.state.turns)
      .filter((t) => t.actorId === actorId && t.sessionId)
      .at(-1);
    console.log(JSON.stringify({ stage: i + 1, actorId, turnId: turn.id, simulationTime: now }));
    const driver = createOpenCodeResidentDriver({
      connection: { endpoint: server.url, token: credentials.residents[actorId] },
      model,
      directory: join(root, 'opencode', actorId),
      ...(previous?.sessionId ? { sessionId: previous.sessionId } : {}),
      task: `这是有明确步骤的集成验收，不是自由社会实验。只执行本轮内容；通过 town CLI 和 --help 查询参数，所有个人文案保留原话。\n${tasks[i]}\n结束本轮，不用自行推进时间或添加额外任务。`,
    });
    const result = await driver.run({
      actorId,
      turnId: turn.id,
      context: runtime.context(actorId),
      signal: globalThis.AbortSignal.timeout(240000),
      invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
    });
    runtime.finishTurn(actorId, result);
    console.log(
      JSON.stringify({
        stage: i + 1,
        status: result.status,
        calls: runtime.state.turns[turn.id].calls,
      }),
    );
    if (result.status === 'provider-error') throw Error('provider-error');
    runtime.advanceTime(1000, `cadence-${i}`);
  }
  const end = runtime.state.services.slots['life-slot']?.end;
  if (end && end > runtime.state.world.clock.now)
    runtime.advanceTime(end - runtime.state.world.clock.now, 'finish-attendance');
  const s = runtime.state;
  const checks = {
    groupConsentAndExit:
      s.communication.groups['life-group']?.ownerId === b &&
      !s.communication.groups['life-group']?.members.includes(a),
    proposalAccepted: s.collaboration.proposals['life-proposal']?.status === 'accepted',
    orderCompleted: s.world.residentCommerce.orders['life-order']?.status === 'completed',
    paymentSettled: s.world.residentCommerce.requests['life-split']?.closed === true,
    depositReturned: s.world.residentCommerce.deposits['life-deposit']?.status === 'returned',
    bookingCompleted: s.services.bookings['life-booking']?.status === 'completed',
    familyAccepted: s.life.households.links['life-family']?.status === 'active',
    careCompleted: s.life.care.tasks['life-care']?.status === 'completed',
    healthPermissionRevoked:
      !s.life.health.grants[a]?.includes(b) &&
      s.life.health.records['life-health']?.patientId === a,
  };
  const verification = {
    mode: 'prompted-life-integration-not-emergence',
    model,
    passed: Object.values(checks).every(Boolean),
    checks,
  };
  writeFileSync(join(root, 'verification.json'), JSON.stringify(verification, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(verification));
  completed = verification.passed;
} finally {
  writeFileSync(join(root, 'report.json'), JSON.stringify(residentReport(runtime), null, 2), {
    mode: 0o600,
  });
  await server.close();
  runtime.close();
}
if (!completed) process.exitCode = 1;
