import { advanceClock, createSeededRandom, rollProbabilityPercent } from '@aivilization/sim-core';
import {
  decayExternalTradeBalance,
  rebalanceMarketPoolLiquidity,
  validateExternalTradePolicy,
  type ExternalMarketLiquidityPolicy,
  type ExternalTradePolicy,
} from '@aivilization/economy';
import type { AgentId, CommandEnvelope } from '@aivilization/sim-core';
import type { EnterprisePolicy } from '@aivilization/enterprise';
import type { CreditPolicy } from '@aivilization/credit';
import {
  applySleepDeprivationHealthDecay,
  applyStochasticIllnessHealthDecay,
  calculateStochasticIllnessProbabilityPercent,
  calculateCompletedRecruitmentCycleNumbers,
  evaluateAutomaticPromotion,
  evaluateEducationExamCycle,
  evaluatePhysiologicalSafetyNet,
  evaluateResidentialArrears,
  evaluateResidentialUpkeep,
  evaluateSafetyNetSubsidy,
  settlePublicBudget,
  resolveRecruitmentCycle,
  type EducationSystemPolicy,
  type EducationLevel,
  type PhysiologicalSafetyNetPolicy,
  type RecruitmentCyclePolicy,
  type PublicBudgetPolicy,
  type ResidentialUpkeepPolicy,
  type SafetyNetSubsidyPolicy,
  type SleepDeprivationHealthDecayPolicy,
  type StochasticIllnessPolicy,
  type ConsumptionPolicy,
  type TaxPolicy,
} from '@aivilization/society';
import { assertAdvanceSimulationTimePayload } from '../commands';
import type { WorldEvent } from '../events';
import { applyWorldEvent, type WorldAgentState, type WorldProjection } from '../projection';
import {
  assertTownWeatherPolicy,
  isTownWeatherTransitionDue,
  sampleTownWeatherTransition,
  type TownWeatherPolicy,
} from '../weather';
import { appendDueBulletinEvents } from './bulletin';
import { appendMatterClosureWithSocialOutcome } from './matters';
import { appendCompletedTravelArrivals } from './movement';
import { appendEnterpriseLifecycleEvents } from './enterpriseLifecycle';
import { appendCreditAccrualEvents } from './creditLifecycle';
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
  readonly consumption?: ConsumptionPolicy;
  readonly externalMarket?: ExternalMarketLiquidityPolicy;
  readonly externalTrade?: ExternalTradePolicy;
  readonly publicBudget?: PublicBudgetPolicy;
  readonly enterprise?: EnterprisePolicy;
  readonly tax?: TaxPolicy;
  readonly credit?: CreditPolicy;
  /**
   * Discrete education-system policy. When enabled, each settled agent whose
   * score crossed the next compulsory threshold automatically advances one
   * level (EducationLevelChanged), and each crossed exam-cycle boundary
   * resolves the pending exam applications of that cycle (EducationExamResolved
   * + EducationExamCycleCompleted). Absent or disabled never emits education
   * events, keeping legacy runs byte-for-byte.
   */
  readonly educationSystem?: EducationSystemPolicy;
  readonly timeSettlementAmortization?: { readonly buckets: number };
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
  appendExpiredDurableGoodEvents({ input, events, nextSimulationTime: next.now });
  appendExternalMarketRebalanceEvents({
    input,
    events,
    previousSimulationTime: previous.now,
    nextSimulationTime: next.now,
  });
  appendExternalTradeBalanceDecayEvents({
    input,
    events,
    previousSimulationTime: previous.now,
    nextSimulationTime: next.now,
  });
  appendPublicBudgetEvents({
    input,
    events,
    previousSimulationTime: previous.now,
    nextSimulationTime: next.now,
  });
  appendEnterpriseLifecycleEvents({
    command: input.command,
    projection: input.projection,
    nextSequence: input.nextSequence,
    events,
    previousSimulationTime: previous.now,
    nextSimulationTime: next.now,
    ...(input.enterprise === undefined ? {} : { policy: input.enterprise }),
    ...(input.tax === undefined ? {} : { tax: input.tax }),
  });

  if (
    input.sleepDeprivation === undefined &&
    input.stochasticIllness === undefined &&
    input.weather === undefined &&
    input.residentialUpkeep === undefined &&
    input.safetyNetSubsidy === undefined &&
    input.physiologicalSafetyNet === undefined &&
    input.recruitmentCycle === undefined &&
    input.credit === undefined &&
    input.educationSystem?.enabled !== true
  ) {
    return events;
  }

  const allAgents = Object.values(input.projection.agents).sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  );
  const physiologyByAgent = new Map<AgentId, WorldAgentState['physiology']>();
  const balanceByAgent = new Map<AgentId, number>();
  const arrearsByAgent = new Map<AgentId, number>();
  const tierByAgent = new Map<AgentId, number>();

  // Optional per-agent settlement amortization: each agent settles only when its
  // stable bucket matches the current tick. Missed cadences are replayed one by
  // one so probabilistic and stateful effects retain their per-tick semantics.
  const amortization = input.timeSettlementAmortization;
  if (amortization !== undefined) {
    if (!Number.isInteger(amortization.buckets) || amortization.buckets < 1) {
      throw new Error('timeSettlementAmortization.buckets must be a positive integer');
    }
    if (payload.deltaMs <= 0) {
      throw new Error('timeSettlementAmortization requires a positive deltaMs cadence');
    }
  }
  const settlementTickIndex =
    amortization === undefined ? 0 : Math.floor(next.now / payload.deltaMs);
  const previousSettledAt = (agent: WorldAgentState): number =>
    input.projection.timeSettlementByAgent?.[agent.agentId] ??
    agent.registration?.registeredAt ??
    0;
  const shouldSettleAgent = (agent: WorldAgentState): boolean =>
    amortization === undefined ||
    settlementTickIndex % amortization.buckets ===
      hashAgentSettlementBucket(agent.agentId) % amortization.buckets;
  const settlementIntervalsByAgent = new Map(
    allAgents.map((agent) => [
      agent.agentId,
      shouldSettleAgent(agent)
        ? amortization === undefined
          ? [{ previousSimulationTime: previous.now, currentSimulationTime: next.now }]
          : createSettlementIntervals({
              previousSettledAt: previousSettledAt(agent),
              nextSettledAt: next.now,
              cadenceMs: payload.deltaMs,
            })
        : [],
    ]),
  );
  const settlementTimes = [
    ...new Set(
      [...settlementIntervalsByAgent.values()].flatMap((intervals) =>
        intervals.map((interval) => interval.currentSimulationTime),
      ),
    ),
  ].sort((left, right) => left - right);
  let settlementProjection = input.projection;
  // Running town-bank state across settlement times; the credit domain decides
  // each accrual boundary and this adapter applies the emitted events locally
  // so subsequent boundaries settle against the evolved book.
  let creditBank = input.projection.bank;

  for (const currentSettlementTime of settlementTimes) {
    const eventStart = events.length;
    const agents = allAgents
      .filter(
        (agent) =>
          settlementIntervalsByAgent
            .get(agent.agentId)
            ?.some((interval) => interval.currentSimulationTime === currentSettlementTime) === true,
      )
      .map((agent) => settlementProjection.agents[agent.agentId] ?? agent);
    const currentInterval = (agent: WorldAgentState) => {
      const interval = settlementIntervalsByAgent
        .get(agent.agentId)
        ?.find((candidate) => candidate.currentSimulationTime === currentSettlementTime);
      if (interval === undefined) {
        throw new Error(`missing settlement interval for agent ${agent.agentId}`);
      }
      return interval;
    };
    const agentDurationSeconds = (agent: WorldAgentState): number => {
      const interval = currentInterval(agent);
      return (interval.currentSimulationTime - interval.previousSimulationTime) / 1000;
    };

    if (input.sleepDeprivation !== undefined) {
      for (const agent of agents) {
        if (!shouldSettleAgent(agent)) {
          continue;
        }
        appendPhysiologyTimeEffect({
          input,
          events,
          physiologyByAgent,
          agent,
          reason: 'sleep-deprivation',
          nextPhysiology: applySleepDeprivationHealthDecay({
            ...getCurrentPhysiology(physiologyByAgent, agent),
            durationSeconds: agentDurationSeconds(agent),
            energyThreshold: input.sleepDeprivation.energyThreshold,
            healthDecayPerSecond: input.sleepDeprivation.healthDecayPerSecond,
            minHealth: input.sleepDeprivation.minHealth,
          }),
        });
      }
    }

    if (input.stochasticIllness !== undefined) {
      for (const agent of agents) {
        if (!shouldSettleAgent(agent)) {
          continue;
        }
        const probabilityPercent = calculateStochasticIllnessProbabilityPercent({
          illnessProbabilityPercentPerHour:
            input.stochasticIllness.illnessProbabilityPercentPerHour,
          durationSeconds: agentDurationSeconds(agent),
        });
        const illnessOccurs = rollProbabilityPercent(
          probabilityPercent,
          createSeededRandom(
            createStochasticIllnessSeed({
              input,
              payload,
              agent,
              ...(amortization === undefined
                ? {}
                : { evaluatedAt: currentInterval(agent).currentSimulationTime }),
            }),
          ),
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

    // Automatic promotion inside the compulsory stage fires at most once per
    // agent and tick: the event sets `educationLevel`, so later settlements
    // read the promoted state from the settlement projection. Agents without a
    // recorded level climb from 0 (catch-up, one level per tick, capped at the
    // compulsory stage — exam-gated levels never auto-advance).
    if (input.educationSystem?.enabled === true) {
      const educationPolicy = input.educationSystem;
      for (const agent of agents) {
        if (!shouldSettleAgent(agent)) {
          continue;
        }
        const settledAgent = settlementProjection.agents[agent.agentId] ?? agent;
        const level = settledAgent.educationLevel ?? 0;
        const nextLevel = evaluateAutomaticPromotion({
          level,
          score: settledAgent.educationScore,
          policy: educationPolicy,
        });
        if (nextLevel === null) {
          continue;
        }
        events.push(
          makeEvent(input, events.length, 'EducationLevelChanged', {
            agentId: agent.agentId,
            previousLevel: level,
            nextLevel,
            reason: 'compulsory-automatic-promotion',
          }),
        );
      }
    }

    if (input.residentialUpkeep !== undefined) {
      for (const agent of agents) {
        if (!shouldSettleAgent(agent)) {
          continue;
        }
        const currentTier = tierByAgent.get(agent.agentId) ?? agent.residentialTier;
        const decision = evaluateResidentialUpkeep({
          residentialTier: currentTier,
          balance: getCurrentBalance(balanceByAgent, agent),
          durationSeconds: agentDurationSeconds(agent),
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

        if (decision.unpaidAmount <= 0) {
          continue;
        }
        const previousArrears = arrearsByAgent.get(agent.agentId) ?? agent.upkeepArrears ?? 0;
        const nextArrears = previousArrears + decision.unpaidAmount;
        const arrearsDecision = evaluateResidentialArrears({
          residentialTier: currentTier,
          nextArrears,
          policy: input.residentialUpkeep,
        });
        if (arrearsDecision.status === 'downgrade') {
          const downgradeOffset = events.length;
          events.push(
            makeEvent(input, downgradeOffset, 'ResidentialTierDowngraded', {
              agentId: agent.agentId,
              previousResidentialTier: arrearsDecision.previousResidentialTier,
              nextResidentialTier: arrearsDecision.nextResidentialTier,
              arrearsCleared: arrearsDecision.arrearsCleared,
              reason: 'upkeep-arrears',
            }),
          );
          events.push(
            makeMemoryEvent(input, events.length, {
              agentId: agent.agentId,
              summary: `Could not pay residential upkeep for too long and was downgraded from tier ${arrearsDecision.previousResidentialTier} to tier ${arrearsDecision.nextResidentialTier}.`,
              status: 'failed',
              sourceEventOffsets: [downgradeOffset],
              tags: ['residential-downgrade', 'upkeep-arrears'],
              consolidationHint: {
                kind: 'caution',
                patternKey: 'residential-downgrade:upkeep-arrears',
                statement:
                  'Persistently unpaid residential upkeep leads to a forced downgrade to a lower housing tier.',
              },
            }),
          );
          tierByAgent.set(agent.agentId, arrearsDecision.nextResidentialTier);
          arrearsByAgent.set(agent.agentId, 0);
        } else {
          events.push(
            makeEvent(input, events.length, 'ResidentialUpkeepArrearsUpdated', {
              agentId: agent.agentId,
              previousArrears,
              nextArrears,
              reason: 'upkeep-arrears',
            }),
          );
          arrearsByAgent.set(agent.agentId, nextArrears);
        }
      }
    }

    if (input.safetyNetSubsidy !== undefined) {
      // When the projection carries a public treasury, subsidies are paid from it
      // (transfer, supply unchanged) instead of minted; the per-tick running
      // balance tracks subsidies already emitted this tick, mirroring
      // balanceByAgent.
      const treasuryFunded = settlementProjection.treasury !== undefined;
      let treasuryBalance = settlementProjection.treasury ?? 0;
      for (const agent of agents) {
        if (!shouldSettleAgent(agent)) {
          continue;
        }
        const decision = evaluateSafetyNetSubsidy({
          balance: getCurrentBalance(balanceByAgent, agent),
          minimumBalance: input.safetyNetSubsidy.minimumBalance,
          maxSubsidy: input.safetyNetSubsidy.maxSubsidy,
          ...(treasuryFunded ? { treasuryBalance } : {}),
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
            ...(treasuryFunded ? { fundingSource: 'treasury' as const } : {}),
          }),
        );
        balanceByAgent.set(agent.agentId, decision.nextBalance);
        if (treasuryFunded) {
          treasuryBalance -= decision.amount;
        }
      }
    }

    if (input.physiologicalSafetyNet !== undefined) {
      appendPhysiologicalSafetyNetEvents({
        input,
        events,
        agents,
        physiologyByAgent,
        projection: settlementProjection,
        previousSimulationTime: (agent) => currentInterval(agent).previousSimulationTime,
        currentSimulationTime: (agent) => currentInterval(agent).currentSimulationTime,
        policy: input.physiologicalSafetyNet,
      });
    }

    // Credit daily accrual settles after household charges and safety nets so
    // auto-collection sees the agent's post-subsidy cash for the interval.
    if (input.credit !== undefined && creditBank !== undefined) {
      const settlingAgentStateById = new Map(agents.map((agent) => [agent.agentId, agent]));
      creditBank = appendCreditAccrualEvents({
        command: input.command,
        projection: input.projection,
        nextSequence: input.nextSequence,
        events,
        policy: input.credit,
        bank: creditBank,
        agents,
        balanceOf: (agentId) => {
          const agentState = settlingAgentStateById.get(agentId);
          return agentState === undefined
            ? undefined
            : getCurrentBalance(balanceByAgent, agentState);
        },
        setBalance: (agentId, balance) => {
          balanceByAgent.set(agentId, balance);
        },
        intervalFor: currentInterval,
      });
    }

    settlementProjection = events.slice(eventStart).reduce(applyWorldEvent, settlementProjection);
  }

  if (amortization !== undefined) {
    for (const agent of allAgents) {
      if (!shouldSettleAgent(agent)) {
        continue;
      }
      events.push(
        makeEvent(input, events.length, 'AgentTimeEffectsSettled', {
          agentId: agent.agentId,
          previousSettledAt: previousSettledAt(agent),
          nextSettledAt: next.now,
        }),
      );
    }
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

  if (input.educationSystem?.enabled === true) {
    appendEducationExamCycleEvents({
      input,
      events,
      previousSimulationTime: previous.now,
      nextSimulationTime: next.now,
      policy: input.educationSystem,
    });
  }

  return events;
}

function appendExpiredDurableGoodEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly nextSimulationTime: number;
}): void {
  if (input.input.consumption === undefined) {
    return;
  }
  for (const agent of Object.values(input.input.projection.agents).sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  )) {
    for (const lot of [...(agent.durableGoods ?? [])]
      .filter((candidate) => candidate.expiresAt <= input.nextSimulationTime)
      .sort(
        (left, right) => left.expiresAt - right.expiresAt || left.lotId.localeCompare(right.lotId),
      )) {
      input.events.push(
        makeEvent(input.input, input.events.length, 'DurableGoodExpired', {
          agentId: agent.agentId,
          lotId: lot.lotId,
          commodityName: lot.commodityName,
          quantity: lot.quantity,
          expiredAt: lot.expiresAt,
        }),
      );
    }
  }
}

function appendExternalMarketRebalanceEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
}): void {
  const policy = input.input.externalMarket;
  if (policy === undefined) {
    return;
  }
  const cycles = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: policy.cadenceMs,
  });
  const pools = new Map(Object.entries(input.input.projection.marketPools));
  for (const cycle of cycles) {
    const settledAt = (cycle + 1) * policy.cadenceMs;
    for (const [poolKey, pool] of [...pools.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const decision = rebalanceMarketPoolLiquidity({ pool, policy });
      if (decision.commodityReserveDelta === 0 && decision.currencyReserveDelta === 0) {
        continue;
      }
      input.events.push(
        makeEvent(input.input, input.events.length, 'ExternalMarketRebalanced', {
          policyVersion: policy.policyVersion,
          commodityName: pool.commodity,
          ...(pool.regionId === undefined ? {} : { regionId: pool.regionId }),
          poolAfter: decision.poolAfter,
          commodityReserveDelta: decision.commodityReserveDelta,
          currencyReserveDelta: decision.currencyReserveDelta,
          settledAt,
        }),
      );
      pools.set(poolKey, decision.poolAfter);
    }
  }
}

