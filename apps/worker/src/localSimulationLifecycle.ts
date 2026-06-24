import type { PartitionKey, SimulationTimestamp } from '@aivilization/sim-core';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalWorldRuntimeLoopInput, LocalWorldRuntimeLoopResult } from './localRuntimeLoop';
import { runLocalWorldRuntimeLoop } from './localRuntimeLoop';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';

export type LocalSimulationLifecycleRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly requestedAt: SimulationTimestamp;
  readonly scenarioPresetId?: string;
  readonly fromSequence?: number;
  readonly toSequence?: number;
};

export type LocalSimulationLifecycleStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'command-drain-failed'
  | 'reset-requested';

export type LocalSimulationLifecycleState = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly status: LocalSimulationLifecycleStatus;
  readonly nextTickIndex: number;
  readonly lastAppliedSequence: number;
  readonly updatedAt: SimulationTimestamp;
  readonly lastLoopId?: string;
  readonly completedTickCount?: number;
};

export type LocalSimulationLifecycleStateLookup = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
};

export type LocalSimulationLifecycleStateStore = {
  readonly getState: (
    lookup: LocalSimulationLifecycleStateLookup,
  ) => LocalSimulationLifecycleState | undefined;
  readonly saveState: (state: LocalSimulationLifecycleState) => LocalSimulationLifecycleState;
};

export type LocalSimulationLifecycleControllerInput = Omit<
  LocalWorldRuntimeLoopInput,
  'loopId' | 'firstTickIndex' | 'tickCount' | 'issuedAtStart' | 'pauseBeforeTick'
> & {
  readonly loopId: string;
  readonly tickBatchSize: number;
  readonly initialTickIndex?: number;
  readonly lifecycleStateStore?: LocalSimulationLifecycleStateStore;
  readonly pauseBeforeTick?: LocalWorldRuntimeLoopInput['pauseBeforeTick'];
};

export type LocalSimulationLifecycleStartResult = {
  readonly status: Extract<
    LocalSimulationLifecycleStatus,
    'paused' | 'completed' | 'command-drain-failed'
  >;
  readonly state: LocalSimulationLifecycleState;
  readonly loop: LocalWorldRuntimeLoopResult;
};

export type LocalSimulationLifecyclePauseResult = {
  readonly status: 'paused';
  readonly state: LocalSimulationLifecycleState;
};

export type LocalSimulationLifecycleResetResult = {
  readonly status: 'reset-requested';
  readonly state: LocalSimulationLifecycleState;
  readonly previousState?: LocalSimulationLifecycleState;
};

export type LocalSimulationLifecycleReplayResult = {
  readonly status: 'replayed';
  readonly projection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly lastAppliedSequence: number;
  readonly streamVersion: number;
  readonly replayFromSequence: number;
  readonly requestedFromSequence: number;
  readonly requestedToSequence: number;
  readonly state?: LocalSimulationLifecycleState;
};

export type LocalSimulationLifecycleController = {
  readonly start: (
    request: LocalSimulationLifecycleRequest,
  ) => Promise<LocalSimulationLifecycleStartResult>;
  readonly pause: (
    request: LocalSimulationLifecycleRequest,
  ) => Promise<LocalSimulationLifecyclePauseResult>;
  readonly reset: (
    request: LocalSimulationLifecycleRequest,
  ) => Promise<LocalSimulationLifecycleResetResult>;
  readonly replay: (
    request: LocalSimulationLifecycleRequest,
  ) => Promise<LocalSimulationLifecycleReplayResult>;
};

export function createInMemoryLocalSimulationLifecycleStateStore(
  initialStates: readonly LocalSimulationLifecycleState[] = [],
): LocalSimulationLifecycleStateStore {
  const states = new Map<string, LocalSimulationLifecycleState>();
  for (const state of initialStates) {
    states.set(createLifecycleStateKey(state), { ...state });
  }

  return {
    getState: (lookup) => {
      const state = states.get(createLifecycleStateKey(lookup));
      return state === undefined ? undefined : { ...state };
    },
    saveState: (state) => {
      const saved = { ...state };
      states.set(createLifecycleStateKey(saved), saved);
      return { ...saved };
    },
  };
}

