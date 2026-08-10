import { IncrementalJsonLinesProjection } from '@aivilization/sim-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
  readonly runManifestId?: string;
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

export type LocalSimulationRuntimeRunSessionCycleAppendRequest = {
  readonly traceId: string;
  readonly cycle: LocalSimulationRuntimeSupervisorRunCycleSummary;
  readonly statusSnapshot: LocalSimulationRuntimeSupervisorStatus;
  readonly updatedAt: SimulationTimestamp;
};

export type LocalSimulationRuntimeRunSessionCycleAppendResult = {
  readonly completedCycleCount: number;
  readonly stopRequestedAt?: SimulationTimestamp;
};

export type LocalSimulationRuntimeRunSessionRepository = {
  readonly save: (
    state: LocalSimulationRuntimeRunSessionState,
  ) => Promise<LocalSimulationRuntimeRunSessionState>;
  readonly get: (traceId: string) => Promise<LocalSimulationRuntimeRunSessionState | undefined>;
  readonly appendCycle: (
    request: LocalSimulationRuntimeRunSessionCycleAppendRequest,
  ) => Promise<LocalSimulationRuntimeRunSessionCycleAppendResult>;
  readonly requestStop: (
    request: LocalSimulationRuntimeRunSessionStopRequest,
  ) => Promise<LocalSimulationRuntimeRunSessionState | undefined>;
};

export const LOCAL_SIMULATION_RUNTIME_RUN_SESSION_LEDGER_VERSION =
  'local-run-session-ledger-v2';

export function createLocalSimulationRuntimeRunSessionLedgerPolicyManifest() {
  return {
    policyVersion: LOCAL_SIMULATION_RUNTIME_RUN_SESSION_LEDGER_VERSION,
    persistence: 'append-one-cycle-delta-per-completed-cycle' as const,
    projection: 'incremental-in-process-latest-session-state' as const,
    recovery: 'replay-versioned-deltas-with-legacy-full-snapshot-compatibility' as const,
    growthBoundary: 'linear-in-completed-cycle-count' as const,
  };
}

type LocalSimulationRuntimeRunSessionLedgerRecord = {
  readonly schemaVersion: typeof LOCAL_SIMULATION_RUNTIME_RUN_SESSION_LEDGER_VERSION;
  readonly operation: 'upsert-session';
  readonly traceId: string;
  readonly state: Omit<LocalSimulationRuntimeRunSessionState, 'cycles'>;
  readonly appendedCycles: readonly LocalSimulationRuntimeSupervisorRunCycleSummary[];
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

  appendCycle(
    request: LocalSimulationRuntimeRunSessionCycleAppendRequest,
  ): Promise<LocalSimulationRuntimeRunSessionCycleAppendResult> {
    return Promise.resolve().then(() => {
      const session = this.sessions.get(request.traceId);
      if (session === undefined) {
        throw new Error(`run session does not exist: ${request.traceId}`);
      }
      assertNextCycle(session, request.cycle);
      const saved = cloneSession({
        ...session,
        completedCycleCount: session.completedCycleCount + 1,
        cycles: [...session.cycles, { ...request.cycle }],
        statusSnapshot: request.statusSnapshot,
        updatedAt: request.updatedAt,
      });
      this.sessions.set(saved.traceId, saved);
      return createCycleAppendResult(saved);
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
  private readonly sessionsFile: IncrementalJsonLinesProjection<unknown>;
  private readonly latestSessionByTraceId = new Map<
    string,
    LocalSimulationRuntimeRunSessionState
  >();

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.sessionsPath = join(input.rootDir, 'supervisor-run-sessions.jsonl');
    ensureFile(this.sessionsPath, input.rootDir);
    this.sessionsFile = new IncrementalJsonLinesProjection({
      path: this.sessionsPath,
      resetProjection: () => this.latestSessionByTraceId.clear(),
      project: (record) => this.projectRecord(record),
    });
  }

  save(
    state: LocalSimulationRuntimeRunSessionState,
  ): Promise<LocalSimulationRuntimeRunSessionState> {
    return Promise.resolve().then(() => {
      const previous = this.getLatestSession(state.traceId);
      const saved = cloneSession(
        preserveStopRequest(state, previous),
      );
      const previousCycleCount = previous?.cycles.length ?? 0;
      assertSessionCycleExtension(previous, saved);
      this.sessionsFile.append([
        createLedgerRecord(saved, saved.cycles.slice(previousCycleCount)),
      ]);
      return cloneSession(saved);
    });
  }

  get(traceId: string): Promise<LocalSimulationRuntimeRunSessionState | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(traceId, 'traceId');
      const session = this.getLatestSession(traceId);
      return session === undefined ? undefined : cloneSession(session);
    });
  }

  appendCycle(
    request: LocalSimulationRuntimeRunSessionCycleAppendRequest,
  ): Promise<LocalSimulationRuntimeRunSessionCycleAppendResult> {
    return Promise.resolve().then(() => {
      const session = this.getLatestSession(request.traceId);
      if (session === undefined) {
        throw new Error(`run session does not exist: ${request.traceId}`);
      }
      assertNextCycle(session, request.cycle);
      const next: LocalSimulationRuntimeRunSessionState = {
        ...session,
        completedCycleCount: session.completedCycleCount + 1,
        cycles: session.cycles,
        statusSnapshot: request.statusSnapshot,
        updatedAt: request.updatedAt,
      };
      this.sessionsFile.append([createLedgerRecord(next, [request.cycle])]);
      return createCycleAppendResult(next);
    });
  }

  requestStop(
    request: LocalSimulationRuntimeRunSessionStopRequest,
  ): Promise<LocalSimulationRuntimeRunSessionState | undefined> {
    return Promise.resolve().then(() => {
      assertStopRequest(request);
      const session = this.getLatestSession(request.traceId);
      if (session === undefined) {
        return undefined;
      }
      const saved = createStopRequestedSession(session, request.requestedAt);
      this.sessionsFile.append([createLedgerRecord(saved, [])]);
      return cloneSession(saved);
    });
  }

  getStorageDiagnostics() {
    return this.sessionsFile.diagnostics();
  }

  private getLatestSession(traceId: string): LocalSimulationRuntimeRunSessionState | undefined {
    this.sessionsFile.refresh();
    return this.latestSessionByTraceId.get(traceId);
  }

  private projectRecord(record: unknown): void {
    if (isRunSessionLedgerRecord(record)) {
      const previous = this.latestSessionByTraceId.get(record.traceId);
      assertLedgerCycleAppend(previous, record);
      const cycles = (previous?.cycles ?? []) as LocalSimulationRuntimeSupervisorRunCycleSummary[];
      cycles.push(...record.appendedCycles.map((cycle) => ({ ...cycle })));
      const session = {
        ...record.state,
        cycles,
      };
      if (session.completedCycleCount !== session.cycles.length) {
        throw new Error(
          `run session ${session.traceId} completedCycleCount does not match projected cycles`,
        );
      }
      this.latestSessionByTraceId.set(session.traceId, session);
      return;
    }
    if (isLegacyRunSessionState(record)) {
      this.latestSessionByTraceId.set(record.traceId, cloneSession(record));
      return;
    }
    throw new Error(`invalid run session ledger record in ${this.sessionsPath}`);
  }
}

