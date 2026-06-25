import type {
  ActionWithRepairResult,
  ActionSimulationTraceEvent,
  AtomicActionProposal,
  ActionSequenceGenerator,
  AdaptiveReplanningPolicy,
  CycleActionSimulator,
  CycleRepairPolicy,
  CycleSubtaskCompletionPolicy,
  GlobalActionSynthesizer,
  ReactiveCorrector,
  ReplanningDecider,
  SocialDialogueGenerator,
  SubtaskPrioritizer,
} from '@aivilization/agent-runtime';
import {
  createCommandEnvelope,
  type AgentId,
  type SimulationId,
  type SimulationTimestamp,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  type AgentObserveLocationPayload,
  type AgentMoveToPayload,
  type AgentProducePayload,
  type AgentUpgradeResidentialTierPayload,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import {
  createCanonicalDomainRuntimeRegistrations,
  resolveProductionTargetCommodityName,
  resolveResidentialTargetTier,
  type CanonicalDomainRuntimeConfig,
} from './canonicalDomainRuntimes';
import {
  createDomainRuntimeResolver,
  type WorkerDomainRuntimeFactoryInput,
  type WorkerDomainRuntimeRegistration,
} from './domainRuntimeRegistry';
import type { WorkerAgentRuntimeResolver } from './agentScheduling';
import {
  deriveActionSynthesisPolicyFromWorldState,
  type WorldStateActionSynthesisPolicyConfig,
} from './actionSynthesisPolicy';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';

export type CanonicalWorkerRuntimeResolverConfig = {
  readonly simulationId: SimulationId;
  readonly policies: WorldCommandPolicySource;
  readonly domainConfig?: CanonicalDomainRuntimeConfig;
  readonly actionSynthesis?: WorldStateActionSynthesisPolicyConfig | false;
  readonly additionalRegistrations?: readonly WorkerDomainRuntimeRegistration[];
  readonly repair?: CycleRepairPolicy;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly reactiveCorrector?: ReactiveCorrector;
  readonly replanningDecider?: ReplanningDecider;
  readonly issuedAt?: SimulationTimestamp;
  readonly nextSequence?: number;
  readonly commandIdPrefix?: string;
};

export type WorldCommandDryRunSimulatorConfig = {
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicySource;
  readonly issuedAt?: SimulationTimestamp;
  readonly nextSequence?: number;
  readonly commandIdPrefix?: string;
};

const DEFAULT_DRY_RUN_COMMAND_ID_PREFIX = 'canonical-runtime-dry-run';
const DEFAULT_DRY_RUN_SEQUENCE = 1;

export function createCanonicalWorkerRuntimeResolver(
  config: CanonicalWorkerRuntimeResolverConfig,
): WorkerAgentRuntimeResolver {
  return async (context) => {
    const policies = resolveWorldCommandPolicies({
      policies: config.policies,
      projection: context.projection,
    });
    const registryResolver = createDomainRuntimeResolver({
      registrations: [
        ...createCanonicalDomainRuntimeRegistrations(config.domainConfig, policies),
        ...(config.additionalRegistrations ?? []),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      ...(config.repair === undefined ? {} : { repair: config.repair }),
    });
    const binding = await registryResolver(context);
    if (binding === undefined) {
      return undefined;
    }

    return {
      microPlanners: binding.microPlanners,
      ...(config.actionSynthesis === false
        ? {}
        : {
            actionSynthesis: deriveActionSynthesisPolicyFromWorldState({
              agent: context.agent,
              ...(config.actionSynthesis === undefined ? {} : { config: config.actionSynthesis }),
            }),
          }),
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
      ...(config.replanningPolicy === undefined
        ? {}
        : { replanningPolicy: config.replanningPolicy }),
      ...(config.subtaskPrioritizer === undefined
        ? {}
        : { subtaskPrioritizer: config.subtaskPrioritizer }),
      ...(config.actionSequenceGenerator === undefined
        ? {}
        : { actionSequenceGenerator: config.actionSequenceGenerator }),
      ...(config.socialDialogueGenerator === undefined
        ? {}
        : { socialDialogueGenerator: config.socialDialogueGenerator }),
      ...(config.globalSynthesizer === undefined
        ? {}
        : { globalSynthesizer: config.globalSynthesizer }),
      ...(config.reactiveCorrector === undefined
        ? {}
        : { reactiveCorrector: config.reactiveCorrector }),
      ...(config.replanningDecider === undefined
        ? {}
        : { replanningDecider: config.replanningDecider }),
      subtaskCompletion: createCanonicalSubtaskCompletionPolicy({
        context,
        ...(config.domainConfig?.production === undefined
          ? {}
          : { productionConfig: config.domainConfig.production }),
        ...(config.domainConfig?.residential === undefined
          ? {}
          : { residentialConfig: config.domainConfig.residential }),
      }),
    };
  };
}

function createCanonicalSubtaskCompletionPolicy(input: {
  readonly productionConfig?: CanonicalDomainRuntimeConfig['production'];
  readonly residentialConfig?: CanonicalDomainRuntimeConfig['residential'];
  readonly context: WorkerDomainRuntimeFactoryInput;
}): CycleSubtaskCompletionPolicy {
  return ({ selectedSubtask, simulationResults }) => {
    const movementCompletion = decideMovementSubtaskCompletion({ simulationResults });
    if (movementCompletion !== undefined) {
      return movementCompletion;
    }

    const observationCompletion = decideObservationSubtaskCompletion({ simulationResults });
    if (observationCompletion !== undefined) {
      return observationCompletion;
    }

    const residentialCompletion = decideResidentialSubtaskCompletion({
      context: input.context,
      selectedSubtask,
      simulationResults,
      ...(input.residentialConfig === undefined ? {} : { config: input.residentialConfig }),
    });
    if (residentialCompletion !== undefined) {
      return residentialCompletion;
    }

    return decideProductionSubtaskCompletion({
      context: input.context,
      selectedSubtask,
      simulationResults,
      ...(input.productionConfig === undefined ? {} : { config: input.productionConfig }),
    });
  };
}

function decideMovementSubtaskCompletion(input: {
  readonly simulationResults: Parameters<CycleSubtaskCompletionPolicy>[0]['simulationResults'];
}): ReturnType<CycleSubtaskCompletionPolicy> | undefined {
  const movementAction = input.simulationResults
    .map((result) => acceptedActionFromSimulationResult(result))
    .find(isAgentMoveToAction);
  if (movementAction === undefined) {
    return undefined;
  }

  return {
    status: 'in-progress',
    reason: 'moved to required location before executing subtask',
  };
}

function decideObservationSubtaskCompletion(input: {
  readonly simulationResults: Parameters<CycleSubtaskCompletionPolicy>[0]['simulationResults'];
}): ReturnType<CycleSubtaskCompletionPolicy> | undefined {
  const observationAction = input.simulationResults
    .map((result) => acceptedActionFromSimulationResult(result))
    .find(isAgentObserveLocationAction);
  if (observationAction === undefined) {
    return undefined;
  }

  return {
    status: 'in-progress',
    reason: 'observed current location before executing subtask',
  };
}

function decideProductionSubtaskCompletion(input: {
  readonly config?: CanonicalDomainRuntimeConfig['production'];
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: Parameters<CycleSubtaskCompletionPolicy>[0]['selectedSubtask'];
  readonly simulationResults: Parameters<CycleSubtaskCompletionPolicy>[0]['simulationResults'];
}): ReturnType<CycleSubtaskCompletionPolicy> {
  const targetCommodityName = resolveProductionTargetCommodityName({
    context: input.context,
    selectedSubtask: input.selectedSubtask,
    ...(input.config === undefined ? {} : { config: input.config }),
  });
  const productionAction = input.simulationResults
    .map((result) => acceptedActionFromSimulationResult(result))
    .find(isAgentProduceAction);
  if (productionAction === undefined) {
    return { status: 'completed' };
  }

  const producedCommodityName = productionAction.payload.commodityName;
  if (producedCommodityName === targetCommodityName) {
    return { status: 'completed' };
  }

  return {
    status: 'in-progress',
    reason: `produced upstream material ${producedCommodityName} for target ${targetCommodityName}`,
  };
}

function decideResidentialSubtaskCompletion(input: {
  readonly config?: CanonicalDomainRuntimeConfig['residential'];
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: Parameters<CycleSubtaskCompletionPolicy>[0]['selectedSubtask'];
  readonly simulationResults: Parameters<CycleSubtaskCompletionPolicy>[0]['simulationResults'];
}): ReturnType<CycleSubtaskCompletionPolicy> | undefined {
  const residentialAction = input.simulationResults
    .map((result) => acceptedActionFromSimulationResult(result))
    .find(isAgentUpgradeResidentialTierAction);
  if (residentialAction === undefined) {
    return undefined;
  }

  const targetResidentialTier = resolveResidentialTargetTier({
    context: input.context,
    selectedSubtask: input.selectedSubtask,
    ...(input.config === undefined ? {} : { config: input.config }),
  });
  const upgradedResidentialTier = residentialAction.payload.targetResidentialTier;
  if (upgradedResidentialTier >= targetResidentialTier) {
    return { status: 'completed' };
  }

  return {
    status: 'in-progress',
    reason: `upgraded residential tier to ${upgradedResidentialTier} toward required tier ${targetResidentialTier}`,
  };
}

function acceptedActionFromSimulationResult(
  result: ActionWithRepairResult,
): AtomicActionProposal | undefined {
  switch (result.status) {
    case 'accepted':
      return result.action;
    case 'repaired':
      return result.repairedAction;
    case 'needs-replan':
      return undefined;
  }
}

function isAgentProduceAction(
  action: AtomicActionProposal | undefined,
): action is AtomicActionProposal<'AgentProduce', AgentProducePayload> {
  return action !== undefined && action.commandType === 'AgentProduce';
}

function isAgentMoveToAction(
  action: AtomicActionProposal | undefined,
): action is AtomicActionProposal<'AgentMoveTo', AgentMoveToPayload> {
  return action !== undefined && action.commandType === 'AgentMoveTo';
}

function isAgentObserveLocationAction(
  action: AtomicActionProposal | undefined,
): action is AtomicActionProposal<'AgentObserveLocation', AgentObserveLocationPayload> {
  return action !== undefined && action.commandType === 'AgentObserveLocation';
}

function isAgentUpgradeResidentialTierAction(
  action: AtomicActionProposal | undefined,
): action is AtomicActionProposal<
  'AgentUpgradeResidentialTier',
  AgentUpgradeResidentialTierPayload
> {
  return action !== undefined && action.commandType === 'AgentUpgradeResidentialTier';
}

export function createWorldCommandDryRunSimulator(
  config: WorldCommandDryRunSimulatorConfig,
): CycleActionSimulator {
  let rolloutProjection = config.projection;
  let counterfactualStep = 0;
  let projectionEventCount = 0;

  return ({ action }) => {
    counterfactualStep += 1;
    const projectionEventCountBefore = projectionEventCount;
    try {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id: `${config.commandIdPrefix ?? DEFAULT_DRY_RUN_COMMAND_ID_PREFIX}-${action.id}`,
          simulationId: config.simulationId,
          actorId: config.agentId,
          source: 'agent-runtime',
          type: action.commandType,
          payload: action.payload,
          issuedAt: config.issuedAt ?? rolloutProjection.clock.now,
        }),
        projection: rolloutProjection,
        policies: resolveWorldCommandPolicies({
          policies: config.policies,
          projection: rolloutProjection,
        }),
        nextSequence: config.nextSequence ?? DEFAULT_DRY_RUN_SEQUENCE,
      });
      const rejection = events.find((event) => event.type === 'ActionRejected');
      if (rejection !== undefined && rejection.type === 'ActionRejected') {
        return {
          status: 'rejected',
          action,
          reason: rejection.payload.reason,
          traceEvents: events.map((event) =>
            mapWorldEventTrace(event, {
              counterfactualStep,
              projectionEventCountBefore,
              projectionEventCountAfter: projectionEventCountBefore,
            }),
          ),
        };
      }

      rolloutProjection = events.reduce(applyWorldEvent, rolloutProjection);
      projectionEventCount += events.length;

      return {
        status: 'accepted',
        action,
        traceEvents: events.map((event) =>
          mapWorldEventTrace(event, {
            counterfactualStep,
            projectionEventCountBefore,
            projectionEventCountAfter: projectionEventCount,
          }),
        ),
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

function mapWorldEventTrace(
  event: WorldEvent,
  rollout: {
    readonly counterfactualStep: number;
    readonly projectionEventCountBefore: number;
    readonly projectionEventCountAfter: number;
  },
): ActionSimulationTraceEvent {
  const summary = summarizeWorldEvent(event);
  return {
    type: event.type,
    sequence: event.sequence,
    ...(summary === undefined ? {} : { summary }),
    ...rollout,
  };
}

function summarizeWorldEvent(event: WorldEvent): string | undefined {
  switch (event.type) {
    case 'ActionRejected':
      return event.payload.reason;
    case 'InventoryChanged':
      return `${event.payload.reason} ${event.payload.itemName} ${formatSignedNumber(
        event.payload.delta,
      )}`;
    case 'PhysiologyChanged':
      return event.payload.reason;
    case 'EducationChanged':
      return event.payload.reason;
    case 'ShortTermMemoryRecorded':
      return event.payload.record.summary;
    case 'TradeExecuted':
      return `${event.payload.side} ${event.payload.commodityName} ${event.payload.commodityQuantity}`;
    case 'CommodityProduced':
      return Object.entries(event.payload.produced)
        .map(([itemName, quantity]) => `${itemName} ${formatSignedNumber(quantity)}`)
        .join(', ');
    case 'WagePaid':
      return `${event.payload.occupationName} ${formatSignedNumber(event.payload.amount)}`;
    default:
      return undefined;
  }
}

function formatSignedNumber(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}
