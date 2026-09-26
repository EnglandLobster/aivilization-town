import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { createOpenSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
import { loadResidentCredentials } from './credentials';
import { createOpenCodeResidentDriver } from './openCode';
import { residentReport, verifyResidentChain } from './report';
import { startResidentServer, record } from './server';
import { cityAppsVerificationTask, verifyCityAppsChain } from './cityAppsVerification';
import { distributionVerificationTask, verifyDistributionChain } from './distributionVerification';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string', default: '.local/open-residents' },
    count: { type: 'string', default: '3' },
    initialization: { type: 'string', default: 'settled' },
    legacy: { type: 'boolean', default: false },
    port: { type: 'string', default: '4320' },
    model: { type: 'string', default: 'opencode-go/deepseek-v4.1-flash' },
    turns: { type: 'string', default: '4' },
    mode: { type: 'string', default: 'free' },
    actor: { type: 'string' },
    args: { type: 'string', default: '{}' },
    delta: { type: 'string', default: '300000' },
    timeout: { type: 'string', default: '180000' },
    opencode: { type: 'string', default: 'opencode' },
    help: { type: 'boolean' },
  },
});
const root = resolve(values.root);
function integer(value: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`Expected integer in [${minimum}, ${maximum}]`);
  return parsed;
}
function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
const HELP = `Open Agent Society — one authoritative experimental town
  init    --root DIR --count 3 --initialization settled|newcomers [--legacy]
  serve   --root DIR --port 4320       (observer and authenticated API)
  run     --root DIR --turns 4 --mode free|verification|apps-verification|distribution-verification --model PROVIDER/MODEL
  call CAPABILITY --root DIR --actor ID --args '{...}'
  advance --root DIR --delta MILLISECONDS
  report  --root DIR
  verify  --root DIR                  (reevaluate durable chain evidence without calling a model)
  enable-life --root DIR             (enable groups, agreements, commerce, services and life)
  enable-distribution --root DIR     (enable subscriptions/feed without backfilling old posts)
  install-apps --root DIR             (install original-text city app directories in an existing town)
All commands except init open an existing town. Stop serve before using another writer command.
Credentials live in DIR/credentials.json; never put them into prompts or URLs.
run saves report.json, report.md, and per-resident OpenCode execution evidence.
`;

function verificationTask(runtime: OpenSocietyRuntime, actorId: string): string {
  const prior = Object.values(runtime.state.turns).filter(
    (turn) => turn.actorId === actorId && turn.status !== 'running',
  );
  if (prior.length > 0)
    return '链路验收模式（不是自然涌现研究）：这是再次唤醒。请查询实际地点/活动，检索自己的经历和认知，读取收到的消息或已知公共文档，依据真实证据更新一条自己的认知，并向另一位居民发送简短真实反馈。可继续自己想做的事，最后使用等待工具交接。不得声称没有工具证据的结果。';
  const others = runtime.manifest.residents
    .filter((identity) => identity.id !== actorId)
    .map((identity) => identity.id);
  return `链路验收模式（不是自然涌现研究）：请用真实工具验证完整链路。先自主发现所需能力并观察世界；检索个人经历；创建一条自己的目标或认识；查询已有公共信息空间，若没有合适空间可创建允许大家投稿的公共空间，并写一篇你自己的文档（内容由你决定）；通过消息告知一位居民 ${others.join(' / ')} 这份文档的位置；发起前往一个可达地点的真实移动并确认工具返回的行程状态；最后使用等待工具等待到达并留下摘要。已有消息可阅读、回应。具体想法、地点和文字由你决定。动作失败时根据实际错误修正，不伪造成功。`;
}

