import { advanceClock, createSeededRandom, rollProbabilityPercent } from '@aivilization/sim-core';
import type { AgentId, CommandEnvelope } from '@aivilization/sim-core';
import {
  applySleepDeprivationHealthDecay,
  applyStochasticIllnessHealthDecay,
  calculateStochasticIllnessProbabilityPercent,
  calculateCompletedRecruitmentCycleNumbers,
  evaluatePhysiologicalSafetyNet,
  evaluateResidentialUpkeep,
  evaluateSafetyNetSubsidy,
  resolveRecruitmentCycle,
  type PhysiologicalSafetyNetPolicy,
  type RecruitmentCyclePolicy,
  type ResidentialUpkeepPolicy,
  type SafetyNetSubsidyPolicy,
  type SleepDeprivationHealthDecayPolicy,
  type StochasticIllnessPolicy,
} from '@aivilization/society';
import { assertAdvanceSimulationTimePayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldAgentState, WorldProjection } from '../projection';
import {
  assertTownWeatherPolicy,
  isTownWeatherTransitionDue,
  sampleTownWeatherTransition,
  type TownWeatherPolicy,
} from '../weather';
import { appendDueBulletinEvents } from './bulletin';
import { appendMatterClosureWithSocialOutcome } from './matters';
import { appendCompletedTravelArrivals } from './movement';
import { isMatterExpiryWithoutBreach } from '../matters';
import { makeEvent, makeMemoryEvent } from './shared';

export function handleAdvanceSimulationTimeCommand(input: {
  readonly command: CommandEnvelope<'AdvanceSimulationTime', unknown>;
  readonly projection: WorldProjection;
  readonly randomSeed?: string;
  readonly sleepDeprivation?: SleepDeprivationHealthDecayPolicy;
  readonly stochasticIllness?: StochasticIllnessPolicy;
  readonly weather?: TownWeatherPolicy;
  readonly residentialUpkeep?: ResidentialUpkeepPolicy;
  readonly safetyNetSubsidy?: SafetyNetSubsidyPolicy;
  readonly physiologicalSafetyNet?: PhysiologicalSafetyNetPolicy;
  readonly recruitmentCycle?: RecruitmentCyclePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const payload = assertAdvanceSimulationTimePayload(input.command.payload);
  const previous = input.projection.clock;
  const next = advanceClock(previous, payload.deltaMs);
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'SimulationTimeAdvanced', {
      previous: { ...previous },
      next: { ...next },
      deltaMs: payload.deltaMs,
    }),
  ];
  appendCompletedTravelArrivals({ input, events, nextSimulationTime: next.now });
  appendDueBulletinEvents({ input, events, nextSimulationTime: next.now });
  appendMatterExpiryEvents({ input, events, nextSimulationTime: next.now });
  appendWeatherTransitionEvent({
    input,
    events,
    payload,
    nextSimulationTime: next.now,
  });

  if (
    input.sleepDeprivation === undefined &&
    input.stochasticIllness === undefined &&
    input.weather === undefined &&
    input.residentialUpkeep === undefined &&
    input.safetyNetSubsidy === undefined &&
    input.physiologicalSafetyNet === undefined &&
    input.recruitmentCycle === undefined
  ) {
    return events;
  }

  const durationSeconds = payload.deltaMs / 1000;
  const agents = Object.values(input.projection.agents).sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  );
  const physiologyByAgent = new Map<AgentId, WorldAgentState['physiology']>();
  const balanceByAgent = new Map<AgentId, number>();

  if (input.sleepDeprivation !== undefined) {
    for (const agent of agents) {
      appendPhysiologyTimeEffect({
        input,
        events,
        physiologyByAgent,
        agent,
        reason: 'sleep-deprivation',
        nextPhysiology: applySleepDeprivationHealthDecay({
          ...getCurrentPhysiology(physiologyByAgent, agent),
          durationSeconds,
          energyThreshold: input.sleepDeprivation.energyThreshold,
          healthDecayPerSecond: input.sleepDeprivation.healthDecayPerSecond,
          minHealth: input.sleepDeprivation.minHealth,
        }),
      });
    }
  }

  if (input.stochasticIllness !== undefined) {
    const probabilityPercent = calculateStochasticIllnessProbabilityPercent({
      illnessProbabilityPercentPerHour: input.stochasticIllness.illnessProbabilityPercentPerHour,
      durationSeconds,
    });
    for (const agent of agents) {
      const illnessOccurs = rollProbabilityPercent(
        probabilityPercent,
        createSeededRandom(createStochasticIllnessSeed({ input, payload, agent })),
      );
      appendPhysiologyTimeEffect({
        input,
        events,
        physiologyByAgent,
        agent,
        reason: 'stochastic-illness',
        nextPhysiology: applyStochasticIllnessHealthDecay({
          ...getCurrentPhysiology(physiologyByAgent, agent),
          illnessOccurs,
          healthDamage: input.stochasticIllness.healthDamage,
          minHealth: input.stochasticIllness.minHealth,
        }),
      });
    }
  }

  if (input.residentialUpkeep !== undefined) {
    for (const agent of agents) {
      const decision = evaluateResidentialUpkeep({
        residentialTier: agent.residentialTier,
        balance: getCurrentBalance(balanceByAgent, agent),
        durationSeconds,
        policy: input.residentialUpkeep,
      });
      if (decision.status === 'rejected') {
        throw new Error(decision.detail);
      }
      if (decision.status === 'uncharged') {
        continue;
      }
      events.push(
        makeEvent(input, events.length, 'ResidentialUpkeepCharged', {
          agentId: agent.agentId,
          residentialTier: decision.residentialTier,
          amount: decision.amount,
          unpaidAmount: decision.unpaidAmount,
          previousBalance: decision.previousBalance,
          nextBalance: decision.nextBalance,
          reason: 'residential-upkeep',
        }),
      );
      balanceByAgent.set(agent.agentId, decision.nextBalance);
    }
  }

  if (input.safetyNetSubsidy !== undefined) {
    for (const agent of agents) {
      const decision = evaluateSafetyNetSubsidy({
        balance: getCurrentBalance(balanceByAgent, agent),
        minimumBalance: input.safetyNetSubsidy.minimumBalance,
        maxSubsidy: input.safetyNetSubsidy.maxSubsidy,
      });
      if (decision.status === 'ineligible') {
        continue;
      }
      events.push(
        makeEvent(input, events.length, 'SubsidyPaid', {
          agentId: agent.agentId,
          amount: decision.amount,
          previousBalance: decision.previousBalance,
          nextBalance: decision.nextBalance,
          reason: 'safety-net',
        }),
      );
      balanceByAgent.set(agent.agentId, decision.nextBalance);
    }
  }

  if (input.physiologicalSafetyNet !== undefined) {
    appendPhysiologicalSafetyNetEvents({
      input,
      events,
      agents,
      physiologyByAgent,
      previousSimulationTime: previous.now,
      currentSimulationTime: next.now,
      policy: input.physiologicalSafetyNet,
    });
  }

  if (input.recruitmentCycle !== undefined) {
    appendRecruitmentCycleEvents({
      input,
      events,
      previousSimulationTime: previous.now,
      nextSimulationTime: next.now,
      policy: input.recruitmentCycle,
    });
  }

  return events;
}

function appendPhysiologicalSafetyNetEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly agents: readonly WorldAgentState[];
  readonly physiologyByAgent: ReadonlyMap<AgentId, WorldAgentState['physiology']>;
  readonly previousSimulationTime: number;
  readonly currentSimulationTime: number;
  readonly policy: PhysiologicalSafetyNetPolicy;
}): void {
  for (const agent of input.agents) {
    const previousDistressState =
      input.input.projection.physiologicalDistressByAgent?.[agent.agentId];
    const decision = evaluatePhysiologicalSafetyNet({
      previousPhysiology: agent.physiology,
      currentPhysiology: getCurrentPhysiology(input.physiologyByAgent, agent),
      inventory: agent.inventory,
      ...(previousDistressState === undefined ? {} : { previousDistressState }),
      previousSimulationTime: input.previousSimulationTime,
      currentSimulationTime: input.currentSimulationTime,
      policy: input.policy,
    });
    const sourceEventOffsets: number[] = [];

    if (decision.transition === 'started' || decision.transition === 'updated') {
      if (decision.distressState === null) {
        throw new Error('active physiological distress transition requires state');
      }
      const distressOffset = input.events.length;
      input.events.push(
        makeEvent(input.input, distressOffset, 'PhysiologicalDistressChanged', {
          agentId: agent.agentId,
          status: 'active',
          state: decision.distressState,
          evaluatedAt: input.currentSimulationTime,
          reason: decision.transition,
        }),
      );
      sourceEventOffsets.push(distressOffset);
    } else if (decision.transition === 'cleared') {
      if (previousDistressState === undefined) {
        throw new Error('cleared physiological distress transition requires previous state');
      }
      input.events.push(
        makeEvent(input.input, input.events.length, 'PhysiologicalDistressChanged', {
          agentId: agent.agentId,
          status: 'cleared',
          previousState: previousDistressState,
          evaluatedAt: input.currentSimulationTime,
          reason: 'recovered',
        }),
      );
    }

    if (decision.grant === null) {
      continue;
    }
    const grantOffset = input.events.length;
    input.events.push(
      makeEvent(input.input, grantOffset, 'SafetyNetGranted', {
        agentId: agent.agentId,
        policyVersion: input.policy.policyVersion,
        grantedAt: decision.grant.grantedAt,
        distressDurationMs: decision.grant.distressDurationMs,
        lowAxes: decision.grant.lowAxes,
        inventory: decision.grant.inventory,
        reason: 'persistent-physiological-distress',
      }),
    );
    sourceEventOffsets.push(grantOffset);
    input.events.push(
      makeMemoryEvent(input.input, input.events.length, {
        agentId: agent.agentId,
        summary: `Received safety-net essentials after ${decision.grant.distressDurationMs} ms of physiological distress: ${createInventorySummary(decision.grant.inventory)}.`,
        status: 'succeeded',
        sourceEventOffsets,
        tags: [
          'safety-net',
          'physiological-distress',
          ...decision.grant.lowAxes.map((axis) => `low-${axis}`),
        ],
        consolidationHint: {
          kind: 'caution',
          patternKey: `safety-net:${decision.grant.lowAxes.join('+')}`,
          statement: `Persistent low ${decision.grant.lowAxes.join(', ')} can trigger essential welfare support.`,
        },
      }),
    );
  }
}

