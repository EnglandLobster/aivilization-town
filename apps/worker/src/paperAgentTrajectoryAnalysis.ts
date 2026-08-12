import { calculateNetWorth } from '@aivilization/economy';
import {
  createPaperAgentTrajectoryArtifact,
  type PaperAgentEducationInvestmentObservation,
  type PaperAgentGuidanceObservation,
  type PaperAgentOccupationTransitionObservation,
  type PaperAgentResidentialTransitionObservation,
  type PaperAgentTrajectoryArtifact,
  type PaperAgentTrajectoryRun,
  type PaperAgentTrajectorySnapshot,
  type SteeringTrace,
} from '@aivilization/observability';
import type { WorldEvent, WorldProjection } from '@aivilization/world';

export type PaperOccupationTierDefinition = {
  readonly occupationId: string;
  readonly occupationTier: number;
};

export type WorkerPaperAgentTrajectoryAnalysisInput = {
  readonly run: PaperAgentTrajectoryRun;
  readonly initialProjection: WorldProjection;
  readonly finalProjection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly steeringTraces: readonly SteeringTrace[];
  readonly occupationTiers: readonly PaperOccupationTierDefinition[];
  readonly earlyWindowFraction?: number;
  readonly highStatusMinimumOccupationTier?: number;
};

export function createWorkerPaperAgentTrajectoryArtifact(
  input: WorkerPaperAgentTrajectoryAnalysisInput,
): PaperAgentTrajectoryArtifact {
  if (input.initialProjection.clock.now !== input.run.experimentStartedAt) {
    throw new Error('initialProjection clock must match run experimentStartedAt');
  }
  if (input.finalProjection.clock.now !== input.run.experimentEndedAt) {
    throw new Error('finalProjection clock must match run experimentEndedAt');
  }
  const occupationTierById = createOccupationTierMap(input.occupationTiers);
  const events = normalizeRunEvents(input.events, input.run);
  const guidance = createGuidanceObservations(input.steeringTraces, input.run);

  return createPaperAgentTrajectoryArtifact({
    run: input.run,
    initialSnapshot: createTrajectorySnapshot(
      input.initialProjection,
      input.run.experimentStartedAt,
      occupationTierById,
    ),
    finalSnapshot: createTrajectorySnapshot(
      input.finalProjection,
      input.run.experimentEndedAt,
      occupationTierById,
    ),
    guidance,
    educationInvestments: createEducationInvestmentObservations(events),
    occupationTransitions: createOccupationTransitionObservations(events, occupationTierById),
    residentialTransitions: createResidentialTransitionObservations(events),
    ...(input.earlyWindowFraction === undefined
      ? {}
      : { earlyWindowFraction: input.earlyWindowFraction }),
    ...(input.highStatusMinimumOccupationTier === undefined
      ? {}
      : { highStatusMinimumOccupationTier: input.highStatusMinimumOccupationTier }),
  });
}

export function createTrajectorySnapshot(
  projection: WorldProjection,
  observedAt: number,
  occupationTierById: ReadonlyMap<string, number>,
): PaperAgentTrajectorySnapshot[] {
  if (projection.clock.now !== observedAt) {
    throw new Error('trajectory snapshot observedAt must match projection clock');
  }
  const pools = Object.values(projection.marketPools);
  return Object.values(projection.agents)
    .sort((left, right) => left.agentId.localeCompare(right.agentId))
    .map((agent) => {
      const occupationTier =
        agent.job === null ? 0 : requireOccupationTier(agent.job, occupationTierById);
      return {
        agentId: agent.agentId,
        observedAt,
        educationScore: agent.educationScore,
        netWorth: calculateNetWorth({
          currencyBalance: agent.balance,
          inventory: agent.inventory,
          pools,
        }),
        residentialTier: agent.residentialTier,
        ...(agent.job === null ? {} : { occupationId: agent.job }),
        occupationTier,
      };
    });
}

