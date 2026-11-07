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
  activateSocietyFoundations,
  activateSocietyServices,
  activateIndependentSocietyServices,
  activateSocietyBodyLearning,
  activateSocietyLivelihoods,
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
import { distributionVerificationTask, verifyDistributionChain } from './distributionVerification';
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
  run     --root DIR --turns 4 --mode free|verification|apps-verification|distribution-verification --model PROVIDER/MODEL [--concurrency N (free mode: residents due at the same simulated time act in parallel)]
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
  enable-society-foundations --root DIR (explicitly enable empty social/resource foundations; no new assets)
  enable-independent-society-services --root DIR (service phase without granting public authority)
  enable-society-livelihoods --root DIR (actual service and productive payroll; requires explicit body/material/labor setup)
  enable-society-body-learning --root DIR (actual sleep and learning; preserves legacy prepaid obligations)
  enable-society-services --root DIR (explicit provider/control/supply phase after legacy service drain)
  upgrade-service-providers --root DIR (drain legacy services, then enable real provider rules)
  enable-life --root DIR             (enable groups, agreements, commerce, services and life)
  enable-society-kernel --root DIR   (enable shared records and exact authorized procedures)
  register-construction-site --root DIR --args JSON (explicit operator geometry migration with sourceId)
  enable-facility-use --root DIR (explicit capacity preflight for existing construction worlds)
  register-service-facilities --root DIR --args JSON (explicit new finite facilities with sourceId; no providers or consent)
  enable-service-engagements --root DIR (enable real service contracts; no assets silently added)
  enable-premises-rights --root DIR (explicit named space permissions; creates no leases or consent)
  enable-paid-permits --root DIR (explicit v2 price/permission atomic settlement; preserves old rights)
  enable-evidence-trade --root DIR (explicit actual-fulfillment orders; preserves old orders and assets)
  enable-collective-freight-custody --root DIR (explicit exact collective consent; personal acceptance still required)
  enable-freight-custody --root DIR (explicit personal stationary handoff; preserves original freight payment)
  enable-logistics --root DIR (explicit real-cargo/load upgrade; wait for old travel, invents no vehicle assets)
  enable-premises --root DIR (enable construction without inventing sites in old worlds)
  enable-materials --root DIR (enable real stock custody and elapsed production)
  enable-group-control --root DIR (enable independent group control and handovers)
  enable-resource-control --root DIR (enable exact resource control and handovers)
  enable-program-reactions --root DIR (enable bounded durable event reactions)
  enable-program-conditions --root DIR (enable bounded conditional procedures)
  enable-enterprise-programs --root DIR (enable v3 paid management exchanges, preserving v2 contracts)
  enable-program-actions --root DIR (enable explicitly mandated atomic resource exchanges)
  enable-service-control --root DIR (enable directory administration transfer without transferring attendance)
  enable-elapsed-rest --root DIR (explicitly enable sleep recovery over actual time; no active prepaid activities)
  enable-elapsed-study --root DIR (explicit actual learning and tuition; requires elapsed-rest and no prepaid activity)
  enable-agreed-labor --root DIR (actual labor priced only by independently accepted enterprise terms)
  enable-elapsed-labor --root DIR (explicit enterprise labor and personal earned wages; requires elapsed-rest, no prepaid activity)
  enable-public-labor --root DIR (explicit prefunded initial public wages over actual time; requires treasury and actual body time)
  enable-service-employment --root DIR (explicit service accounts and actual wages; requires service-time, elapsed-labor and no funded legacy services)
  enable-service-time --root DIR (explicit simultaneous service/body effects; requires elapsed-rest and no active service)
  enable-education-authority --root DIR (explicit formal qualifications; preserves legacy effective grades without inventing exams)
  enable-productive-employment --root DIR (explicit production/body/payroll composition; requires elapsed-labor and no active material participation)
  enable-public-housing --root DIR (explicit amendable initial housing tariff; preserve past debt and remove forced standard changes)
  enable-service-principals --root DIR (explicit service directory control and named supply permissions)
  enable-service-supply --root DIR (explicit organizational creation and reopening; requires service principals)
  enable-service-affiliations --root DIR (independent enterprise consent for exact service control; requires service supply)
  enable-service-supply-relations --root DIR (future supply invitation/end, preserving original source; requires affiliations)
  enable-vehicle-principals --root DIR (explicit vehicle control and named driver permissions)
  enable-resource-adapters --root DIR --args '["stock","premises","vehicle"]' (only existing requested resources; no public grant)
  enable-resource-sales-v2 --root DIR (explicit stock/vehicle prices; earlier public approvals keep their original scope)
  enable-service-closure --root DIR (require authoritative service obligations before enterprise closure)
  enable-periodic-access --root DIR (private periodic agreements; no public grant or assets)
  enable-periodic-obligations --root DIR (legacy periodic agreements plus explicit public grant)
  enable-resource-sales --root DIR (explicit atomic paid resource acquisition and distinct public fiscal/control grant)
  enable-construction-trade --root DIR (explicit construction orders and public procurement authority)
  enable-principal-trade --root DIR (explicit organization fee accounts and atomic paid consent)
  enable-principal-permits --root DIR (explicitly enable exact organization use contracts)
  enable-premises-principals --root DIR (explicitly enable enterprise/public construction and premises administration)
  enable-resource-principals --root DIR (enable versioned personal/collective/enterprise/public stock custody and exact administrative actions)
  enable-physical-housing-rest --root DIR (enable actual-location structural rest effects; preserve rights, contracts and service caps)
  enable-housing-occupancy --root DIR (enable personal residence facts and departure; preserve contracts and physical location)
  enable-housing-choice --root DIR (enable personal lower service-standard choices; preserve existing housing and debts)
  enable-capital-agreements --root DIR (enable explicit real capital contracts; company books remain opt-in)
  enable-public-employment --root DIR (explicit next-cycle amendable public admission; preserves inherited initial terms)
  enable-public-governance --root DIR (explicit scenario grant for resident public fiscal procedure)
  enable-physical-production --root DIR [--material-endowment JSON_FILE] (finite material sources and elapsed production; disables old instant production)
  enable-public-goods-procurement --root DIR (explicit freight procurement for named private/collective recipients)
  enable-public-procurement --root DIR (explicit treasury service procurement; replaces abstract budget allocations)
  enable-common-accounts --root DIR (enable real collectively controlled accounts)
  enable-collectives --root DIR    (enable resident charters and collective decisions)
  enable-record-views --root DIR    (enable resident computations over shared records)
  enable-distribution --root DIR     (enable subscriptions/feed without backfilling old posts)
  install-apps --root DIR             (install original-text city app directories in an existing town)
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
      'install-apps',
      'enable-distribution',
      'enable-life',
      'upgrade-service-providers',
      'enable-society-services',
      'enable-society-body-learning',
      'enable-society-livelihoods',
      'enable-independent-society-services',
      'enable-society-foundations',
      'enable-society-kernel',
      'enable-record-views',
      'enable-collectives',
      'enable-common-accounts',
      'enable-program-conditions',
      'enable-program-actions',
      'enable-enterprise-programs',
      'enable-service-control',
      'enable-elapsed-rest',
      'enable-elapsed-study',
      'enable-elapsed-labor',
      'enable-agreed-labor',
      'enable-service-time',
      'enable-public-labor',
      'enable-service-employment',
      'enable-education-authority',
      'enable-productive-employment',
      'enable-capital-agreements',
      'enable-public-housing',
      'enable-physical-housing-rest',
      'enable-housing-occupancy',
      'enable-resource-principals',
      'enable-premises-principals',
      'enable-principal-permits',
      'enable-service-principals',
      'enable-service-supply',
      'enable-service-affiliations',
      'enable-service-supply-relations',
      'enable-vehicle-principals',
      'enable-resource-sales',
      'enable-resource-sales-v2',
      'enable-resource-adapters',
      'enable-periodic-obligations',
      'enable-service-closure',
      'enable-periodic-access',
      'enable-principal-trade',
      'enable-construction-trade',
      'enable-housing-choice',
      'enable-public-employment',
      'enable-public-governance',
      'enable-public-procurement',
      'enable-public-goods-procurement',
      'enable-physical-production',
      'enable-program-reactions',
      'enable-resource-control',
      'enable-group-control',
      'enable-materials',
      'enable-premises',
      'enable-service-engagements',
      'register-service-facilities',
      'enable-logistics',
      'enable-freight-custody',
      'enable-collective-freight-custody',
      'enable-evidence-trade',
      'enable-paid-permits',
      'enable-premises-rights',
      'enable-facility-use',
      'register-construction-site',
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
    if (command === 'enable-society-foundations') {
      const result = activateSocietyFoundations(runtime);
      print(result);
      if (result.status === 'blocked') process.exitCode = 1;
      return;
    }
    if (command === 'enable-society-livelihoods') {
      const result = activateSocietyLivelihoods(runtime);
      print(result);
      if (result.status !== 'enabled') process.exitCode = 1;
      return;
    }
    if (command === 'enable-society-body-learning') {
      const result = activateSocietyBodyLearning(runtime);
      print(result);
      if (result.status !== 'enabled') process.exitCode = 1;
      return;
    }
    if (
      command === 'enable-society-services' ||
      command === 'enable-independent-society-services'
    ) {
      const result =
        command === 'enable-independent-society-services'
          ? activateIndependentSocietyServices(runtime)
          : activateSocietyServices(runtime);
      print(result);
      if (result.status === 'blocked') process.exitCode = 1;
      return;
    }
    if (command === 'upgrade-service-providers') {
      const result = runtime.upgradeServiceProviders();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-life') {
      print(runtime.enableLife());
      return;
    }
    if (command === 'enable-society-kernel') {
      print(runtime.enableSocietyKernel());
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
    if (command === 'enable-facility-use') {
      print(runtime.enableFacilityUse());
      return;
    }
    if (command === 'register-service-facilities') {
      const result = runtime.registerServiceFacilities(JSON.parse(values.args));
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-service-engagements') {
      print(runtime.enableServiceEngagements());
      return;
    }
    if (command === 'enable-evidence-trade') {
      print(runtime.enableEvidenceTrade());
      return;
    }
    if (command === 'enable-paid-permits') {
      print(runtime.enablePaidPermits());
      return;
    }
    if (command === 'enable-premises-rights') {
      const result = runtime.enablePremisesRights();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-collective-freight-custody') {
      const result = runtime.enableCollectiveFreightCustody();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-freight-custody') {
      const result = runtime.enableFreightCustody();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-logistics') {
      print(runtime.enableLogistics());
      return;
    }
    if (command === 'enable-premises') {
      print(runtime.enablePremises());
      return;
    }
    if (command === 'enable-materials') {
      print(runtime.enableMaterials());
      return;
    }
    if (command === 'enable-group-control') {
      print(runtime.enableGroupControl());
      return;
    }
    if (command === 'enable-resource-control') {
      print(runtime.enableResourceControl());
      return;
    }
    if (command === 'enable-program-reactions') {
      console.log(JSON.stringify(runtime.enableProgramReactions(), null, 2));
      return;
    }
    if (command === 'enable-program-conditions') {
      print(runtime.enableProgramConditions());
      return;
    }
    if (command === 'enable-enterprise-programs') {
      print(runtime.enableEnterprisePrograms());
      return;
    }
    if (command === 'enable-program-actions') {
      print(runtime.enableProgramActions());
      return;
    }
    if (command === 'enable-service-control') {
      print(runtime.enableServiceControl());
      return;
    }
    if (command === 'enable-elapsed-rest') {
      print(runtime.enableElapsedRest());
      return;
    }
    if (command === 'enable-agreed-labor') {
      const result = runtime.enableAgreedLabor();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-elapsed-labor') {
      const result = runtime.enableElapsedLabor();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-public-labor') {
      print(runtime.enablePublicLabor());
      return;
    }
    if (command === 'enable-service-employment') {
      const result = runtime.enableServiceEmployment();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-service-time') {
      const result = runtime.enableServiceTime();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-education-authority') {
      const result = runtime.enableEducationAuthority();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-productive-employment') {
      const result = runtime.enableProductiveEmployment();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-elapsed-study') {
      print(runtime.enableElapsedStudy());
      return;
    }
    if (command === 'enable-public-housing') {
      const result = runtime.enablePublicHousing();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-service-principals') {
      const result = runtime.enableServicePrincipals();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-service-supply') {
      const result = runtime.enableServiceSupply();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-service-affiliations') {
      const result = runtime.enableServiceAffiliations();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-service-supply-relations') {
      const result = runtime.enableServiceSupplyRelations();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-vehicle-principals') {
      const result = runtime.enableVehiclePrincipals();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-service-closure') {
      const result = runtime.enableServiceClosure();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-periodic-access') {
      const result = runtime.enablePeriodicAccess();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-periodic-obligations') {
      const result = runtime.enablePeriodicObligations();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-resource-adapters') {
      const result = runtime.enableResourceAdapters(JSON.parse(values.args));
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-resource-sales' || command === 'enable-resource-sales-v2') {
      const result =
        command === 'enable-resource-sales-v2'
          ? runtime.enableResourceSalesV2()
          : runtime.enableResourceSales();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-construction-trade') {
      const result = runtime.enableConstructionTrade();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-principal-trade') {
      const result = runtime.enablePrincipalTrade();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-principal-permits') {
      print(runtime.enablePrincipalPermits());
      return;
    }
    if (command === 'enable-premises-principals') {
      print(runtime.enablePremisesPrincipals());
      return;
    }
    if (command === 'enable-resource-principals') {
      const result = runtime.enableResourcePrincipals();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-physical-housing-rest') {
      const result = runtime.enablePhysicalHousingRest();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-housing-occupancy') {
      const result = runtime.enableHousingOccupancy();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-housing-choice') {
      const result = runtime.enableHousingChoice();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-capital-agreements') {
      const result = runtime.enableCapitalAgreements();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-public-employment') {
      const result = runtime.enablePublicEmployment();
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-public-governance') {
      print(runtime.enablePublicGovernance());
      return;
    }
    if (command === 'enable-physical-production') {
      const result = runtime.enablePhysicalProduction(
        values['material-endowment']
          ? JSON.parse(readFileSync(resolve(values['material-endowment']), 'utf8'))
          : undefined,
      );
      print(result);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (command === 'enable-public-goods-procurement') {
      print(runtime.enablePublicGoodsProcurement());
      return;
    }
    if (command === 'enable-public-procurement') {
      print(runtime.enablePublicProcurement());
      return;
    }
    if (command === 'enable-common-accounts') {
      print(runtime.enableCommonAccounts());
      return;
    }
    if (command === 'enable-collectives') {
      print(runtime.enableCollectives());
      return;
    }
    if (command === 'enable-record-views') {
      print(runtime.enableRecordViews());
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
          ...(values.opencode === undefined ? {} : { executable: values.opencode }),
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
