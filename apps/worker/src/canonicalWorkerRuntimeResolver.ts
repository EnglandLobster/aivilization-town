import type { CycleActionSimulator, CycleRepairPolicy } from '@aivilization/agent-runtime';
import {
  createCommandEnvelope,
  type AgentId,
  type SimulationId,
  type SimulationTimestamp,
} from '@aivilization/sim-core';
import {
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldProjection,
} from '@aivilization/world';
import {
  createCanonicalDomainRuntimeRegistrations,
  type CanonicalDomainRuntimeConfig,
} from './canonicalDomainRuntimes';
import {
  createDomainRuntimeResolver,
  type WorkerDomainRuntimeRegistration,
} from './domainRuntimeRegistry';
import type { WorkerAgentRuntimeResolver } from './agentScheduling';

export type CanonicalWorkerRuntimeResolverConfig = {
  readonly simulationId: SimulationId;
  readonly policies: WorldCommandPolicies;
  readonly domainConfig?: CanonicalDomainRuntimeConfig;
  readonly additionalRegistrations?: readonly WorkerDomainRuntimeRegistration[];
  readonly repair?: CycleRepairPolicy;
  readonly issuedAt?: SimulationTimestamp;
  readonly nextSequence?: number;
  readonly commandIdPrefix?: string;
};

export type WorldCommandDryRunSimulatorConfig = {
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicies;
  readonly issuedAt?: SimulationTimestamp;
  readonly nextSequence?: number;
  readonly commandIdPrefix?: string;
};

const DEFAULT_DRY_RUN_COMMAND_ID_PREFIX = 'canonical-runtime-dry-run';
const DEFAULT_DRY_RUN_SEQUENCE = 1;

export function createCanonicalWorkerRuntimeResolver(
  config: CanonicalWorkerRuntimeResolverConfig,
): WorkerAgentRuntimeResolver {
  const registryResolver = createDomainRuntimeResolver({
    registrations: [
      ...createCanonicalDomainRuntimeRegistrations(config.domainConfig),
      ...(config.additionalRegistrations ?? []),
    ],
    simulate: ({ action }) => ({ status: 'accepted', action }),
    ...(config.repair === undefined ? {} : { repair: config.repair }),
  });

  return async (context) => {
    const binding = await registryResolver(context);
    if (binding === undefined) {
      return undefined;
    }

    return {
      microPlanners: binding.microPlanners,
      simulate: createWorldCommandDryRunSimulator({
        simulationId: config.simulationId,
        agentId: context.agentId,
        projection: context.projection,
        policies: config.policies,
        issuedAt: config.issuedAt ?? context.projection.clock.now,
        ...(config.nextSequence === undefined ? {} : { nextSequence: config.nextSequence }),
        ...(config.commandIdPrefix === undefined
          ? {}
          : { commandIdPrefix: config.commandIdPrefix }),
      }),
      ...(config.repair === undefined ? {} : { repair: config.repair }),
    };
  };
}

export function createWorldCommandDryRunSimulator(
  config: WorldCommandDryRunSimulatorConfig,
): CycleActionSimulator {
  return ({ action }) => {
    try {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id: `${config.commandIdPrefix ?? DEFAULT_DRY_RUN_COMMAND_ID_PREFIX}-${action.id}`,
          simulationId: config.simulationId,
          actorId: config.agentId,
          source: 'agent-runtime',
          type: action.commandType,
          payload: action.payload,
          issuedAt: config.issuedAt ?? config.projection.clock.now,
        }),
        projection: config.projection,
        policies: config.policies,
        nextSequence: config.nextSequence ?? DEFAULT_DRY_RUN_SEQUENCE,
      });
      const rejection = events.find((event) => event.type === 'ActionRejected');
      if (rejection !== undefined && rejection.type === 'ActionRejected') {
        return {
          status: 'rejected',
          action,
          reason: rejection.payload.reason,
        };
      }

      return {
        status: 'accepted',
        action,
      };
    } catch (error) {
      return {
        status: 'rejected',
        action,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