function assertLedgerCycleAppend(
  previous: LocalSimulationRuntimeRunSessionState | undefined,
  record: LocalSimulationRuntimeRunSessionLedgerRecord,
): void {
  const previousCycleCount = previous?.completedCycleCount ?? 0;
  for (let index = 0; index < record.appendedCycles.length; index += 1) {
    const cycle = record.appendedCycles[index];
    const expectedCycleIndex = previousCycleCount + index + 1;
    if (cycle?.cycleIndex !== expectedCycleIndex) {
      throw new Error(
        `run session ${record.traceId} expected appended cycle ${expectedCycleIndex}, received ${String(cycle?.cycleIndex)}`,
      );
    }
  }
  if (record.state.completedCycleCount !== previousCycleCount + record.appendedCycles.length) {
    throw new Error(`run session ${record.traceId} delta completedCycleCount is inconsistent`);
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

function createLedgerRecord(
  session: LocalSimulationRuntimeRunSessionState,
  appendedCycles: readonly LocalSimulationRuntimeSupervisorRunCycleSummary[],
): LocalSimulationRuntimeRunSessionLedgerRecord {
  const { cycles, ...state } = session;
  void cycles;
  return {
    schemaVersion: LOCAL_SIMULATION_RUNTIME_RUN_SESSION_LEDGER_VERSION,
    operation: 'upsert-session',
    traceId: session.traceId,
    state,
    appendedCycles: appendedCycles.map((cycle) => ({ ...cycle })),
  };
}

function isRunSessionLedgerRecord(
  value: unknown,
): value is LocalSimulationRuntimeRunSessionLedgerRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === LOCAL_SIMULATION_RUNTIME_RUN_SESSION_LEDGER_VERSION &&
    value.operation === 'upsert-session' &&
    typeof value.traceId === 'string' &&
    isRecord(value.state) &&
    Array.isArray(value.appendedCycles)
  );
}

function isLegacyRunSessionState(value: unknown): value is LocalSimulationRuntimeRunSessionState {
  return (
    isRecord(value) &&
    !('schemaVersion' in value) &&
    typeof value.traceId === 'string' &&
    Array.isArray(value.cycles) &&
    typeof value.completedCycleCount === 'number'
  );
}

function assertSessionCycleExtension(
  previous: LocalSimulationRuntimeRunSessionState | undefined,
  next: LocalSimulationRuntimeRunSessionState,
): void {
  if (previous === undefined) return;
  if (next.cycles.length < previous.cycles.length) {
    throw new Error(`run session ${next.traceId} cannot remove persisted cycles`);
  }
  for (let index = 0; index < previous.cycles.length; index += 1) {
    if (JSON.stringify(previous.cycles[index]) !== JSON.stringify(next.cycles[index])) {
      throw new Error(`run session ${next.traceId} cannot rewrite persisted cycle ${index + 1}`);
    }
  }
}

function assertNextCycle(
  session: LocalSimulationRuntimeRunSessionState,
  cycle: LocalSimulationRuntimeSupervisorRunCycleSummary,
): void {
  const expectedCycleIndex = session.completedCycleCount + 1;
  if (cycle.cycleIndex !== expectedCycleIndex) {
    throw new Error(
      `run session ${session.traceId} expected cycle ${expectedCycleIndex}, received ${cycle.cycleIndex}`,
    );
  }
}

function createCycleAppendResult(
  session: LocalSimulationRuntimeRunSessionState,
): LocalSimulationRuntimeRunSessionCycleAppendResult {
  return {
    completedCycleCount: session.completedCycleCount,
    ...(session.stopRequestedAt === undefined
      ? {}
      : { stopRequestedAt: session.stopRequestedAt }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
