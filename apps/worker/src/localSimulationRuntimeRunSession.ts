import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LocalSimulationRuntimeSupervisorCommandOutcome,
  LocalSimulationRuntimeSupervisorRunCycleSummary,
  LocalSimulationRuntimeSupervisorRunCyclesStopReason,
  LocalSimulationRuntimeSupervisorStatus,
} from './localSimulationRuntimeSupervisor';

export type LocalSimulationRuntimeRunSessionStatus = 'running' | 'completed' | 'stopped';

export type LocalSimulationRuntimeRunSessionState = {
  readonly traceId: string;
  readonly manifestId: string;
  readonly requestedAt: SimulationTimestamp;
  readonly requestedCycleCount: number;
  readonly cycleIntervalMs: number;
  readonly stopOnAttention: boolean;
  readonly status: LocalSimulationRuntimeRunSessionStatus;
  readonly completedCycleCount: number;
  readonly cycles: readonly LocalSimulationRuntimeSupervisorRunCycleSummary[];
  readonly statusSnapshot: LocalSimulationRuntimeSupervisorStatus;
  readonly updatedAt: SimulationTimestamp;
  readonly outcome?: LocalSimulationRuntimeSupervisorCommandOutcome;
  readonly stopReason?: LocalSimulationRuntimeSupervisorRunCyclesStopReason;
  readonly stopRequestedAt?: SimulationTimestamp;
};

export type LocalSimulationRuntimeRunSessionStopRequest = {
  readonly traceId: string;
  readonly requestedAt: SimulationTimestamp;
};

export type LocalSimulationRuntimeRunSessionRepository = {
  readonly save: (
    state: LocalSimulationRuntimeRunSessionState,
  ) => Promise<LocalSimulationRuntimeRunSessionState>;
  readonly get: (traceId: string) => Promise<LocalSimulationRuntimeRunSessionState | undefined>;
  readonly requestStop: (
    request: LocalSimulationRuntimeRunSessionStopRequest,
  ) => Promise<LocalSimulationRuntimeRunSessionState | undefined>;
};

export class InMemoryLocalSimulationRuntimeRunSessionRepository implements LocalSimulationRuntimeRunSessionRepository {
  private readonly sessions = new Map<string, LocalSimulationRuntimeRunSessionState>();

  save(
    state: LocalSimulationRuntimeRunSessionState,
  ): Promise<LocalSimulationRuntimeRunSessionState> {
    const saved = cloneSession(preserveStopRequest(state, this.sessions.get(state.traceId)));
    this.sessions.set(saved.traceId, saved);
    return Promise.resolve(cloneSession(saved));
  }

  get(traceId: string): Promise<LocalSimulationRuntimeRunSessionState | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const session = this.sessions.get(traceId);
      return session === undefined ? undefined : cloneSession(session);
    });
  }

  requestStop(
    request: LocalSimulationRuntimeRunSessionStopRequest,
  ): Promise<LocalSimulationRuntimeRunSessionState | undefined> {
    return Promise.resolve().then(() => {
      assertStopRequest(request);
      const session = this.sessions.get(request.traceId);
      if (session === undefined) {
        return undefined;
      }
      const saved = createStopRequestedSession(session, request.requestedAt);
      this.sessions.set(saved.traceId, saved);
      return cloneSession(saved);
    });
  }
}

export class FileLocalSimulationRuntimeRunSessionRepository implements LocalSimulationRuntimeRunSessionRepository {
  private readonly sessionsPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.sessionsPath = join(input.rootDir, 'supervisor-run-sessions.jsonl');
    ensureFile(this.sessionsPath, input.rootDir);
  }

  save(
    state: LocalSimulationRuntimeRunSessionState,
  ): Promise<LocalSimulationRuntimeRunSessionState> {
    return Promise.resolve().then(() => {
      const saved = cloneSession(
        preserveStopRequest(state, readLatestSession(this.sessionsPath, state.traceId)),
      );
      appendJsonLines(this.sessionsPath, [saved]);
      return cloneSession(saved);
    });
  }

  get(traceId: string): Promise<LocalSimulationRuntimeRunSessionState | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const session = readLatestSession(this.sessionsPath, traceId);
      return session === undefined ? undefined : cloneSession(session);
    });
  }

  requestStop(
    request: LocalSimulationRuntimeRunSessionStopRequest,
  ): Promise<LocalSimulationRuntimeRunSessionState | undefined> {
    return Promise.resolve().then(() => {
      assertStopRequest(request);
      const session = readLatestSession(this.sessionsPath, request.traceId);
      if (session === undefined) {
        return undefined;
      }
      const saved = createStopRequestedSession(session, request.requestedAt);
      appendJsonLines(this.sessionsPath, [saved]);
      return cloneSession(saved);
    });
  }
}

function cloneSession(
  state: LocalSimulationRuntimeRunSessionState,
): LocalSimulationRuntimeRunSessionState {
  return JSON.parse(JSON.stringify(state)) as LocalSimulationRuntimeRunSessionState;
}

function ensureFile(path: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, '');
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  appendFileSync(path, values.map((value) => JSON.stringify(value)).join('\n') + '\n');
}

function readJsonLines<TValue>(path: string): TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8');
  if (content.trim().length === 0) {
    return [];
  }
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as TValue);
}

function readLatestSession(
  path: string,
  traceId: string,
): LocalSimulationRuntimeRunSessionState | undefined {
  const sessions = readJsonLines<LocalSimulationRuntimeRunSessionState>(path);
  for (const session of sessions.reverse()) {
    if (session.traceId === traceId) {
      return session;
    }
  }
  return undefined;
}

function preserveStopRequest(
  state: LocalSimulationRuntimeRunSessionState,
  previous: LocalSimulationRuntimeRunSessionState | undefined,
): LocalSimulationRuntimeRunSessionState {
  if (state.stopRequestedAt !== undefined || previous?.stopRequestedAt === undefined) {
    return state;
  }
  return {
    ...state,
    stopRequestedAt: previous.stopRequestedAt,
  };
}

function createStopRequestedSession(
  session: LocalSimulationRuntimeRunSessionState,
  requestedAt: SimulationTimestamp,
): LocalSimulationRuntimeRunSessionState {
  if (session.status !== 'running' || session.stopRequestedAt !== undefined) {
    return cloneSession(session);
  }
  return cloneSession({
    ...session,
    stopRequestedAt: requestedAt,
    updatedAt: requestedAt,
  });
}

function assertStopRequest(request: LocalSimulationRuntimeRunSessionStopRequest): void {
  assertNonEmpty(request.traceId, 'traceId');
  assertNonNegativeFinite(request.requestedAt, 'requestedAt');
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
