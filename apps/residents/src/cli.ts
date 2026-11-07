import { resolveResidentListener } from './residentListener';
import { runResidentPartitionWorker } from './partitionWorker';
import { runResidentPartitionOpportunity } from './partitionRunner';
import type { ResidentPartitionConfiguration } from './partitionExecution';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createTownManifest,
  isTownProfile,
  OpenSocietyRuntime,
  recoverOpenSocietyJournal,
  createSocietyMetrics,
} from '@aivilization/worker';
import type { OpenSocietyCommit, OpenSocietyManifest } from '@aivilization/worker';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { loadResidentCredentials } from './credentials';
import { syncSocietyReplica } from './replica';
import { createOpenCodeResidentDriver } from './openCode';
import { residentReport, verifyResidentChain } from './report';
import { startResidentServer, record } from './server';
import { cityAppsVerificationTask, verifyCityAppsChain } from './cityAppsVerification';
import { parseExperiment, runExperiment } from './experiment';
import { preflightOpenCode } from './openCodeExecutable';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string', default: '.local/open-residents' },
    count: { type: 'string', default: '3' },
    initialization: { type: 'string', default: 'settled' },
    profile: { type: 'string' },
    source: { type: 'string' },
    'material-endowment': { type: 'string' },
    'partition-config': { type: 'string' },
    'source-credentials': { type: 'string' },
    pages: { type: 'string', default: '16' },
    'claim-id': { type: 'string' },
    'max-opportunities': { type: 'string' },
    'poll-ms': { type: 'string', default: '1000' },
    port: { type: 'string', default: '4320' },
    host: { type: 'string' },
    'advertise-host': { type: 'string' },
    'tls-key': { type: 'string' },
    'tls-cert': { type: 'string' },
    model: { type: 'string', default: 'opencode-go/deepseek-v4.1-flash' },
    turns: { type: 'string', default: '4' },
    'target-opportunities': { type: 'string' },
    'max-outage-minutes': { type: 'string', default: '180' },
    'outage-backoff-ms': { type: 'string', default: '60000' },
    concurrency: { type: 'string', default: '1' },
    mode: { type: 'string', default: 'free' },
    actor: { type: 'string' },
    args: { type: 'string', default: '{}' },
    delta: { type: 'string', default: '300000' },
    timeout: { type: 'string', default: '180000' },
    // Default: the OpenCode release pinned by this package (see openCodeExecutable.ts).
    opencode: { type: 'string' },
    file: { type: 'string' },
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
  init    --root DIR --count 3 --initialization settled|newcomers [--profile town-v1 (default) | town-interdependent-v1]
  serve   --root DIR --port 4320 [--partition-config FILE] [--host HOST --advertise-host NAME --tls-key FILE --tls-cert FILE] (observer and authenticated API)
  run     --root DIR --turns 4 --mode free|verification|apps-verification --model PROVIDER/MODEL [--concurrency N (free mode: residents due at the same simulated time act in parallel)]
          free mode: [--target-opportunities N (run until the town has N opportunities in which a resident acted; resumable)]
          free mode: a provider failure before any call hands the opportunity back and is retried after a wait
          (--outage-backoff-ms 60000, doubling up to 15 minutes); gives up after --max-outage-minutes 180
  call CAPABILITY --root DIR --actor ID --args '{...}'
  advance --root DIR --delta MILLISECONDS
  partition-daemon --root COMPUTE_DIR --source URL --source-credentials FILE [--max-opportunities N] [--poll-ms 1000]
  partition-run --root COMPUTE_DIR --source URL --source-credentials FILE [--claim-id ID] (one autonomous assigned opportunity)
  replicate --root REPLICA_DIR --source URL --source-credentials FILE [--pages 16] (trusted operator only)
  recover-journal --root DIR          (offline explicit tail recovery, preserves original bytes)
  report  --root DIR
  metrics --root DIR                  (read-only emergence metrics from the journal; safe while a town runs)
  experiment --file FILE              (open-society-experiment-v1: init/check arms, pin settings, run all arms to the target)
  verify  --root DIR                  (reevaluate durable chain evidence without calling a model)
  register-construction-site --root DIR --args JSON (explicit operator geometry migration with sourceId)