export function createGuidanceObservations(
  traces: readonly SteeringTrace[],
  run: PaperAgentTrajectoryRun,
): PaperAgentGuidanceObservation[] {
  return traces
    .filter((trace) => {
      if (trace.simulationId !== run.simulationId) {
        throw new Error(
          `steering trace simulationId ${trace.simulationId} must match run ${run.simulationId}`,
        );
      }
      return (
        trace.resultKind === 'long-horizon-objective-set' &&
        trace.issuedAt >= run.experimentStartedAt &&
        trace.issuedAt <= run.experimentEndedAt
      );
    })
    .map((trace) => {
      if (
        trace.agentId === undefined ||
        trace.objectiveId === undefined ||
        trace.objectiveStatement === undefined ||
        trace.objectiveAffinityTags === undefined
      ) {
        throw new Error(
          `long-horizon steering trace ${trace.traceId} lacks objective content required for trajectory analysis`,
        );
      }
      return {
        traceId: trace.traceId,
        commandId: trace.commandId,
        objectiveId: trace.objectiveId,
        ...(trace.planId === undefined ? {} : { planId: trace.planId }),
        agentId: trace.agentId,
        source: trace.source,
        issuedAt: trace.issuedAt,
        statement: trace.objectiveStatement,
        affinityTags: [...trace.objectiveAffinityTags],
      };
    })
    .sort((left, right) => {
      if (left.issuedAt !== right.issuedAt) {
        return left.issuedAt - right.issuedAt;
      }
      return left.traceId.localeCompare(right.traceId);
    });
}

export function createEducationInvestmentObservations(
  events: readonly WorldEvent[],
): PaperAgentEducationInvestmentObservation[] {
  const paymentByCommandId = new Map<
    string,
    Extract<WorldEvent, { readonly type: 'EducationInvestmentPaid' }>
  >();
  for (const event of events) {
    if (event.type !== 'EducationInvestmentPaid') {
      continue;
    }
    const commandId = requireEventCommandId(event);
    if (paymentByCommandId.has(commandId)) {
      throw new Error(`duplicate EducationInvestmentPaid commandId ${commandId}`);
    }
    paymentByCommandId.set(commandId, event);
  }

  const consumedPaymentCommandIds = new Set<string>();
  const observations = events.flatMap((event) => {
    if (event.type !== 'EducationChanged') {
      return [];
    }
    const commandId = requireEventCommandId(event);
    const payment = paymentByCommandId.get(commandId);
    if (payment === undefined) {
      throw new Error(
        `EducationChanged ${event.id} lacks EducationInvestmentPaid evidence for command ${commandId}`,
      );
    }
    if (payment.payload.agentId !== event.payload.agentId) {
      throw new Error(`education investment command ${commandId} has inconsistent agent IDs`);
    }
    if (payment.occurredAt !== event.occurredAt) {
      throw new Error(`education investment command ${commandId} has inconsistent timestamps`);
    }
    consumedPaymentCommandIds.add(commandId);
    return [
      {
        agentId: event.payload.agentId,
        commandId,
        eventIds: [payment.id, event.id],
        occurredAt: event.occurredAt,
        durationSeconds: payment.payload.durationSeconds,
        currencyCost: payment.payload.currencyCost,
        previousEducationScore: event.payload.previousEducationScore,
        nextEducationScore: event.payload.nextEducationScore,
      },
    ];
  });

  for (const commandId of paymentByCommandId.keys()) {
    if (!consumedPaymentCommandIds.has(commandId)) {
      throw new Error(
        `EducationInvestmentPaid command ${commandId} lacks EducationChanged outcome evidence`,
      );
    }
  }
  return observations.sort(compareOccurredAtThenCommandId);
}