export class FileLocalSimulationLifecycleStateStore implements LocalSimulationLifecycleStateStore {
  private readonly rootDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = input.rootDir;
    mkdirSync(this.rootDir, { recursive: true });
  }

  getState(lookup: LocalSimulationLifecycleStateLookup): LocalSimulationLifecycleState | undefined {
    const path = this.statePath(lookup);
    if (!existsSync(path)) {
      return undefined;
    }

    return parseLocalSimulationLifecycleState(JSON.parse(readFileSync(path, 'utf8')), path);
  }

  saveState(state: LocalSimulationLifecycleState): LocalSimulationLifecycleState {
    const saved = { ...state };
    mkdirSync(this.stateParentDir(saved), { recursive: true });
    writeFileSync(this.statePath(saved), `${JSON.stringify(saved, null, 2)}\n`);
    return { ...saved };
  }

  private stateParentDir(lookup: LocalSimulationLifecycleStateLookup): string {
    return join(this.rootDir, encodeURIComponent(lookup.simulationId));
  }

  private statePath(lookup: LocalSimulationLifecycleStateLookup): string {
    return join(
      this.stateParentDir(lookup),
      `${encodeURIComponent(lookup.partitionKey)}.json`,
    );
  }
}

export function createLocalSimulationLifecycleController(
  input: LocalSimulationLifecycleControllerInput,
): LocalSimulationLifecycleController {
  const lifecycleStateStore =
    input.lifecycleStateStore ?? createInMemoryLocalSimulationLifecycleStateStore();
  const initialTickIndex = input.initialTickIndex ?? 1;
  assertControllerInputMatchesStorage(input);
  assertPositiveInteger(initialTickIndex, 'initialTickIndex');
  assertPositiveInteger(input.tickBatchSize, 'tickBatchSize');

  return {
    start: async (request) => {
      assertRequestMatchesStorage(request, input.storage);
      assertNonNegativeFinite(request.requestedAt, 'requestedAt');

      const previousState = lifecycleStateStore.getState(request);
      if (previousState?.status === 'reset-requested') {
        throw new Error('local simulation reset has not been materialized');
      }

      const firstTickIndex = previousState?.nextTickIndex ?? initialTickIndex;
      const streamVersionBeforeStart = input.storage.eventStore.getStreamVersion(
        input.storage.partition.eventStreamName,
      );
      lifecycleStateStore.saveState({
        simulationId: request.simulationId,
        partitionKey: request.partitionKey,
        status: 'running',
        nextTickIndex: firstTickIndex,
        lastAppliedSequence: streamVersionBeforeStart,
        updatedAt: request.requestedAt,
        lastLoopId: input.loopId,
      });

      const loop = await runLocalWorldRuntimeLoop({
        ...toLoopBaseInput(input),
        loopId: input.loopId,
        firstTickIndex,
        tickCount: input.tickBatchSize,
        issuedAtStart: request.requestedAt,
        pauseBeforeTick: (step) => {
          if (lifecycleStateStore.getState(request)?.status === 'paused') {
            return true;
          }
          return input.pauseBeforeTick?.(step) === true;
        },
      });
      const state = lifecycleStateStore.saveState({
        simulationId: request.simulationId,
        partitionKey: request.partitionKey,
        status: loop.status,
        nextTickIndex: loop.nextTickIndex,
        lastAppliedSequence: input.storage.eventStore.getStreamVersion(
          input.storage.partition.eventStreamName,
        ),
        updatedAt: request.requestedAt,
        lastLoopId: input.loopId,
        completedTickCount: loop.completedTickCount,
      });

      return {
        status: loop.status,
        state,
        loop,
      };
    },
    pause: (request) => {
      assertRequestMatchesStorage(request, input.storage);
      assertNonNegativeFinite(request.requestedAt, 'requestedAt');

      const previousState = lifecycleStateStore.getState(request);
      const state = lifecycleStateStore.saveState({
        simulationId: request.simulationId,
        partitionKey: request.partitionKey,
        status: 'paused',
        nextTickIndex: previousState?.nextTickIndex ?? initialTickIndex,
        lastAppliedSequence: input.storage.eventStore.getStreamVersion(
          input.storage.partition.eventStreamName,
        ),
        updatedAt: request.requestedAt,
        ...(previousState?.lastLoopId === undefined ? {} : { lastLoopId: previousState.lastLoopId }),
        ...(previousState?.completedTickCount === undefined
          ? {}
          : { completedTickCount: previousState.completedTickCount }),
      });

      return Promise.resolve({
        status: 'paused',
        state,
      });
    },
    reset: (request) => {
      assertRequestMatchesStorage(request, input.storage);
      assertNonNegativeFinite(request.requestedAt, 'requestedAt');

      const previousState = lifecycleStateStore.getState(request);
      const state = lifecycleStateStore.saveState({
        simulationId: request.simulationId,
        partitionKey: request.partitionKey,
        status: 'reset-requested',
        nextTickIndex: initialTickIndex,
        lastAppliedSequence: input.storage.eventStore.getStreamVersion(
          input.storage.partition.eventStreamName,
        ),
        updatedAt: request.requestedAt,
      });

      return Promise.resolve({
        status: 'reset-requested',
        state,
        ...(previousState === undefined ? {} : { previousState }),
      });
    },
    replay: (request) => {
      assertRequestMatchesStorage(request, input.storage);
      assertNonNegativeFinite(request.requestedAt, 'requestedAt');

      const streamVersion = input.storage.eventStore.getStreamVersion(
        input.storage.partition.eventStreamName,
      );
      const requestedFromSequence = request.fromSequence ?? 0;
      const requestedToSequence = request.toSequence ?? streamVersion;
      assertSequenceWindow({
        fromSequence: requestedFromSequence,
        toSequence: requestedToSequence,
        streamVersion,
      });

      const hydrated = hydrateWorldProjectionFromEventStream({
        initialProjection: input.initialProjection,
        eventStore: input.storage.eventStore,
        streamName: input.storage.partition.eventStreamName,
        toSequence: requestedToSequence,
        checkpoint: {
          checkpointStore: input.storage.checkpointStore,
          snapshotStore: input.storage.snapshotStore,
          lookup: {
            simulationId: input.storage.partition.simulationId,
            partitionKey: input.storage.partition.partitionKey,
          },
        },
      });
      const events = input.storage.eventStore
        .readStream(input.storage.partition.eventStreamName, {
          afterSequence: requestedFromSequence,
        })
        .filter((event) => event.sequence <= requestedToSequence);
      const state = lifecycleStateStore.getState(request);

      return Promise.resolve({
        status: 'replayed',
        projection: hydrated.projection,
        events,
        lastAppliedSequence: hydrated.lastAppliedSequence,
        streamVersion: hydrated.streamVersion,
        replayFromSequence: hydrated.replayFromSequence,
        requestedFromSequence,
        requestedToSequence,
        ...(state === undefined ? {} : { state }),
      });
    },
  };
}