init creates a town; replicate creates or resumes a read replica. Other commands open an existing town. Stop serve before using another writer command.
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

/** Opportunities in which a resident actually acted: finished turns that were not handed back. */
function actedOpportunities(runtime: OpenSocietyRuntime): number {
  return Object.values(runtime.state.turns).filter(
    (turn) => turn.status !== 'running' && !turn.requeued,
  ).length;
}

/**
 * Free-mode scheduling with simultaneity: every resident due at the current simulated time (up to
 * `concurrency`) acts in parallel; each capability call still commits atomically in arrival order.
 * The clock advances only after the whole round has finished, so no decision races time.
 *
 * Provider outages: a turn that fails before the resident made any call is handed back (the
 * resident keeps their wake time and reason) and retried. When every turn in a round failed that
 * way, the run waits in wall-clock time with exponential backoff; the retried round is the probe.
 * It gives up once the outage has lasted longer than `maxOutageMs`.
 */
async function runConcurrentRounds(input: {
  readonly runtime: OpenSocietyRuntime;
  readonly endpoint: string;
  readonly tokens: Readonly<Record<string, string>>;
  /** Turns to start in this invocation, or a town-wide target of acted opportunities. */
  readonly limit: { readonly turns: number } | { readonly targetOpportunities: number };
  readonly timeout: number;
  readonly concurrency: number;
  readonly backoffBaseMs: number;
  readonly maxOutageMs: number;
}) {
  const { runtime } = input;
  const everyone = runtime.manifest.residents.map((resident) => resident.id);
  let started = 0;
  let outageSince: number | undefined;
  let failedRounds = 0;
  const remaining = () =>
    'turns' in input.limit
      ? input.limit.turns - started
      : input.limit.targetOpportunities - actedOpportunities(runtime);
  while (remaining() > 0) {
    const due: string[] = [];
    while (due.length < input.concurrency && due.length < remaining()) {
      const next = runtime.nextResident(new Set(everyone.filter((id) => !due.includes(id))));
      if (next === undefined) break;
      due.push(next);
    }
    if (!due.length) {
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
      continue;
    }
    const round = due.map((actorId) => {
      const previous = Object.values(runtime.state.turns)
        .filter((turn) => turn.actorId === actorId && turn.sessionId !== undefined)
        .at(-1);
      const turn = runtime.beginTurn(actorId);
      const driver = createOpenCodeResidentDriver({
        connection: { endpoint: input.endpoint, token: input.tokens[actorId]! },
        model: values.model,
        directory: join(root, 'opencode', actorId),
        ...(values.opencode === undefined ? {} : { executable: values.opencode }),
        ...(previous?.sessionId === undefined ? {} : { sessionId: previous.sessionId }),
      });
      print({
        opportunity: ++started,
        actorId,
        turnId: turn.id,
        model: values.model,
        mode: values.mode,
        concurrency: input.concurrency,
        simulationTime: runtime.state.world.clock.now,
        status: 'running',
      });
      return { actorId, turn, driver, context: runtime.context(actorId) };
    });
    const results = await Promise.all(
      round.map(async ({ actorId, turn, driver, context }) => {
        let result: Awaited<ReturnType<typeof driver.run>>;
        try {
          result = await driver.run({
            actorId,
            turnId: turn.id,
            context,
            signal: AbortSignal.timeout(input.timeout),
            invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
          });
        } catch (error) {
          result = {
            status: 'provider-error',
            summary: error instanceof Error ? error.message : 'driver-failed',
          };
        }
        const finished = runtime.finishTurn(actorId, {
          ...result,
          ...(result.status === 'provider-error' ? { requeue: true as const } : {}),
        });
        print({
          actorId,
          turnId: finished.id,
          calls: finished.calls,
          status: result.status,
          ...(finished.requeued ? { requeued: true } : {}),
          summary: result.summary,
        });
        return finished;
      }),
    );
    const cadence = runtime.manifest.policy.opportunityCadenceMs ?? 1000;
    const timeResult = runtime.advanceTime(Math.min(cadence, 86_400_000), randomUUID());
    if (!timeResult.ok) throw new Error(timeResult.error);
    if (!results.every((turn) => turn.requeued)) {
      outageSince = undefined;
      failedRounds = 0;
      continue;
    }
    // Nobody could act this round: the provider is down. Wait, then retry the same opportunities.
    outageSince ??= Date.now();
    if (Date.now() - outageSince >= input.maxOutageMs) {
      print({ status: 'provider-outage', since: new Date(outageSince).toISOString() });
      process.exitCode = 1;
      return;
    }
    const waitMs = Math.min(input.backoffBaseMs * 2 ** failedRounds++, 900_000);
    print({ status: 'provider-unavailable', retryInMs: waitMs, failedRounds });
    await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
  }
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
      'experiment',
      'call',
      'advance',
      'report',
      'metrics',
      'recover-journal',
      'replicate',
      'partition-run',
      'partition-daemon',
      'verify',
      'register-construction-site',
    ].includes(command)
  )
    throw new Error('unknown-command');
  if (!['free', 'verification', 'apps-verification'].includes(values.mode))
    throw new Error('invalid-mode');
  if (!['settled', 'newcomers'].includes(values.initialization))
    throw new Error('invalid-initialization');
  if (values.profile !== undefined && (command !== 'init' || !isTownProfile(values.profile)))
    throw new Error('invalid-or-conflicting-initialization-profile');
  if (
    (values.host || values['advertise-host'] || values['tls-key'] || values['tls-cert']) &&
    command !== 'serve'
  )
    throw Error('listener-options-require-serve');
  if (!!values['tls-key'] !== !!values['tls-cert']) throw Error('tls-key-and-cert-required');
  const listenerOptions = {
    ...(values.host ? { host: values.host } : {}),
    ...(values['advertise-host'] ? { advertiseHost: values['advertise-host'] } : {}),
    ...(values['tls-key'] && values['tls-cert']
      ? {
          tls: {
            key: readFileSync(resolve(values['tls-key'])),
            cert: readFileSync(resolve(values['tls-cert'])),
          },
        }
      : {}),
  };
  if (command === 'serve') resolveResidentListener(listenerOptions);
  if (values['partition-config'] && command !== 'serve')
    throw Error('partition-config-requires-serve');
  if (command === 'partition-run' || command === 'partition-daemon') {
    if (!values.source || !values['source-credentials']) throw Error('partition-source-required');
    const credentials = record(
      JSON.parse(readFileSync(resolve(values['source-credentials']), 'utf8')),
    );
    if (typeof credentials.partitionToken !== 'string' || !credentials.partitionToken)
      throw Error('invalid-partition-credentials');
    const controller = new AbortController();
    const stop = () => controller.abort('partition-worker-stopped');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const options = {
        connection: { endpoint: values.source, token: credentials.partitionToken },
        directory: root,
        model: values.model,
        signal: controller.signal,
        timeoutMs: integer(values.timeout, 1000, 600000),
      };
      const result =
        command === 'partition-run'
          ? await runResidentPartitionOpportunity({
              ...options,
              claimId: values['claim-id'] ?? randomUUID(),
            })
          : await runResidentPartitionWorker({
              ...options,
              pollMs: integer(values['poll-ms'], 100, 60000),
              ...(values['max-opportunities']
                ? { maxOpportunities: integer(values['max-opportunities'], 1, 1000000) }
                : {}),
              onProgress: print,
            });
      print(result);
      if (result.status === 'provider-error') process.exitCode = 1;
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
    return;
  }
  if (command === 'replicate') {
    if (!values.source || !values['source-credentials']) throw Error('replication-source-required');
    const credentials = record(
      JSON.parse(readFileSync(resolve(values['source-credentials']), 'utf8')),
    );
    if (typeof credentials.admin !== 'string' || !credentials.admin)
      throw Error('invalid-source-credentials');
    print(
      await syncSocietyReplica({
        root,
        endpoint: values.source,
        token: credentials.admin,
        maxPages: integer(values.pages, 1, 1024),
      }),
    );
    return;
  }
  if (command === 'recover-journal') {
    print(recoverOpenSocietyJournal(root));
    return;
  }
  if (command === 'experiment') {
    if (values.file === undefined) throw new Error('experiment-file-required');
    const definition = parseExperiment(
      JSON.parse(readFileSync(resolve(values.file), 'utf8')) as unknown,
    );
    const results = await runExperiment(definition, resolve(process.argv[1]!), print);
    print({ experiment: definition.name, results });
    if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
    return;
  }
  if (command === 'metrics') {
    // Reads committed lines only; takes no writer lock and never changes the town.
    const manifest = JSON.parse(
      readFileSync(join(root, 'manifest.json'), 'utf8'),
    ) as OpenSocietyManifest;
    const metrics = createSocietyMetrics(manifest);
    const lines = createInterface({ input: createReadStream(join(root, 'journal.jsonl')) });
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        metrics.add(JSON.parse(line) as OpenSocietyCommit);
      } catch {
        break; // An incomplete tail written by a live writer is not yet a fact.
      }
    }
    print(metrics.result());
    return;
  }
  const runtime = new OpenSocietyRuntime(
    root,
    command === 'init'
      ? createTownManifest({
          ...(isTownProfile(values.profile) ? { profile: values.profile } : {}),
          count: integer(values.count, 1, 50),
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
        profile: runtime.manifest.provenance.runProfile ?? null,
      });
      return;
    }
    if (command === 'register-construction-site') {
      const site = record(JSON.parse(values.args));
      if (
        Object.keys(site).sort().join(',') !==
          'accessTravelMs,id,parentLocationId,sourceId,usableFloorArea' ||
        typeof site.id !== 'string' ||
        typeof site.parentLocationId !== 'string' ||
        typeof site.sourceId !== 'string' ||
        typeof site.usableFloorArea !== 'number' ||
        typeof site.accessTravelMs !== 'number'
      )
        throw Error('invalid-construction-site-extension');
      print(
        runtime.registerConstructionSite({
          id: site.id,
          parentLocationId: site.parentLocationId,
          sourceId: site.sourceId,
          usableFloorArea: site.usableFloorArea,
          accessTravelMs: site.accessTravelMs,
        }),
      );
      return;
    }
    if (command === 'serve') {
      const server = await startResidentServer(
        runtime,
        credentials,
        integer(values.port, 0, 65535),
        {
          ...listenerOptions,
          ...(values['partition-config']
            ? {
                partitions: JSON.parse(
                  readFileSync(resolve(values['partition-config']), 'utf8'),
                ) as ResidentPartitionConfiguration,
              }
            : {}),
        },
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
        values.mode === 'apps-verification'
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
    // Refuse an incompatible driver before taking anyone's opportunity.
    print({ opencode: preflightOpenCode(values.opencode) });
    const server = await startResidentServer(runtime, credentials);
    try {
      const turnCount = integer(values.turns, 1, 1000);
      const timeout = integer(values.timeout, 1000, 600_000);
      const concurrency = integer(values.concurrency, 1, 32);
      if (concurrency > 1 && values.mode !== 'free')
        throw new Error('concurrency-is-only-for-free-mode');
      if (values['target-opportunities'] !== undefined && values.mode !== 'free')
        throw new Error('target-opportunities-is-only-for-free-mode');
      if (values.mode === 'free') {
        await runConcurrentRounds({
          runtime,
          endpoint: server.url,
          tokens: credentials.residents,
          limit:
            values['target-opportunities'] === undefined
              ? { turns: turnCount }
              : {
                  targetOpportunities: integer(values['target-opportunities'], 1, 1_000_000),
                },
          timeout,
          concurrency,
          backoffBaseMs: integer(values['outage-backoff-ms'], 1, 900_000),
          maxOutageMs: integer(values['max-outage-minutes'], 0, 10_080) * 60_000,
        });
      }
      // Verification modes keep their explicitly ordered sequential orchestration.
      for (let index = 0; values.mode !== 'free' && index < turnCount; index++) {
        let actorId = runtime.nextResident();
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
          ...(values.opencode === undefined ? {} : { executable: values.opencode }),
          ...(previous?.sessionId === undefined ? {} : { sessionId: previous.sessionId }),
          ...(values.mode === 'verification' ? { task: verificationTask(runtime, actorId) } : {}),
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
      if (values.mode === 'verification' || values.mode === 'apps-verification') {
        const verification =
          values.mode === 'verification'
            ? verifyResidentChain(runtime)
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