function createInventorySummary(inventory: Readonly<Record<string, number>>): string {
  return Object.entries(inventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemName, quantity]) => `${quantity} ${itemName}`)
    .join(', ');
}

function appendRecruitmentCycleEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly policy: RecruitmentCyclePolicy;
}): void {
  const cycleNumbers = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: input.policy.cycleDurationMs,
  });
  const jobByAgent = new Map(
    Object.values(input.input.projection.agents).map(
      (agent) => [agent.agentId, agent.job] as const,
    ),
  );

  for (const cycleNumber of cycleNumbers) {
    const applications = input.input.projection.jobApplications
      .filter(
        (application) =>
          application.cycleNumber === cycleNumber && application.status === 'pending',
      )
      .map((application) => ({
        applicationId: application.applicationId,
        agentId: application.agentId,
        occupationName: application.occupationName,
        educationScore: application.educationScore,
        residentialTier: application.residentialTier,
        submittedAt: application.submittedAt,
      }));
    const decision = resolveRecruitmentCycle({ applications, policy: input.policy });
    const acceptedByApplicationId = new Map(
      decision.acceptedApplications.map((application) => [application.applicationId, application]),
    );

    for (const resolution of decision.resolutions) {
      const resolutionOffset = input.events.length;
      input.events.push(
        makeEvent(input.input, resolutionOffset, 'JobApplicationResolved', {
          applicationId: resolution.applicationId,
          cycleNumber,
          agentId: resolution.agentId as AgentId,
          occupationName: resolution.occupationName,
          status: resolution.status,
          reason: resolution.reason,
        }),
      );

      const sourceEventOffsets = [resolutionOffset];
      const accepted = acceptedByApplicationId.get(resolution.applicationId);
      if (accepted !== undefined) {
        const assignmentOffset = input.events.length;
        input.events.push(
          makeEvent(input.input, assignmentOffset, 'JobAssigned', {
            applicationId: accepted.applicationId,
            cycleNumber,
            agentId: accepted.agentId as AgentId,
            occupationName: accepted.occupationName,
            previousJob: jobByAgent.get(accepted.agentId as AgentId) ?? null,
          }),
        );
        sourceEventOffsets.push(assignmentOffset);
        jobByAgent.set(accepted.agentId as AgentId, accepted.occupationName);
      }

      input.events.push(
        makeMemoryEvent(input.input, input.events.length, {
          agentId: resolution.agentId as AgentId,
          summary:
            resolution.status === 'accepted'
              ? `Recruitment cycle ${cycleNumber} accepted the application for ${resolution.occupationName}.`
              : `Recruitment cycle ${cycleNumber} rejected the application for ${resolution.occupationName}: ${resolution.reason}.`,
          status: resolution.status === 'accepted' ? 'succeeded' : 'failed',
          sourceEventOffsets,
          tags: [
            'recruitment-cycle',
            `recruitment-cycle:${cycleNumber}`,
            resolution.occupationName,
            resolution.status,
          ],
          consolidationHint:
            resolution.status === 'accepted'
              ? {
                  kind: 'habit',
                  patternKey: `recruitment-accepted:${resolution.occupationName}`,
                  statement: `Competes successfully for ${resolution.occupationName}.`,
                }
              : {
                  kind: 'caution',
                  patternKey: `recruitment-rejected:${resolution.occupationName}:${resolution.reason}`,
                  statement: `${resolution.occupationName} applications can be rejected because ${resolution.reason}.`,
                },
        }),
      );
    }

    input.events.push(
      makeEvent(input.input, input.events.length, 'RecruitmentCycleCompleted', {
        cycleNumber,
        cycleStartedAt: cycleNumber * input.policy.cycleDurationMs,
        cycleEndedAt: (cycleNumber + 1) * input.policy.cycleDurationMs,
        policyVersion: input.policy.policyVersion,
        applicationCount: decision.resolutions.length,
        acceptedCount: decision.acceptedApplications.length,
        rejectedCount: decision.resolutions.length - decision.acceptedApplications.length,
      }),
    );
  }
}