function toLoopBaseInput(
  input: LocalSimulationLifecycleControllerInput,
): Omit<
  LocalWorldRuntimeLoopInput,
  'loopId' | 'firstTickIndex' | 'tickCount' | 'issuedAtStart' | 'pauseBeforeTick'
> {
  return {
    storage: input.storage,
    simulationId: input.simulationId,
    initialProjection: input.initialProjection,
    policies: input.policies,
    commandConsumerId: input.commandConsumerId,
    localizedPlanners: input.localizedPlanners,
    steeringSimulator: input.steeringSimulator,
    agents: input.agents,
    tickIntervalMs: input.tickIntervalMs,
    ...(input.steeringRepair === undefined ? {} : { steeringRepair: input.steeringRepair }),
    ...(input.strategicPlanCompiler === undefined
      ? {}
      : { strategicPlanCompiler: input.strategicPlanCompiler }),
    ...(input.commandDrainLimit === undefined ? {} : { commandDrainLimit: input.commandDrainLimit }),
    ...(input.timeDeltaMs === undefined ? {} : { timeDeltaMs: input.timeDeltaMs }),
    ...(input.marketMetrics === undefined ? {} : { marketMetrics: input.marketMetrics }),
  };
}

function assertRequestMatchesStorage(
  request: LocalSimulationLifecycleRequest,
  storage: LocalWorldRuntimeStorage,
): void {
  if (request.simulationId !== storage.partition.simulationId) {
    throw new Error(
      `request simulationId ${request.simulationId} must match storage simulationId ${storage.partition.simulationId}`,
    );
  }
  if (request.partitionKey !== storage.partition.partitionKey) {
    throw new Error(
      `request partitionKey ${request.partitionKey} must match storage partitionKey ${storage.partition.partitionKey}`,
    );
  }
}

