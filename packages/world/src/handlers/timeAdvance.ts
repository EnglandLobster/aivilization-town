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
  assertValidLandValuePolicy,
  calculateStochasticIllnessProbabilityPercent,
  calculateCompletedRecruitmentCycleNumbers,
  evaluatePhysiologicalSafetyNet,
  evaluateRegionalLandValue,
  evaluateResidentialArrears,
  evaluateResidentialUpkeep,
  evaluateSafetyNetSubsidy,
  resolveResidentialUpkeepRate,
  settlePublicBudget,
  resolveRecruitmentCycle,
  type LandValuePolicy,
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
  regionIdFromPoolKey,
  resolveAgentRegion,
  resolveMarketPoolKey,
  resolveRegionId,
} from '../regionalMarkets';
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
  readonly landValue?: LandValuePolicy;
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
  // Land value re-evaluation precedes upkeep settlement so the same tick's
  // housing charges price against the freshly updated index timeline.
  const landValue = appendRegionalLandValueEvents({
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
    input.credit === undefined
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

    if (input.residentialUpkeep !== undefined) {
      for (const agent of agents) {
        if (!shouldSettleAgent(agent)) {
          continue;
        }
        let currentTier = tierByAgent.get(agent.agentId) ?? agent.residentialTier;
        // With a land value policy the interval is segmented at every index
        // boundary and each segment priced at its own effective rate; without
        // one the whole interval prices flat (legacy v1 behavior). Arrears
        // are evaluated after each priced segment so a merged advance
        // downgrades at the same point step-by-step advances would.
        const interval = currentInterval(agent);
        const segments =
          landValue === undefined
            ? [{ durationSeconds: agentDurationSeconds(agent) }]
            : resolveUpkeepRateSegments({
                previousSimulationTime: interval.previousSimulationTime,
                currentSimulationTime: interval.currentSimulationTime,
                regionId: resolveAgentRegion({
                  projection: input.projection,
                  agentLocationId: agent.locationId,
                }),
                timeline: landValue.timeline,
              });
        for (const segment of segments) {
          const decision = evaluateResidentialUpkeep({
            residentialTier: currentTier,
            balance: getCurrentBalance(balanceByAgent, agent),
            durationSeconds: segment.durationSeconds,
            policy: input.residentialUpkeep,
            ...(segment.landValueIndex === undefined
              ? {}
              : { landValueIndex: segment.landValueIndex }),
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
          // The arrears threshold prices against the same effective rate the
          // segment charge used, so land value pressure cannot desync the two.
          const effectiveCostPerHour = resolveResidentialUpkeepRate({
            residentialTier: currentTier,
            policy: input.residentialUpkeep,
            ...(segment.landValueIndex === undefined
              ? {}
              : { landValueIndex: segment.landValueIndex }),
          });
          const arrearsDecision = evaluateResidentialArrears({
            residentialTier: currentTier,
            nextArrears,
            policy: input.residentialUpkeep,
            ...(effectiveCostPerHour === undefined ? {} : { effectiveCostPerHour }),
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
            currentTier = arrearsDecision.nextResidentialTier;
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

/**
 * Re-evaluates the smoothed per-region land value index at every policy
 * cadence boundary crossed by this advance. Multiple crossed boundaries are
 * replayed one lerp step at a time (the smoothing is stateful and must not be
 * merged, matching the public-budget cadence pattern). Returns the index
 * timeline — initial projection slice plus one snapshot per crossed boundary —
 * so the same tick's residential upkeep can price each time segment against
 * the index that was in effect for it (merging a stateful rate across a
 * boundary would violate cadence equivalence). Undefined when no land value
 * policy is active (flat v1 upkeep pricing).
 */
type RegionalLandValueTimeline = readonly {
  /** Boundary the snapshot took effect at; NEGATIVE_INFINITY for the initial slice. */
  readonly settledAt: number;
  readonly indexByRegion: Readonly<Record<string, number>>;
}[];

function appendRegionalLandValueEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
}): { readonly timeline: RegionalLandValueTimeline } | undefined {
  const policy = input.input.landValue;
  if (policy === undefined) {
    return undefined;
  }
  assertValidLandValuePolicy(policy);
  const projection = input.input.projection;
  const landValueByRegion = new Map<string, number>(
    Object.entries(projection.regionalLandValues ?? {}),
  );
  const timeline: {
    settledAt: number;
    indexByRegion: Readonly<Record<string, number>>;
  }[] = [
    {
      // The projection slice keeps only the latest index per region, so
      // amortized catch-up intervals reaching back before this command settle
      // at the latest known index. That matches the amortization convention
      // of pricing elapsed time with settlement-time state (the same way
      // policy rates apply); exact historical pricing would require retaining
      // index history beyond the slice.
      settledAt: Number.NEGATIVE_INFINITY,
      indexByRegion: Object.fromEntries(landValueByRegion),
    },
  ];

  // Regional inputs evolve across the boundaries of a merged advance: travel
  // arrivals and external-market rebalances taking effect inside the window
  // are applied boundary by boundary, mirroring what step-by-step advances
  // would observe from the projection. An effect becomes visible to a
  // boundary only after the canonical tick containing it has completed, hence
  // the one-tick horizon behind each boundary.
  const tickDurationMs = projection.clock.tickDurationMs;
  const regionByAgent = new Map<AgentId, string>();
  const agentCountByRegion = new Map<string, number>();
  for (const agent of Object.values(projection.agents)) {
    const regionId = resolveAgentRegion({ projection, agentLocationId: agent.locationId });
    regionByAgent.set(agent.agentId, regionId);
    agentCountByRegion.set(regionId, (agentCountByRegion.get(regionId) ?? 0) + 1);
  }
  const pendingArrivals = Object.values(projection.transitByAgent ?? {})
    .filter(
      (transit) =>
        transit.arrivesAt > input.previousSimulationTime &&
        transit.arrivesAt <= input.nextSimulationTime,
    )
    .map((transit) => ({
      agentId: transit.agentId,
      arrivesAt: transit.arrivesAt,
      regionId: resolveRegionId(projection.locations[transit.toLocationId]?.regionId),
    }))
    .sort(
      (left, right) =>
        left.arrivesAt - right.arrivesAt || left.agentId.localeCompare(right.agentId),
    );

  const currencyReserveByPoolKey = new Map<string, number>();
  for (const [poolKey, pool] of Object.entries(projection.marketPools)) {
    currencyReserveByPoolKey.set(poolKey, pool.currencyReserve);
  }
  const liquidityByRegion = new Map<string, number>();
  for (const [poolKey, reserve] of currencyReserveByPoolKey) {
    const regionId = regionIdFromPoolKey(poolKey);
    liquidityByRegion.set(regionId, (liquidityByRegion.get(regionId) ?? 0) + reserve);
  }
  const pendingRebalances = input.events
    .filter(
      (event): event is Extract<WorldEvent, { type: 'ExternalMarketRebalanced' }> =>
        event.type === 'ExternalMarketRebalanced',
    )
    .map((event) => ({
      settledAt: event.payload.settledAt,
      poolKey: resolveMarketPoolKey({
        regionId: event.payload.regionId,
        commodity: event.payload.commodityName,
      }),
      currencyReserveAfter: event.payload.poolAfter.currencyReserve,
    }))
    .sort(
      (left, right) =>
        left.settledAt - right.settledAt || left.poolKey.localeCompare(right.poolKey),
    );

  const regionIds = [
    ...new Set([
      ...Object.values(projection.locations).map((location) => resolveRegionId(location.regionId)),
      ...agentCountByRegion.keys(),
      ...liquidityByRegion.keys(),
      ...landValueByRegion.keys(),
    ]),
  ].sort((left, right) => left.localeCompare(right));

  const cycles = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: policy.updateCadenceMs,
  });
  let arrivalCursor = 0;
  let rebalanceCursor = 0;
  for (const cycle of cycles) {
    const settledAt = (cycle + 1) * policy.updateCadenceMs;
    const horizon = settledAt - tickDurationMs;
    while (
      arrivalCursor < pendingArrivals.length &&
      (pendingArrivals[arrivalCursor] as (typeof pendingArrivals)[number]).arrivesAt <= horizon
    ) {
      const arrival = pendingArrivals[arrivalCursor] as (typeof pendingArrivals)[number];
      arrivalCursor += 1;
      const previousRegion = regionByAgent.get(arrival.agentId);
      if (previousRegion !== undefined && previousRegion !== arrival.regionId) {
        agentCountByRegion.set(previousRegion, (agentCountByRegion.get(previousRegion) ?? 1) - 1);
        agentCountByRegion.set(
          arrival.regionId,
          (agentCountByRegion.get(arrival.regionId) ?? 0) + 1,
        );
        regionByAgent.set(arrival.agentId, arrival.regionId);
      }
    }
    while (
      rebalanceCursor < pendingRebalances.length &&
      (pendingRebalances[rebalanceCursor] as (typeof pendingRebalances)[number]).settledAt <=
        horizon
    ) {
      const rebalance = pendingRebalances[rebalanceCursor] as (typeof pendingRebalances)[number];
      rebalanceCursor += 1;
      const regionId = regionIdFromPoolKey(rebalance.poolKey);
      const previousReserve = currencyReserveByPoolKey.get(rebalance.poolKey) ?? 0;
      currencyReserveByPoolKey.set(rebalance.poolKey, rebalance.currencyReserveAfter);
      liquidityByRegion.set(
        regionId,
        (liquidityByRegion.get(regionId) ?? 0) + rebalance.currencyReserveAfter - previousReserve,
      );
    }
    for (const regionId of regionIds) {
      const previousIndex = landValueByRegion.get(regionId) ?? policy.baseline;
      const agentCount = agentCountByRegion.get(regionId) ?? 0;
      const marketLiquidity = liquidityByRegion.get(regionId) ?? 0;
      const evaluation = evaluateRegionalLandValue({
        previousIndex,
        inputs: { agentCount, marketLiquidity },
        policy,
      });
      input.events.push(
        makeEvent(input.input, input.events.length, 'RegionalLandValueUpdated', {
          regionId,
          previousIndex,
          nextIndex: evaluation.nextIndex,
          rawIndex: evaluation.rawIndex,
          agentCount,
          marketLiquidity,
          policyVersion: policy.policyVersion,
          settledAt,
          reason: 'land-value-cadence',
        }),
      );
      landValueByRegion.set(regionId, evaluation.nextIndex);
    }
    timeline.push({ settledAt, indexByRegion: Object.fromEntries(landValueByRegion) });
  }
  return { timeline };
}

/**
 * Splits an upkeep settlement interval at every land value boundary inside it
 * so each segment is priced against the index in effect for that segment. A
 * boundary exactly at the interval start applies to the whole interval; a
 * boundary exactly at the end belongs to the next interval.
 */
function resolveUpkeepRateSegments(input: {
  readonly previousSimulationTime: number;
  readonly currentSimulationTime: number;
  readonly regionId: string;
  readonly timeline: RegionalLandValueTimeline;
}): readonly { readonly durationSeconds: number; readonly landValueIndex?: number }[] {
  const indexAt = (at: number): number | undefined => {
    let value: number | undefined;
    for (const entry of input.timeline) {
      if (entry.settledAt > at) {
        break;
      }
      const candidate = entry.indexByRegion[input.regionId];
      if (candidate !== undefined) {
        value = candidate;
      }
    }
    return value;
  };
  const splitPoints = input.timeline
    .map((entry) => entry.settledAt)
    .filter((at) => at > input.previousSimulationTime && at < input.currentSimulationTime);
  const points = [input.previousSimulationTime, ...splitPoints, input.currentSimulationTime];
  const segments: { durationSeconds: number; landValueIndex?: number }[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index] as number;
    const end = points[index + 1] as number;
    const landValueIndex = indexAt(start);
    segments.push({
      durationSeconds: (end - start) / 1000,
      ...(landValueIndex === undefined ? {} : { landValueIndex }),
    });
  }
  return segments;
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