export function appendPhysiologyTimeEffect(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly physiologyByAgent: Map<AgentId, WorldAgentState['physiology']>;
  readonly agent: WorldAgentState;
  readonly reason: string;
  readonly nextPhysiology: WorldAgentState['physiology'];
}): void {
  const previousPhysiology = getCurrentPhysiology(input.physiologyByAgent, input.agent);
  if (isSamePhysiology(previousPhysiology, input.nextPhysiology)) {
    return;
  }

  input.events.push(
    makeEvent(input.input, input.events.length, 'PhysiologyChanged', {
      agentId: input.agent.agentId,
      previous: previousPhysiology,
      next: input.nextPhysiology,
      reason: input.reason,
    }),
  );
  input.physiologyByAgent.set(input.agent.agentId, input.nextPhysiology);
}

export function getCurrentPhysiology(
  physiologyByAgent: ReadonlyMap<AgentId, WorldAgentState['physiology']>,
  agent: WorldAgentState,
): WorldAgentState['physiology'] {
  return physiologyByAgent.get(agent.agentId) ?? agent.physiology;
}

export function getCurrentBalance(
  balanceByAgent: ReadonlyMap<AgentId, number>,
  agent: WorldAgentState,
): number {
  return balanceByAgent.get(agent.agentId) ?? agent.balance;
}

export function isSamePhysiology(
  left: WorldAgentState['physiology'],
  right: WorldAgentState['physiology'],
): boolean {
  return (
    left.energy === right.energy && left.satiety === right.satiety && left.health === right.health
  );
}

function createStochasticIllnessSeed(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly payload: { readonly deltaMs: number };
  readonly agent: WorldAgentState;
}): string {
  return [
    'stochastic-illness',
    ...(input.input.randomSeed === undefined ? [] : [input.input.randomSeed]),
    input.input.command.simulationId,
    input.input.command.id,
    input.input.projection.clock.now,
    input.payload.deltaMs,
    input.agent.agentId,
  ].join(':');
}

function appendWeatherTransitionEvent(input: {  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly payload: { readonly deltaMs: number };
  readonly nextSimulationTime: number;
}): void {
  const policy = input.input.weather;
  if (policy === undefined) {
    return;
  }
  assertTownWeatherPolicy(policy);
  if (
    !isTownWeatherTransitionDue({
      transitionCadenceMs: policy.transitionCadenceMs,
      previousSimulationTime: input.input.projection.clock.now,
      nextSimulationTime: input.nextSimulationTime,
    })
  ) {
    return;
  }
  const current = input.input.projection.weather?.current ?? policy.initialWeather;
  const next = sampleTownWeatherTransition({
    policy,
    current,
    rng: createSeededRandom(createWeatherTransitionSeed(input)),
  });
  if (next === current) {
    return;
  }
  input.events.push(
    makeEvent(input.input, input.events.length, 'WeatherChanged', {
      policyVersion: policy.policyVersion,
      from: current,
      to: next,
      transitionedAt: input.nextSimulationTime,
    }),
  );
}

function createWeatherTransitionSeed(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly payload: { readonly deltaMs: number };
}): string {
  return [
    'town-weather',
    ...(input.input.randomSeed === undefined ? [] : [input.input.randomSeed]),
    input.input.command.simulationId,
    input.input.command.id,
    input.input.projection.clock.now,
    input.payload.deltaMs,
  ].join(':');
}

/** Expiry settlement during time advance (data-driven; no-op on legacy runs). */
function appendMatterExpiryEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly nextSimulationTime: number;
}): void {
  const due = Object.values(input.input.projection.socialMatters ?? {})
    .filter(
      (matter) => matter.status !== 'closed' && matter.expiresAt <= input.nextSimulationTime,
    )
    .sort(
      (left, right) =>
        left.expiresAt - right.expiresAt || left.matterId.localeCompare(right.matterId),
    );
  for (const matter of due) {
    if (isMatterExpiryWithoutBreach(matter.status)) {
      input.events.push(
        makeEvent(input.input, input.events.length, 'MatterClosed', {
          matterId: matter.matterId,
          closure: 'expired',
          closedAt: input.input.command.issuedAt,
        }),
      );
      continue;
    }
    // assigned/executing matters expired: the assignee defaulted — breach with
    // the canonical betrayal outcome.
    appendMatterClosureWithSocialOutcome({
      input: input.input,
      events: input.events,
      matter,
      closure: 'breached',
      signal: 'betrayal',
    });
  }
}