function assertControllerInputMatchesStorage(
  input: LocalSimulationLifecycleControllerInput,
): void {
  if (input.simulationId !== input.storage.partition.simulationId) {
    throw new Error(
      `controller simulationId ${input.simulationId} must match storage simulationId ${input.storage.partition.simulationId}`,
    );
  }
}

function assertSequenceWindow(input: {
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly streamVersion: number;
}): void {
  assertNonNegativeInteger(input.fromSequence, 'fromSequence');
  assertNonNegativeInteger(input.toSequence, 'toSequence');
  if (input.toSequence < input.fromSequence) {
    throw new Error('toSequence must be greater than or equal to fromSequence');
  }
  if (input.toSequence > input.streamVersion) {
    throw new Error(
      `toSequence ${input.toSequence} must not exceed stream version ${input.streamVersion}`,
    );
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
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

function createLifecycleStateKey(input: LocalSimulationLifecycleStateLookup): string {
  return JSON.stringify([input.simulationId, input.partitionKey]);
}

function parseLocalSimulationLifecycleState(
  value: unknown,
  source: string,
): LocalSimulationLifecycleState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`invalid local simulation lifecycle state in ${source}`);
  }

  const record = value as Record<string, unknown>;
  const simulationId = parseString(record.simulationId, 'simulationId', source);
  const partitionKey = parseString(record.partitionKey, 'partitionKey', source);
  const status = parseLocalSimulationLifecycleStatus(record.status, source);
  const nextTickIndex = parsePositiveInteger(record.nextTickIndex, 'nextTickIndex', source);
  const lastAppliedSequence = parseNonNegativeInteger(
    record.lastAppliedSequence,
    'lastAppliedSequence',
    source,
  );
  const updatedAt = parseNonNegativeFinite(record.updatedAt, 'updatedAt', source);

  return {
    simulationId,
    partitionKey,
    status,
    nextTickIndex,
    lastAppliedSequence,
    updatedAt,
    ...(record.lastLoopId === undefined
      ? {}
      : { lastLoopId: parseString(record.lastLoopId, 'lastLoopId', source) }),
    ...(record.completedTickCount === undefined
      ? {}
      : {
          completedTickCount: parseNonNegativeInteger(
            record.completedTickCount,
            'completedTickCount',
            source,
          ),
        }),
  };
}

function parseLocalSimulationLifecycleStatus(
  value: unknown,
  source: string,
): LocalSimulationLifecycleStatus {
  if (
    value === 'running' ||
    value === 'paused' ||
    value === 'completed' ||
    value === 'command-drain-failed' ||
    value === 'reset-requested'
  ) {
    return value;
  }
  throw new Error(`invalid status in ${source}`);
}

function parseString(value: unknown, name: string, source: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`invalid ${name} in ${source}`);
  }
  return value;
}

function parsePositiveInteger(value: unknown, name: string, source: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`invalid ${name} in ${source}`);
  }
  return value as number;
}

function parseNonNegativeInteger(value: unknown, name: string, source: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`invalid ${name} in ${source}`);
  }
  return value as number;
}

function parseNonNegativeFinite(value: unknown, name: string, source: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid ${name} in ${source}`);
  }
  return value;
}