async function main() {
  const command = positionals[0];
  if (values.help || command === undefined) {
    process.stdout.write(HELP);
    return;
  }
  if (
    ![
      'init',
      'serve',
      'run',
      'call',
      'advance',
      'report',
      'verify',
      'install-apps',
      'enable-distribution',
      'enable-life',
    ].includes(command)
  )
    throw new Error('unknown-command');
  if (
    !['free', 'verification', 'apps-verification', 'distribution-verification'].includes(
      values.mode,
    )
  )
    throw new Error('invalid-mode');
  if (!['settled', 'newcomers'].includes(values.initialization))
    throw new Error('invalid-initialization');
  const runtime = new OpenSocietyRuntime(
    root,
    command === 'init'
      ? createOpenSocietyManifest({
          count: integer(values.count, 1, 50),
          continuity: !values.legacy,
          initialization: values.initialization as 'settled' | 'newcomers',
        })
      : undefined,
  );
  try {
    const credentials = loadResidentCredentials(
      root,
      runtime.manifest.residents.map((resident) => resident.id),
    );
    if (command === 'init') {
      print({
        root,
        residents: runtime.manifest.residents.map((resident) => resident.id),
        schema: runtime.manifest.schemaVersion,
      });
      return;
    }
    if (command === 'enable-life') {
      print(runtime.enableLife());
      return;
    }
    if (command === 'enable-distribution') {
      print(runtime.enableDistribution());
      return;
    }
    if (command === 'install-apps') {
      print(runtime.installCityApps());
      return;
    }
    if (command === 'serve') {
      const server = await startResidentServer(
        runtime,
        credentials,
        integer(values.port, 0, 65535),
      );
      print({ observer: server.url, credentialsFile: join(root, 'credentials.json') });
      await new Promise<void>((done) => {
        process.once('SIGINT', done);
        process.once('SIGTERM', done);
      });
      await server.close();
      return;
    }
    if (command === 'report') {
      print(residentReport(runtime));
      return;
    }
    if (command === 'verify') {
      const verification =
        values.mode === 'distribution-verification'
          ? verifyDistributionChain(runtime)
          : values.mode === 'apps-verification'
            ? verifyCityAppsChain(runtime)
            : verifyResidentChain(runtime);
      writeFileSync(join(root, 'verification.json'), JSON.stringify(verification, null, 2), {
        mode: 0o600,
      });
      print(verification);
      if (!verification.passed) process.exitCode = 1;
      return;
    }
    if (command === 'advance') {
      const result = runtime.advanceTime(integer(values.delta, 1, 86_400_000), randomUUID());
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'call') {
      if (values.actor === undefined || positionals[1] === undefined)
        throw new Error('actor-and-capability-required');
      runtime.beginTurn(values.actor, 'manual-cli');
      const result = runtime.invoke(values.actor, {
        name: positionals[1],
        arguments: record(JSON.parse(values.args) as unknown),
        requestId: randomUUID(),
      });
      runtime.finishTurn(values.actor, { summary: 'Manual CLI opportunity.' });
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const server = await startResidentServer(runtime, credentials);
    try {
      const turnCount = integer(values.turns, 1, 1000);
      const timeout = integer(values.timeout, 1000, 600_000);
      for (let index = 0; index < turnCount; index++) {
        let actorId = runtime.nextResident();
        // This mode is an explicitly ordered integration scenario, not free scheduling.
        // Honor the selected resident's wake time; a short wait by another resident
        // must not starve the publisher/reader stages of this bounded acceptance run.
        if (values.mode === 'distribution-verification') {
          actorId = runtime.manifest.residents[index % 3]?.id;
          if (actorId === undefined || runtime.state.distribution === undefined)
            throw new Error('distribution-verification-needs-three-residents-and-enabled-feature');
          const delay =
            runtime.state.residents[actorId]!.nextWakeAt - runtime.state.world.clock.now;
          if (delay > 86_400_000) throw new Error('verification-wake-exceeds-one-day');
          if (delay > 0) {
            const advanced = runtime.advanceTime(delay, randomUUID());
            if (!advanced.ok) throw new Error(advanced.error);
          }
        }
        if (actorId === undefined) {
          const nextWake = Math.min(
            ...Object.values(runtime.state.residents).map((resident) => resident.nextWakeAt),
            ...Object.values(runtime.state.reminders)
              .filter((reminder) => !reminder.done)
              .map((reminder) => reminder.at),
            ...Object.values(runtime.state.world.activityTimeByAgent)
              .filter((activity) => activity.availableAt > runtime.state.world.clock.now)
              .map((activity) => activity.availableAt),
          );
          const result = runtime.advanceTime(
            Math.min(86_400_000, Math.max(1, nextWake - runtime.state.world.clock.now)),
            randomUUID(),
          );
          if (!result.ok) throw new Error(result.error);
          actorId = runtime.nextResident();
          if (actorId === undefined) {
            index--;
            continue;
          }
        }
        const previous = Object.values(runtime.state.turns)
          .filter((turn) => turn.actorId === actorId && turn.sessionId !== undefined)
          .at(-1);
        const turn = runtime.beginTurn(actorId);
        const driver = createOpenCodeResidentDriver({
          connection: { endpoint: server.url, token: credentials.residents[actorId]! },
          model: values.model,
          directory: join(root, 'opencode', actorId),
          executable: values.opencode,
          ...(previous?.sessionId === undefined ? {} : { sessionId: previous.sessionId }),
          ...(values.mode === 'verification' ? { task: verificationTask(runtime, actorId) } : {}),
          ...(values.mode === 'distribution-verification'
            ? { task: distributionVerificationTask(runtime, actorId) }
            : {}),
          ...(values.mode === 'apps-verification'
            ? { task: cityAppsVerificationTask(runtime, actorId) }
            : {}),
        });
        print({
          opportunity: index + 1,
          actorId,
          turnId: turn.id,
          model: values.model,
          mode: values.mode,
          simulationTime: runtime.state.world.clock.now,
          status: 'running',
        });
        try {
          const result = await driver.run({
            actorId,
            turnId: turn.id,
            context: runtime.context(actorId),
            signal: AbortSignal.timeout(timeout),
            invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
          });
          const finished = runtime.finishTurn(actorId, result);
          print({
            actorId,
            turnId: finished.id,
            calls: finished.calls,
            status: result.status,
            summary: result.summary,
          });
          let cadence = runtime.manifest.policy.opportunityCadenceMs ?? 1000;
          // Verification explicitly advances to a pending arrival after each population round.
          // This is test orchestration, not a hidden instruction or citizen decision.
          if (
            values.mode === 'verification' &&
            (index + 1) % runtime.manifest.residents.length === 0
          ) {
            const arrivals = Object.values(runtime.state.world.activityTimeByAgent)
              .map((activity) => activity.availableAt)
              .filter((at) => at > runtime.state.world.clock.now);
            if (arrivals.length > 0)
              cadence = Math.max(cadence, Math.min(...arrivals) - runtime.state.world.clock.now);
          }
          const timeResult = runtime.advanceTime(Math.min(cadence, 86_400_000), randomUUID());
          if (!timeResult.ok) throw new Error(timeResult.error);
          if (result.status === 'provider-error') {
            process.exitCode = 1;
            break;
          }
        } catch (error) {
          if (!runtime.journal.lookup(actorId, `${turn.id}-finished`))
            runtime.finishTurn(actorId, {
              status: 'provider-error',
              summary: error instanceof Error ? error.message : 'driver-failed',
            });
          throw error;
        }
      }
    } finally {
      await server.close();
      mkdirSync(root, { recursive: true, mode: 0o700 });
      const report = residentReport(runtime);
      if (
        values.mode === 'verification' ||
        values.mode === 'apps-verification' ||
        values.mode === 'distribution-verification'
      ) {
        const verification =
          values.mode === 'verification'
            ? verifyResidentChain(runtime)
            : values.mode === 'distribution-verification'
              ? verifyDistributionChain(runtime)
              : verifyCityAppsChain(runtime);
        writeFileSync(join(root, 'verification.json'), JSON.stringify(verification, null, 2), {
          mode: 0o600,
        });
        print(verification);
        if (!verification.passed) process.exitCode = 1;
      }
      writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
      writeFileSync(
        join(root, 'report.md'),
        `# Resident experiment\n\nMode: ${values.mode}\n\nModel: ${values.model}\n\nSimulation time: ${report.simulationTime}\n\nJournal commits: ${report.revision}\n\n` +
          report.turns
            .map(
              (turn) =>
                `## ${turn.actorId} / ${turn.id}\n\n${turn.status}; ${turn.calls} capability calls.\n\n${turn.summary}\n`,
            )
            .join('\n') +
          '\nDetailed authority evidence: report.json and journal.jsonl. Provider evidence: opencode/<resident>/<turn>.json. Verification mode is prompted integration testing, not evidence of spontaneous emergence.\n',
        { mode: 0o600 },
      );
      print({
        report: join(root, 'report.json'),
        observerCommand: `pnpm residents serve --root ${root}`,
      });
    }
  } finally {
    runtime.close();
  }
}
main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'resident-command-failed'}\n`);
  process.exitCode = 1;
});