/**
 * Decays every rolling external-trade balance once per crossed policy cadence
 * boundary (global cadence, no per-agent bucketing: the balances are
 * town-wide). Compounding is applied boundary-by-boundary so multi-cadence
 * jumps reproduce per-cadence semantics exactly. No-op while the policy is
 * absent or no trade has ever created the slice.
 */
function appendExternalTradeBalanceDecayEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
}): void {
  const policy = input.input.externalTrade;
  if (policy === undefined) {
    return;
  }
  validateExternalTradePolicy(policy);
  const balances = input.input.projection.externalTrade?.balancesByCommodity;
  if (balances === undefined) {
    return;
  }
  const cycles = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: policy.cadenceMs,
  });
  let current: Readonly<Record<string, number>> = balances;
  for (const cycle of cycles) {
    const settledAt = (cycle + 1) * policy.cadenceMs;
    const next: Record<string, number> = Object.fromEntries(
      Object.entries(current).map(([commodityName, balance]) => [
        commodityName,
        decayExternalTradeBalance({ balance, policy }),
      ]),
    );
    if (
      Object.entries(next).every(([commodityName, balance]) => balance === current[commodityName])
    ) {
      continue;
    }
    input.events.push(
      makeEvent(input.input, input.events.length, 'ExternalTradeBalancesDecayed', {
        policyVersion: policy.policyVersion,
        balancesBefore: { ...current },
        balancesAfter: next,
        decayedAt: settledAt,
      }),
    );
    current = next;
  }
}

function appendPublicBudgetEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
}): void {
  const policy = input.input.publicBudget;
  if (policy === undefined) {
    return;
  }
  const cycles = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: policy.cadenceMs,
  });
  let treasury = input.input.projection.treasury ?? 0;
  for (const cycle of cycles) {
    const settledAt = (cycle + 1) * policy.cadenceMs;
    for (const decision of settlePublicBudget({ treasury, policy })) {
      input.events.push(
        makeEvent(input.input, input.events.length, 'PublicBudgetSpent', {
          policyVersion: policy.policyVersion,
          service: decision.service,
          amount: decision.amount,
          previousTreasury: decision.previousTreasury,
          nextTreasury: decision.nextTreasury,
          settledAt,
          fundingDestination: 'public-service-account',
        }),
      );
      treasury = decision.nextTreasury;
    }
  }
}

function appendPhysiologicalSafetyNetEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly agents: readonly WorldAgentState[];
  readonly physiologyByAgent: ReadonlyMap<AgentId, WorldAgentState['physiology']>;
  readonly projection: WorldProjection;
  readonly previousSimulationTime: (agent: WorldAgentState) => number;
  readonly currentSimulationTime: (agent: WorldAgentState) => number;
  readonly policy: PhysiologicalSafetyNetPolicy;
}): void {
  for (const agent of input.agents) {
    const previousDistressState = input.projection.physiologicalDistressByAgent[agent.agentId];
    const decision = evaluatePhysiologicalSafetyNet({
      previousPhysiology: agent.physiology,
      currentPhysiology: getCurrentPhysiology(input.physiologyByAgent, agent),
      inventory: agent.inventory,
      ...(previousDistressState === undefined ? {} : { previousDistressState }),
      previousSimulationTime: input.previousSimulationTime(agent),
      currentSimulationTime: input.currentSimulationTime(agent),
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
          evaluatedAt: input.currentSimulationTime(agent),
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
          evaluatedAt: input.currentSimulationTime(agent),
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
        // The submission event records the bonus-adjusted effective score as
        // the ranking fact; legacy applications rank by the raw score.
        educationScore: application.effectiveEducationScore ?? application.educationScore,
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

/**
 * 放榜 settlement of the education exam cycles (education-system-v2). Each
 * crossed exam-cycle boundary resolves every pending application of that cycle
 * through the society ranking decision, emits one EducationExamResolved per
 * application (plus an EducationLevelChanged for each admitted candidate —
 * with the track assignment on 中考 admissions — and a 金榜题名/再接再厉 memory),
 * and closes with the cycle summary. Rejected resolutions bump the agent's
 * `examAttempts` in the reducer, never here.
 */
function appendEducationExamCycleEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly policy: EducationSystemPolicy;
}): void {
  const cycleNumbers = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: input.policy.examCycleDurationMs,
  });

  for (const cycleNumber of cycleNumbers) {
    const applications = input.input.projection.educationExamApplications
      .filter(
        (application) =>
          application.cycleNumber === cycleNumber && application.status === 'pending',
      )
      .map((application) => ({
        applicationId: application.applicationId,
        agentId: application.agentId,
        targetLevel: application.targetLevel,
        educationScore: application.educationScore,
        submittedAt: application.submittedAt,
      }));
    const decision = evaluateEducationExamCycle({
      applications,
      cycleNumber,
      policy: input.policy,
    });

    for (const resolution of decision.resolutions) {
      const resolutionOffset = input.events.length;
      input.events.push(
        makeEvent(input.input, resolutionOffset, 'EducationExamResolved', {
          applicationId: resolution.applicationId,
          cycleNumber,
          agentId: resolution.agentId as AgentId,
          targetLevel: resolution.targetLevel,
          status: resolution.status,
          ...(resolution.track === undefined ? {} : { track: resolution.track }),
          ...(resolution.cutoffScore === undefined ? {} : { cutoffScore: resolution.cutoffScore }),
          reason: resolution.reason,
        }),
      );

      const sourceEventOffsets = [resolutionOffset];
      if (resolution.status === 'admitted') {
        const agent = input.input.projection.agents[resolution.agentId as AgentId];
        const promotionOffset = input.events.length;
        input.events.push(
          makeEvent(input.input, promotionOffset, 'EducationLevelChanged', {
            agentId: resolution.agentId as AgentId,
            previousLevel:
              agent?.educationLevel ?? ((resolution.targetLevel - 1) as EducationLevel),
            nextLevel: resolution.targetLevel,
            ...(resolution.track === undefined ? {} : { track: resolution.track }),
            reason: `education-exam-admission:cycle-${cycleNumber}`,
          }),
        );
        sourceEventOffsets.push(promotionOffset);
      }

      input.events.push(
        makeMemoryEvent(input.input, input.events.length, {
          agentId: resolution.agentId as AgentId,
          summary:
            resolution.status === 'admitted'
              ? `Education exam cycle ${cycleNumber} admitted you into level ${resolution.targetLevel}${resolution.track === undefined ? '' : ` (${resolution.track} track)`}.`
              : `Education exam cycle ${cycleNumber} rejected your level-${resolution.targetLevel} application: ${resolution.reason}.`,
          status: resolution.status === 'admitted' ? 'succeeded' : 'failed',
          sourceEventOffsets,
          tags: [
            'education-exam-cycle',
            `education-exam-cycle:${cycleNumber}`,
            `exam-target:${resolution.targetLevel}`,
            resolution.status,
          ],
          consolidationHint:
            resolution.status === 'admitted'
              ? {
                  kind: 'habit',
                  patternKey: `education-exam-admitted:${resolution.targetLevel}`,
                  statement: `Passed the level-${resolution.targetLevel} education exam.`,
                }
              : {
                  kind: 'caution',
                  patternKey: `education-exam-rejected:${resolution.targetLevel}:${resolution.reason}`,
                  statement: `Level-${resolution.targetLevel} exam applications can fail because ${resolution.reason}; study more and try again.`,
                },
        }),
      );
    }

    input.events.push(
      makeEvent(input.input, input.events.length, 'EducationExamCycleCompleted', {
        cycleNumber,
        cycleStartedAt: cycleNumber * input.policy.examCycleDurationMs,
        cycleEndedAt: (cycleNumber + 1) * input.policy.examCycleDurationMs,
        policyVersion: input.policy.policyVersion,
        applicationCount: decision.resolutions.length,
        admittedCount: decision.resolutions.filter((resolution) => resolution.status === 'admitted')
          .length,
        rejectedCount: decision.resolutions.filter((resolution) => resolution.status === 'rejected')
          .length,
        applicationsByLevel: Object.fromEntries(
          decision.summaries.map((summary) => [summary.targetLevel, summary.applicationCount]),
        ),
        admittedByLevel: Object.fromEntries(
          decision.summaries.map((summary) => [summary.targetLevel, summary.admittedCount]),
        ),
        cutoffScoresByLevel: Object.fromEntries(
          decision.summaries
            .filter((summary) => summary.cutoffScore !== undefined)
            .map((summary) => [summary.targetLevel, summary.cutoffScore as number]),
        ),
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

function createSettlementIntervals(input: {
  readonly previousSettledAt: number;
  readonly nextSettledAt: number;
  readonly cadenceMs: number;
}): readonly {
  readonly previousSimulationTime: number;
  readonly currentSimulationTime: number;
}[] {
  if (input.previousSettledAt > input.nextSettledAt) {
    throw new Error('agent time settlement cannot move backwards');
  }
  const intervals: Array<{
    readonly previousSimulationTime: number;
    readonly currentSimulationTime: number;
  }> = [];
  let previousSimulationTime = input.previousSettledAt;
  while (previousSimulationTime < input.nextSettledAt) {
    const nextCadenceBoundary =
      (Math.floor(previousSimulationTime / input.cadenceMs) + 1) * input.cadenceMs;
    const currentSimulationTime = Math.min(input.nextSettledAt, nextCadenceBoundary);
    intervals.push({ previousSimulationTime, currentSimulationTime });
    previousSimulationTime = currentSimulationTime;
  }
  return intervals;
}

/**
 * Stable per-agent settlement bucket (djb2). Deterministic across replays and
 * processes, independent of iteration order.
 */
export function hashAgentSettlementBucket(agentId: AgentId): number {
  let hash = 5381;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = ((hash << 5) + hash + agentId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function createStochasticIllnessSeed(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly payload: { readonly deltaMs: number };
  readonly agent: WorldAgentState;
  readonly evaluatedAt?: number;
}): string {
  return [
    'stochastic-illness',
    ...(input.input.randomSeed === undefined ? [] : [input.input.randomSeed]),
    input.input.command.simulationId,
    input.input.command.id,
    input.input.projection.clock.now,
    input.payload.deltaMs,
    ...(input.evaluatedAt === undefined ? [] : [input.evaluatedAt]),
    input.agent.agentId,
  ].join(':');
}

function appendWeatherTransitionEvent(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
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
    .filter((matter) => matter.status !== 'closed' && matter.expiresAt <= input.nextSimulationTime)
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
