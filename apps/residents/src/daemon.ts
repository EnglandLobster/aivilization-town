import { nextResidentWakeDelta } from './residentWake';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { OpenAgentDriver } from '@aivilization/agent-runtime';
import { OpenSocietyRuntime } from '@aivilization/worker';
import { loadResidentCredentials } from './credentials';
import { createOpenCodeResidentDriver } from './openCode';
import { startResidentServer } from './server';
import type { TownConnection } from './townConnection';

export const RESIDENT_SOCIETY_DAEMON_VERSION = 'resident-society-daemon-v1';
type DriverFactory = (input: {
  actorId: string;
  connection: TownConnection;
  directory: string;
  sessionId?: string;
}) => OpenAgentDriver;
export type ResidentSocietyDaemonOptions = {
  readonly root: string;
  readonly port?: number;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly maxOpportunities?: number;
  readonly createDriver?: DriverFactory;
  readonly onProgress?: (event: {
    actorId: string;
    turnId: string;
    status: string;
    calls?: number;
  }) => void;
};
/** Adapter orchestration only: one world clock/writer, the original application decides every effect. */
export async function startResidentSocietyDaemon(options: ResidentSocietyDaemonOptions) {
  const timeout = options.timeoutMs ?? 180000;
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 600000)
    throw Error('invalid-daemon-timeout');
  if (
    options.maxOpportunities !== undefined &&
    (!Number.isSafeInteger(options.maxOpportunities) || options.maxOpportunities < 1)
  )
    throw Error('invalid-daemon-opportunity-limit');
  const runtime = new OpenSocietyRuntime(options.root);
  const controller = new AbortController();
  let server: Awaited<ReturnType<typeof startResidentServer>>;
  let credentials: ReturnType<typeof loadResidentCredentials>;
  try {
    credentials = loadResidentCredentials(
      options.root,
      runtime.manifest.residents.map((r) => r.id),
    );
    server = await startResidentServer(runtime, credentials, options.port ?? 0, {
      ownsScheduling: true,
    });
  } catch (error) {
    runtime.close();
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  const advance = (delta: number) => {
    const result = runtime.advanceTime(delta, randomUUID());
    if (!result.ok) throw Error(result.error ?? 'daemon-clock-refused');
  };
  const run = async () => {
    let opportunities = 0;
    while (
      !controller.signal.aborted &&
      (options.maxOpportunities === undefined || opportunities < options.maxOpportunities)
    ) {
      let actorId = runtime.nextResident();
      if (!actorId) {
        const delta = nextResidentWakeDelta(runtime);
        if (delta === undefined) return { status: 'idle' as const, opportunities };
        advance(delta);
        actorId = runtime.nextResident();
        if (!actorId) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          continue;
        }
      }
      const prior = Object.values(runtime.state.turns)
        .filter((t) => t.actorId === actorId && t.sessionId !== undefined)
        .at(-1);
      const turn = runtime.beginTurn(actorId);
      options.onProgress?.({ actorId, turnId: turn.id, status: 'running' });
      let result: Awaited<ReturnType<OpenAgentDriver['run']>>;
      try {
        const driverInput = {
          actorId,
          connection: { endpoint: server.url, token: credentials.residents[actorId]! },
          directory: join(options.root, 'opencode', actorId),
          ...(prior?.sessionId ? { sessionId: prior.sessionId } : {}),
        };
        const driver =
          options.createDriver?.(driverInput) ??
          createOpenCodeResidentDriver({ ...driverInput, model: options.model });
        result = await driver.run({
          actorId,
          turnId: turn.id,
          context: runtime.context(actorId),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]),
          invoke: (request) => Promise.resolve(runtime.invoke(actorId, request)),
        });
      } catch (error) {
        result = {
          status: 'provider-error',
          summary: error instanceof Error ? error.message : 'driver-failed',
        };
      }
      const finished = runtime.finishTurn(actorId, result);
      opportunities++;
      options.onProgress?.({
        actorId,
        turnId: finished.id,
        status: result.status,
        calls: finished.calls,
      });
      if (controller.signal.aborted) return { status: 'stopped' as const, opportunities };
      if (result.status === 'provider-error')
        return { status: 'provider-error' as const, opportunities };
      advance(Math.min(runtime.manifest.policy.opportunityCadenceMs ?? 1000, 86400000));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return {
      status: controller.signal.aborted ? ('stopped' as const) : ('limit-reached' as const),
      opportunities,
    };
  };
  // Give the caller the stop handle before starting a provider or completing a turn.
  const done = Promise.resolve().then(run);
  return {
    version: RESIDENT_SOCIETY_DAEMON_VERSION,
    url: server.url,
    done,
    stop: () => {
      controller.abort('daemon-stopped');
      closePromise ??= (async () => {
        try {
          await done;
        } finally {
          try {
            await server.close();
          } finally {
            runtime.close();
          }
        }
      })();
      return closePromise;
    },
  };
}