export function createOccupationTransitionObservations(
  events: readonly WorldEvent[],
  occupationTierById: ReadonlyMap<string, number>,
): PaperAgentOccupationTransitionObservation[] {
  return events
    .flatMap((event) => {
      if (event.type !== 'JobAssigned') {
        return [];
      }
      return [
        {
          agentId: event.payload.agentId,
          ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
          eventId: event.id,
          occurredAt: event.occurredAt,
          ...(event.payload.previousJob === null
            ? {}
            : { previousOccupationId: event.payload.previousJob }),
          previousOccupationTier:
            event.payload.previousJob === null
              ? 0
              : requireOccupationTier(event.payload.previousJob, occupationTierById),
          nextOccupationId: event.payload.occupationName,
          nextOccupationTier: requireOccupationTier(
            event.payload.occupationName,
            occupationTierById,
          ),
        },
      ];
    })
    .sort(compareOccurredAtThenEventId);
}

export function createResidentialTransitionObservations(
  events: readonly WorldEvent[],
): PaperAgentResidentialTransitionObservation[] {
  return events
    .flatMap((event) => {
      if (event.type !== 'ResidentialTierUpgraded') {
        return [];
      }
      return [
        {
          agentId: event.payload.agentId,
          ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
          eventId: event.id,
          occurredAt: event.occurredAt,
          previousResidentialTier: event.payload.previousResidentialTier,
          nextResidentialTier: event.payload.nextResidentialTier,
        },
      ];
    })
    .sort(compareOccurredAtThenEventId);
}

function normalizeRunEvents(
  events: readonly WorldEvent[],
  run: PaperAgentTrajectoryRun,
): WorldEvent[] {
  return [...events]
    .filter((event) => {
      if (event.simulationId !== run.simulationId) {
        throw new Error(
          `event simulationId ${event.simulationId} must match run ${run.simulationId}`,
        );
      }
      return (
        event.occurredAt >= run.experimentStartedAt &&
        event.occurredAt <= run.experimentEndedAt
      );
    })
    .sort((left, right) => {
      if (left.occurredAt !== right.occurredAt) {
        return left.occurredAt - right.occurredAt;
      }
      if (left.sequence !== right.sequence) {
        return left.sequence - right.sequence;
      }
      return left.id.localeCompare(right.id);
    });
}

function createOccupationTierMap(
  definitions: readonly PaperOccupationTierDefinition[],
): ReadonlyMap<string, number> {
  if (definitions.length === 0) {
    throw new Error('occupationTiers requires at least one definition');
  }
  const tiers = new Map<string, number>();
  for (const definition of definitions) {
    if (definition.occupationId.trim().length === 0) {
      throw new Error('occupationTier occupationId must not be empty');
    }
    if (
      !Number.isInteger(definition.occupationTier) ||
      definition.occupationTier < 1 ||
      definition.occupationTier > 6
    ) {
      throw new Error('occupationTier must be an integer from 1 to 6');
    }
    if (tiers.has(definition.occupationId)) {
      throw new Error(`duplicate occupationTier definition ${definition.occupationId}`);
    }
    tiers.set(definition.occupationId, definition.occupationTier);
  }
  return tiers;
}

function requireOccupationTier(
  occupationId: string,
  occupationTierById: ReadonlyMap<string, number>,
): number {
  const tier = occupationTierById.get(occupationId);
  if (tier === undefined) {
    throw new Error(`missing occupation tier for ${occupationId}`);
  }
  return tier;
}

function requireEventCommandId(event: WorldEvent): string {
  if (event.commandId === undefined) {
    throw new Error(`${event.type} ${event.id} requires commandId provenance`);
  }
  return event.commandId;
}

function compareOccurredAtThenCommandId(
  left: PaperAgentEducationInvestmentObservation,
  right: PaperAgentEducationInvestmentObservation,
): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt - right.occurredAt;
  }
  return left.commandId.localeCompare(right.commandId);
}

function compareOccurredAtThenEventId<
  TValue extends { readonly occurredAt: number; readonly eventId: string },
>(left: TValue, right: TValue): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt - right.occurredAt;
  }
  return left.eventId.localeCompare(right.eventId);
}
