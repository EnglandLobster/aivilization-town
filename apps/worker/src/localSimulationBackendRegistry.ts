import {
  createSimulationApiService,
  type AgentProfileQueryPort,
  type CommandStoreSteeringSubmissionResult,
  type SimulationApiService,
} from '@aivilization/api';
import type { PartitionKey } from '@aivilization/sim-core';
import {
  createLocalSimulationBackend,
  type LocalSimulationBackend,
  type LocalSimulationBackendInput,
  type LocalSimulationBackendLifecycleResult,
  type LocalAgentProfileQueryResult,
  type LocalExperimentValidationReportQueryResult,
  type LocalWorldEventFeedResult,
  type LocalWorldProjectionQueryResult,
  type LocalWorldSyncResult,
} from './localSimulationBackend';
import { createLocalWorldRuntimeStorage } from './localRuntimeStorage';

export type LocalSimulationBackendLookup = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
};

export type LocalSimulationBackendRegistration = Omit<LocalSimulationBackendInput, 'storage'> & {
  readonly partitionKey: PartitionKey;
};

export type LocalSimulationBackendRegistryInput = {
  readonly rootDir: string;
  readonly registrations: readonly LocalSimulationBackendRegistration[];
  /**
   * Optional hook that augments a backend's lifecycle input at construction
   * time with partition-scoped simulation-wide-authority wiring (command
   * router, pre-tick materializer hook, lease). It is invoked once per backend
   * the first time it is looked up. Returning undefined leaves the backend
   * unchanged, which is the default authority-disabled behavior.
   */
  readonly resolveBackendAugment?: (lookup: LocalSimulationBackendLookup) =>
    | {
        readonly commandRouter?: LocalSimulationBackendRegistration['commandRouter'];
        readonly preTickMaterialize?: LocalSimulationBackendRegistration['preTickMaterialize'];
        readonly materializerLease?: LocalSimulationBackendRegistration['materializerLease'];
      }
    | undefined;
};

export type LocalSimulationBackendRegistry = {
  readonly api: SimulationApiService<
    LocalWorldProjectionQueryResult,
    CommandStoreSteeringSubmissionResult,
    LocalSimulationBackendLifecycleResult,
    LocalWorldEventFeedResult,
    LocalWorldSyncResult,
    LocalExperimentValidationReportQueryResult
  >;
  readonly agentProfiles: AgentProfileQueryPort<LocalAgentProfileQueryResult>;
  readonly listPartitions: () => readonly LocalSimulationBackendLookup[];
  readonly hasBackend: (lookup: LocalSimulationBackendLookup) => boolean;
  readonly getBackend: (lookup: LocalSimulationBackendLookup) => LocalSimulationBackend;
};

export function createLocalSimulationBackendRegistry(
  input: LocalSimulationBackendRegistryInput,
): LocalSimulationBackendRegistry {
  assertNonEmpty(input.rootDir, 'rootDir');

  const registrations = new Map<string, LocalSimulationBackendRegistration>();
  for (const registration of input.registrations) {
    const key = createBackendRegistrationKey(registration);
    if (registrations.has(key)) {
      throw new Error(
        `duplicate local simulation backend registration: ${formatBackendLookup(registration)}`,
      );
    }
    registrations.set(key, registration);
  }

  const backends = new Map<string, LocalSimulationBackend>();

  function hasBackend(lookup: LocalSimulationBackendLookup): boolean {
    return registrations.has(createBackendRegistrationKey(lookup));
  }

  function getBackend(lookup: LocalSimulationBackendLookup): LocalSimulationBackend {
    const key = createBackendRegistrationKey(lookup);
    const cached = backends.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const registration = registrations.get(key);
    if (registration === undefined) {
      throw new Error(`local simulation backend is not registered: ${formatBackendLookup(lookup)}`);
    }

    const augment = input.resolveBackendAugment?.(lookup);
    const backend = createLocalSimulationBackend({
      ...registration,
      storage: createLocalWorldRuntimeStorage({
        rootDir: input.rootDir,
        simulationId: registration.simulationId,
        partitionKey: registration.partitionKey,
      }),
      ...(augment === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(augment).filter(([, value]) => value !== undefined),
          )),
    });
    backends.set(key, backend);
    return backend;
  }

  const api = createSimulationApiService<
    LocalWorldProjectionQueryResult,
    CommandStoreSteeringSubmissionResult,
    LocalSimulationBackendLifecycleResult,
    LocalWorldEventFeedResult,
    LocalWorldSyncResult,
    LocalExperimentValidationReportQueryResult
  >({
    projectionQueries: {
      getProjection: (request) => getBackend(request).api.getProjection(request),
    },
    eventFeeds: {
      getEvents: (request) => getBackend(request).eventFeeds.getEvents(request),
    },
    sync: {
      getSync: (request) => getBackend(request).sync.getSync(request),
    },
    validationReports: {
      getReport: (request) => getBackend(request).validationReports.getReport(request),
      queryReports: (request) => getBackend(request).validationReports.queryReports(request),
    },
    marketObservations: {
      queryMarketTradeObservations: (request) =>
        getBackend(request).marketObservations.queryMarketTradeObservations(request),
      queryMarketOhlcBars: (request) =>
        getBackend(request).marketObservations.queryMarketOhlcBars(request),
    },
    steeringCommands: {
      submit: (command, context) => getBackend(context).steeringCommands.submit(command, context),
    },
    lifecycle: {
      start: (request) => getBackend(request).lifecycle.start(request),
      pause: (request) => getBackend(request).lifecycle.pause(request),
      reset: (request) => getBackend(request).lifecycle.reset(request),
      replay: (request) => getBackend(request).lifecycle.replay(request),
    },
  });
  const agentProfiles: AgentProfileQueryPort<LocalAgentProfileQueryResult> = {
    getProfile: async (request) => getBackend(request).agentProfiles.getProfile(request),
    queryProfiles: async (request) => getBackend(request).agentProfiles.queryProfiles(request),
  };

  return {
    api,
    agentProfiles,
    listPartitions: () => [...registrations.values()].map(toBackendLookup),
    hasBackend,
    getBackend,
  };
}

function toBackendLookup(
  registration: LocalSimulationBackendRegistration,
): LocalSimulationBackendLookup {
  return {
    simulationId: registration.simulationId,
    partitionKey: registration.partitionKey,
  };
}

function createBackendRegistrationKey(lookup: LocalSimulationBackendLookup): string {
  return JSON.stringify([lookup.simulationId, lookup.partitionKey]);
}

function formatBackendLookup(lookup: LocalSimulationBackendLookup): string {
  return `${lookup.simulationId}/${lookup.partitionKey}`;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
