import { advanceClock, createSeededRandom, rollProbabilityPercent } from '@aivilization/sim-core';
import {
  calculateNetWorth,
  decayExternalTradeBalance,
  rebalanceMarketPoolLiquidity,
  validateExternalTradePolicy,
  type ExternalMarketLiquidityPolicy,
  type ExternalTradePolicy,
} from '@aivilization/economy';
import type { AgentId, CommandEnvelope, LoanId } from '@aivilization/sim-core';
import type { EnterprisePolicy } from '@aivilization/enterprise';
import {
  applyCreditDomainEvent,
  decideLiquidateDeceasedCustomer,
  type BankState,
} from '@aivilization/credit';
import type { CreditPolicy } from '@aivilization/credit';
import {
  decideCloseEnterpriseOnOwnerDeparture,
  decideLeaveEnterprise,
} from '@aivilization/enterprise';
import {
  applyPassivePhysiologicalDecay,
  applySleepDeprivationHealthDecay,
  applyStochasticIllnessHealthDecay,
  assertValidLandValuePolicy,
  assertValidTownCalendarPolicy,
  calculateStochasticIllnessProbabilityPercent,
  calculateCompletedRecruitmentCycleNumbers,
  deriveEducationLevel,
  evaluateAutomaticPromotion,
  evaluateEducationExamCycle,
  evaluateIllnessDeath,
  evaluateLifestyleTier,
  evaluateOldAgeDeath,
  evaluateOutMigrationDecision,
  evaluatePhysiologicalSafetyNet,
  evaluateRegionalLandValue,
  evaluateResidentialArrears,
  evaluateResidentialUpkeep,
  evaluateRetirement,
  evaluateSafetyNetSubsidy,
  evaluateWellbeing,
  calculatePensionAccrual,
  deriveAgentAgeMs,
  deriveLifecycleStage,
  listTownDayPhaseStarts,
  resolveAgentLifespanMs,
  resolveResidentialUpkeepRate,
  resolveTownDayPhase,
  settlePublicBudget,
  resolveRecruitmentCycle,
  type EducationSystemPolicy,
  type EducationLevel,
  type LandValuePolicy,
  type LifecyclePolicy,
  type LifestylePolicy,
  type OutMigrationPolicy,
  type PhysiologicalSafetyNetPolicy,
  type RecruitmentCyclePolicy,
  type PublicBudgetPolicy,
  type ResidentialUpkeepPolicy,
  type SafetyNetSubsidyPolicy,
  type SleepDeprivationHealthDecayPolicy,
  type StochasticIllnessPolicy,
  type ConsumptionPolicy,
  type TaxPolicy,
  type TownCalendarPolicy,
  type WellbeingPolicy,
} from '@aivilization/society';
import { assertAdvanceSimulationTimePayload } from '../commands';
import type { WorldEvent } from '../events';
import {
  applyWorldEvent,
  resolveAgentAgeAnchorMs,
  type WorldAgentState,
  type WorldProjection,
} from '../projection';
import {
  iterateMarketPoolsByRegion,
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
  /**
   * Optional town-calendar policy (town-calendar-v1). When present,
   * AdvanceSimulationTime emits one TownDayPhaseChanged per crossed phase
   * start (never merged across phases) and settles the passive physiological
   * decay per agent and interval. Omitted keeps the world calendar-free and
   * decay-free, byte-for-byte identical to legacy runs.
   */
  readonly calendar?: TownCalendarPolicy;
  /**
   * Optional town-lifecycle policy (town-lifecycle-v1). When present, the
   * lifecycle block settles at the END of each settlement interval (the agent
   * was alive for that interval's charges): stage transitions (AgentAged),
   * forced retirement with the treasury pension (AgentRetired + PensionPaid),
   * and pre-rolled-lifespan or illness deaths with full estate liquidation
   * (EnterpriseEmployeeLeft, LoanWrittenOff/DepositForfeited, AgentDied).
   * Omitted keeps the population static, byte-for-byte identical to legacy
   * runs.
   */
  readonly lifecycle?: LifecyclePolicy;
  /**
   * Optional out-migration policy (town-migration-v1). When present, the
   * population-turnover block additionally evaluates the CS2 NotHappy
   * departure rule per agent and cadence: persistently unhappy agents leave
   * town with the full estate liquidation (shared with death). Omitted keeps
   * the population closed, byte-for-byte identical to legacy runs.
   */
  readonly migration?: OutMigrationPolicy;
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
  /**
   * Discrete education-system policy. When enabled, each settled agent whose
   * score crossed the next compulsory threshold automatically advances one
   * level (EducationLevelChanged), and each crossed exam-cycle boundary
   * resolves the pending exam applications of that cycle (EducationExamResolved
   * + EducationExamCycleCompleted). Absent or disabled never emits education
   * events, keeping legacy runs byte-for-byte.
   */
  readonly educationSystem?: EducationSystemPolicy;
  /**
   * Optional lifestyle (wealth-tier) policy, consumed only as a wellbeing
   * factor input: the per-agent lifestyle tier is derived with the same
   * evaluateLifestyleTier function and region-visible market pools the read
   * path uses. Absent keeps the lifestyle contribution at 0.
   */
  readonly lifestyle?: LifestylePolicy;
  /**
   * Optional town-wellbeing policy (town-wellbeing-v1). When present,
   * AdvanceSimulationTime settles the durable per-agent wellbeing scalar after
   * the physiology and safety-net effects (so it reads this tick's freshest
   * axes) and emits WellbeingChanged whenever the value moves. Absent keeps
   * runs wellbeing-free, byte-for-byte identical to legacy runs.
   */
  readonly wellbeing?: WellbeingPolicy;
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
  appendPetitionExpiryEvents({ input, events, nextSimulationTime: next.now });
  appendMatterExpiryEvents({ input, events, nextSimulationTime: next.now });
  appendWeatherTransitionEvent({
    input,
    events,
    payload,
    nextSimulationTime: next.now,
  });
  appendTownDayPhaseChangedEvents({
    input,
    events,
    previousSimulationTime: previous.now,
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
    input.calendar === undefined &&
    input.lifecycle === undefined &&
    input.migration === undefined &&
    input.residentialUpkeep === undefined &&
    input.safetyNetSubsidy === undefined &&
    input.physiologicalSafetyNet === undefined &&
    input.recruitmentCycle === undefined &&
    input.credit === undefined &&
    input.wellbeing === undefined &&
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
  const wellbeingByAgent = new Map<AgentId, number>();
  // Lifecycle block bookkeeping: agents that died or retired during this
  // advance. Dead agents are excluded from every later settlement of the same
  // advance (their projection entry is gone; the fallback in the interval
  // agents list would otherwise resurrect the stale snapshot); both sets also
  // cancel pending job/exam applications resolved after the settlement loop.
  const deceasedAgentIds = new Set<AgentId>();
  const retiredAgentIds = new Set<AgentId>();

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
    input.projection.timeSettlementByAgent?.[agent.agentId] ?? resolveAgentAgeAnchorMs(agent);
  const shouldSettleAgent = (agent: WorldAgentState): boolean =>
    amortization === undefined ||
    settlementTickIndex % amortization.buckets ===
      hashAgentSettlementBucket(agent.agentId) % amortization.buckets;
  // Population-turnover effects (probabilistic illness death and out-migration
  // rolls, stateful retirement + pension) must replay per cadence: with a
  // lifecycle or migration policy every advance is split at the finest
  // present settlement grid even without amortization, so a merged
  // multi-cadence advance settles identically to step-by-step ones. Without
  // either policy the single-interval legacy behavior is preserved
  // byte-for-byte.
  const turnoverSettlementCadenceMs =
    (input.lifecycle === undefined && input.migration === undefined) || next.now === previous.now
      ? undefined
      : Math.min(
          payload.deltaMs,
          ...(input.lifecycle === undefined ? [] : [input.lifecycle.settlementCadenceMs]),
          ...(input.migration === undefined ? [] : [input.migration.settlementCadenceMs]),
        );
  const settlementIntervalsByAgent = new Map(
    allAgents.map((agent) => [
      agent.agentId,
      shouldSettleAgent(agent)
        ? amortization === undefined
          ? turnoverSettlementCadenceMs === undefined
            ? [{ previousSimulationTime: previous.now, currentSimulationTime: next.now }]
            : createSettlementIntervals({
                previousSettledAt: previous.now,
                nextSettledAt: next.now,
                cadenceMs: turnoverSettlementCadenceMs,
              })
          : createSettlementIntervals({
              previousSettledAt: previousSettledAt(agent),
              nextSettledAt: next.now,
              cadenceMs: turnoverSettlementCadenceMs ?? payload.deltaMs,
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
  // In-advance travel arrivals per agent: each switches the region the
  // agent's residential upkeep prices against from its arrivesAt on. Derived
  // from the projection transit slice — the same fact appendCompletedTravel
  // Arrivals settles — so merged and per-cadence advances charge identically.
  const regionArrivalsByAgent = new Map<
    AgentId,
    readonly { readonly atMs: number; readonly regionId: string }[]
  >();
  for (const transit of Object.values(input.projection.transitByAgent ?? {})) {
    if (transit.arrivesAt <= previous.now || transit.arrivesAt > next.now) {
      continue;
    }
    const arrivals = [
      ...(regionArrivalsByAgent.get(transit.agentId) ?? []),
      {
        atMs: transit.arrivesAt,
        regionId: resolveRegionId(input.projection.locations[transit.toLocationId]?.regionId),
      },
    ].sort((left, right) => left.atMs - right.atMs);
    regionArrivalsByAgent.set(transit.agentId, arrivals);
  }
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
          !deceasedAgentIds.has(agent.agentId) &&
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

    // Passive physiological decay (town-calendar-v1) settles after the active
    // physiology effects and before wellbeing so the same tick's wellbeing
    // reads the decayed energy/satiety. The decay is linear and floored at
    // zero — strictly additive — yet it still replays interval by interval so
    // amortized catch-up matches the per-cadence event sequence.
    if (input.calendar !== undefined) {
      for (const agent of agents) {
        if (!shouldSettleAgent(agent)) {
          continue;
        }
        const interval = currentInterval(agent);
        appendPhysiologyTimeEffect({
          input,
          events,
          physiologyByAgent,
          agent,
          reason: 'passive-decay',
          nextPhysiology: applyPassivePhysiologicalDecay({
            previous: getCurrentPhysiology(physiologyByAgent, agent),
            elapsedMs: interval.currentSimulationTime - interval.previousSimulationTime,
            decay: input.calendar.physiologicalDecay,
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
        // Missing persisted level derives from the score with the SAME domain
        // function every read path uses (decision context, exams, production)
        // — otherwise a high-score legacy seed would read as university on
        // the read path yet restart promotion from level 0 on the write path.
        const level =
          settledAgent.educationLevel ??
          deriveEducationLevel(settledAgent.educationScore, educationPolicy);
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
                regionAtStart: resolveAgentRegion({
                  projection: input.projection,
                  agentLocationId: agent.locationId,
                }),
                regionArrivals: regionArrivalsByAgent.get(agent.agentId) ?? [],
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

    // Wellbeing settles after the physiology and safety-net effects so it reads
    // this tick's freshest axes, balances, and arrears from the running maps.
    if (input.wellbeing !== undefined) {
      appendWellbeingEvents({
        input,
        events,
        agents,
        physiologyByAgent,
        balanceByAgent,
        arrearsByAgent,
        tierByAgent,
        wellbeingByAgent,
        projection: settlementProjection,
        intervalFor: currentInterval,
        policy: input.wellbeing,
        ...(input.lifestyle === undefined ? {} : { lifestyle: input.lifestyle }),
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

    // Lifecycle settles at the END of each interval: the agent was alive for
    // this interval's charges and benefits, and aging/retirement/death take
    // effect from the next interval on. The block re-folds its own events so
    // the next interval (and the recruitment/exam cycles below) read
    // post-lifecycle state — released jobs, gone agents.
    if (input.lifecycle !== undefined || input.migration !== undefined) {
      const lifecycleStart = events.length;
      creditBank = appendLifecycleSettlementEvents({
        handlerInput: input,
        payload,
        policy: input.lifecycle,
        ...(input.migration === undefined ? {} : { migration: input.migration }),
        events,
        agents,
        projection: settlementProjection,
        bank: creditBank,
        physiologyByAgent,
        balanceByAgent,
        intervalFor: currentInterval,
        deceasedAgentIds,
        retiredAgentIds,
      });
      settlementProjection = events
        .slice(lifecycleStart)
        .reduce(applyWorldEvent, settlementProjection);
    }
  }

  if (amortization !== undefined) {
    for (const agent of allAgents) {
      if (!shouldSettleAgent(agent) || deceasedAgentIds.has(agent.agentId)) {
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
      ...(deceasedAgentIds.size === 0 && retiredAgentIds.size === 0
        ? {}
        : { excludeAgentIds: excludeFromApplicationSettlement(deceasedAgentIds, retiredAgentIds) }),
    });
  }

  if (input.educationSystem?.enabled === true) {
    appendEducationExamCycleEvents({
      input,
      events,
      previousSimulationTime: previous.now,
      nextSimulationTime: next.now,
      policy: input.educationSystem,
      ...(deceasedAgentIds.size === 0 ? {} : { excludeAgentIds: deceasedAgentIds }),
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
 * Splits an upkeep settlement interval at every land value boundary AND every
 * in-advance travel arrival of the agent inside it, so each segment is priced
 * against the index of the region the agent actually lived in during that
 * segment. A boundary exactly at the interval start applies to the whole
 * interval; one exactly at the end belongs to the next interval (mirroring
 * step-by-step advances, where an arrival at the interval end only affects
 * the NEXT interval's projection). Without this segmentation a merged
 * multi-cadence advance would price the whole interval at the pre-advance
 * region and diverge from per-cadence settlement.
 */
function resolveUpkeepRateSegments(input: {
  readonly previousSimulationTime: number;
  readonly currentSimulationTime: number;
  /** Region effective at the interval start (the pre-advance location). */
  readonly regionAtStart: string;
  /**
   * In-advance travel arrivals of this agent, chronological: each switches
   * the effective region from its atMs on.
   */
  readonly regionArrivals: readonly {
    readonly atMs: number;
    readonly regionId: string;
  }[];
  readonly timeline: RegionalLandValueTimeline;
}): readonly { readonly durationSeconds: number; readonly landValueIndex?: number }[] {
  const regionAt = (at: number): string => {
    let region = input.regionAtStart;
    for (const arrival of input.regionArrivals) {
      if (arrival.atMs > at) {
        break;
      }
      region = arrival.regionId;
    }
    return region;
  };
  const indexAt = (at: number, regionId: string): number | undefined => {
    let value: number | undefined;
    for (const entry of input.timeline) {
      if (entry.settledAt > at) {
        break;
      }
      const candidate = entry.indexByRegion[regionId];
      if (candidate !== undefined) {
        value = candidate;
      }
    }
    return value;
  };
  const splitPoints = [
    ...input.timeline.map((entry) => entry.settledAt),
    ...input.regionArrivals.map((arrival) => arrival.atMs),
  ]
    .filter((at) => at > input.previousSimulationTime && at < input.currentSimulationTime)
    .sort((left, right) => left - right);
  const points = [input.previousSimulationTime, ...splitPoints, input.currentSimulationTime];
  const segments: { durationSeconds: number; landValueIndex?: number }[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index] as number;
    const end = points[index + 1] as number;
    const regionId = regionAt(start);
    const landValueIndex = indexAt(start, regionId);
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

/** Union of agents whose pending applications must not resolve anymore. */
function excludeFromApplicationSettlement(
  deceasedAgentIds: ReadonlySet<AgentId>,
  retiredAgentIds: ReadonlySet<AgentId>,
): ReadonlySet<AgentId> {
  const excluded = new Set<AgentId>(deceasedAgentIds);
  for (const agentId of retiredAgentIds) {
    excluded.add(agentId);
  }
  return excluded;
}

/**
 * Lifecycle settlement (town-lifecycle-v1), running at the END of each
 * settlement interval. Per agent, in agentId order:
 *
 * 1. Aging — the stage is a pure function of the registration timestamp, the
 *    interval end, and the policy thresholds; an AgentAged event fires only on
 *    a stage change.
 * 2. Forced retirement — an elderly agent still holding a job is released
 *    from every enterprise membership (EnterpriseEmployeeLeft, enterpriseId
 *    order) and marked retired (AgentRetired). Pension accrues from the NEXT
 *    interval on.
 * 3. Death — old age once the pre-rolled lifespan is reached (the roll is
 *    derived only from the agent id and stable run seed material, so every
 *    partition and every replay derives the identical lifespan), or illness
 *    below the health threshold with a per-agent, per-interval seeded roll
 *    (mirroring the stochastic-illness convention). The estate liquidates:
 *    enterprise memberships released, bank positions settled through the
 *    credit aggregate (loans written off, deposits forfeited — pure book
 *    operations, supply unchanged), and the circulating balance burned with
 *    the AgentDied event (destroyed out of circulation).
 * 4. Pension — retired, living agents accrue pensionPerHour linearly, paid
 *    from the treasury (clamped to the running balance, mirroring the
 *    safety-net convention) or minted when the projection carries no treasury
 *    slice.
 *
 * Returns the evolved town-bank state so the next interval's credit accrual
 * settles against the written-off book; the caller re-folds the emitted
 * events into the settlement projection.
 */
function appendLifecycleSettlementEvents(input: {
  readonly handlerInput: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly payload: { readonly deltaMs: number };
  readonly policy: LifecyclePolicy | undefined;
  readonly migration?: OutMigrationPolicy;
  readonly events: WorldEvent[];
  readonly agents: readonly WorldAgentState[];
  readonly projection: WorldProjection;
  readonly bank: BankState | undefined;
  readonly physiologyByAgent: ReadonlyMap<AgentId, WorldAgentState['physiology']>;
  readonly balanceByAgent: Map<AgentId, number>;
  readonly intervalFor: (agent: WorldAgentState) => {
    readonly previousSimulationTime: number;
    readonly currentSimulationTime: number;
  };
  readonly deceasedAgentIds: Set<AgentId>;
  readonly retiredAgentIds: Set<AgentId>;
}): BankState | undefined {
  const { projection } = input;
  // Matters already closed earlier in THIS batch (e.g. the pre-loop expiry
  // settlement, or a previous departure in the same advance): the settlement
  // projection lags those events, but the reducer rejects a second close, so
  // the departure voiding must skip them explicitly.
  const closedMatterIds = new Set(
    input.events
      .filter((event) => event.type === 'MatterClosed')
      .map((event) => event.payload.matterId),
  );
  let bank = input.bank;
  // Running treasury across the pensions of this interval (the projection
  // slice is only folded after the whole block), mirroring the safety net.
  const treasuryFunded = projection.treasury !== undefined;
  let treasuryBalance = projection.treasury ?? 0;
  const simulationSeedMaterial =
    input.handlerInput.randomSeed ?? input.handlerInput.command.simulationId;

  const releaseEnterpriseMemberships = (agent: WorldAgentState, previousJob: string): void => {
    for (const enterprise of Object.values(projection.enterprises)
      .filter((candidate) => candidate.employeeAgentIds.includes(agent.agentId))
      .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))) {
      const decision = decideLeaveEnterprise({ enterprise, agentId: agent.agentId });
      if (decision.status === 'rejected') {
        throw new Error(
          `population turnover settlement failed to release ${agent.agentId} from ${enterprise.enterpriseId}: ${decision.reason}`,
        );
      }
      input.events.push(
        makeEvent(input.handlerInput, input.events.length, 'EnterpriseEmployeeLeft', {
          enterpriseId: enterprise.enterpriseId,
          agentId: agent.agentId,
          occupationName: enterprise.occupationName,
          previousJob,
        }),
      );
    }
  };

  // Shared departure liquidation (death and out-migration): release enterprise
  // memberships, settle bank positions through the credit aggregate (pure
  // book operations), void open social matters with the neutral closure, and
  // report the estate summary for the terminal event. The circulating
  // balance burns with the terminal event's reducer (out of the town
  // economy, AGENTS.md §7 category 3).
  const emitDepartureLiquidation = (
    agent: WorldAgentState,
    job: string | null,
    settledAt: number,
  ): {
    readonly burnedCurrency: number;
    readonly depositForfeited: number;
    readonly writtenOffLoanIds: LoanId[];
  } => {
    if (job !== null) {
      releaseEnterpriseMemberships(agent, job);
    }
    // Enterprises the departing agent OWNS close with their assets burned
    // out of the town economy: there is nobody to return them to, and a
    // ghost owner would break later dividend/close settlements. Employees
    // (minus the departed owner) are released by the closure itself.
    for (const enterprise of Object.values(projection.enterprises)
      .filter((candidate) => candidate.ownerAgentId === agent.agentId)
      .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))) {
      const closure = decideCloseEnterpriseOnOwnerDeparture({
        enterprise,
        ownerAgentId: agent.agentId,
        closedAt: settledAt,
      });
      if (closure.status === 'rejected') {
        throw new Error(
          `owner-departure closure rejected for ${enterprise.enterpriseId}: ${closure.reason}`,
        );
      }
      input.events.push(
        makeEvent(input.handlerInput, input.events.length, 'EnterpriseClosed', {
          enterpriseId: enterprise.enterpriseId,
          ownerAgentId: agent.agentId,
          returnedBalance: 0,
          returnedInventory: {},
          employeeAgentIds: enterprise.employeeAgentIds.filter(
            (employeeAgentId) => employeeAgentId !== agent.agentId,
          ),
          reason: 'owner-departed',
          burnedBalance: enterprise.balance,
          burnedInventory: Object.fromEntries(
            Object.entries(enterprise.inventory).filter(([, quantity]) => quantity > 0),
          ),
        }),
      );
    }
    let depositForfeited = 0;
    const writtenOffLoanIds: LoanId[] = [];
    if (bank !== undefined) {
      const liquidation = decideLiquidateDeceasedCustomer({
        bank,
        agentId: agent.agentId,
        settledAt,
      });
      if (liquidation.status === 'rejected') {
        throw new Error(`estate liquidation rejected for ${agent.agentId}: ${liquidation.reason}`);
      }
      for (const domainEvent of liquidation.events) {
        if (domainEvent.type === 'LoanWrittenOff') {
          input.events.push(
            makeEvent(input.handlerInput, input.events.length, 'LoanWrittenOff', {
              loanId: domainEvent.loanId,
              borrowerAgentId: domainEvent.borrowerAgentId,
              writtenOffAt: domainEvent.writtenOffAt,
              outstandingPrincipal: domainEvent.outstandingPrincipal,
              outstandingInterest: domainEvent.outstandingInterest,
              reason: 'borrower-deceased',
            }),
          );
          writtenOffLoanIds.push(domainEvent.loanId);
        } else if (domainEvent.type === 'DepositForfeited') {
          input.events.push(
            makeEvent(input.handlerInput, input.events.length, 'DepositForfeited', {
              agentId: domainEvent.agentId,
              forfeitedAmount: domainEvent.forfeitedAmount,
              forfeitedAt: domainEvent.forfeitedAt,
              reason: 'depositor-deceased',
            }),
          );
          depositForfeited = domainEvent.forfeitedAmount;
        }
        bank = applyCreditDomainEvent(bank, domainEvent);
      }
    }
    // Open social matters die with either party: a later expiry or
    // fulfillment would emit memory events for the departed and crash the
    // settlement, so the departure voids the matter with the neutral
    // 'expired' closure (no betrayal outcome — leaving is not betraying).
    for (const matter of Object.values(projection.socialMatters ?? {})
      .filter(
        (candidate) =>
          candidate.status !== 'closed' &&
          !closedMatterIds.has(candidate.matterId) &&
          (candidate.assigneeAgentId === agent.agentId ||
            candidate.initiatorAgentId === agent.agentId),
      )
      .sort((left, right) => left.matterId.localeCompare(right.matterId))) {
      input.events.push(
        makeEvent(input.handlerInput, input.events.length, 'MatterClosed', {
          matterId: matter.matterId,
          closure: 'expired',
          closedAt: settledAt,
        }),
      );
      closedMatterIds.add(matter.matterId);
    }
    return {
      burnedCurrency: getCurrentBalance(input.balanceByAgent, agent),
      depositForfeited,
      writtenOffLoanIds,
    };
  };

  for (const agent of input.agents) {
    if (input.deceasedAgentIds.has(agent.agentId)) {
      continue;
    }
    const interval = input.intervalFor(agent);
    const policy = input.policy;
    let job = agent.job;
    let retiredAtMs = agent.retiredAtMs;
    const ageMs =
      policy === undefined
        ? undefined
        : deriveAgentAgeMs({
            nowMs: interval.currentSimulationTime,
            registeredAtMs: resolveAgentAgeAnchorMs(agent),
            policy,
          });
    const ageDays =
      policy === undefined || ageMs === undefined ? undefined : ageMs / policy.dayLengthMs;
    const stage =
      policy === undefined || ageMs === undefined ? null : deriveLifecycleStage({ ageMs, policy });
    const previousStage = agent.lifeStage ?? 'adult';
    if (
      policy !== undefined &&
      stage !== null &&
      ageDays !== undefined &&
      stage !== previousStage
    ) {
      input.events.push(
        makeEvent(input.handlerInput, input.events.length, 'AgentAged', {
          agentId: agent.agentId,
          previousStage,
          nextStage: stage,
          ageDays,
          changedAt: interval.currentSimulationTime,
          policyVersion: policy.policyVersion,
          reason: 'aging',
        }),
      );
    }

    if (
      policy !== undefined &&
      stage !== null &&
      evaluateRetirement({ stage, hasJob: job !== null })
    ) {
      if (job === null) {
        throw new Error(`retirement decision requires a job for ${agent.agentId}`);
      }
      releaseEnterpriseMemberships(agent, job);
      input.events.push(
        makeEvent(input.handlerInput, input.events.length, 'AgentRetired', {
          agentId: agent.agentId,
          previousJob: job,
          retiredAtMs: interval.currentSimulationTime,
          ageDays: ageDays ?? 0,
          policyVersion: policy.policyVersion,
          reason: 'forced-retirement',
        }),
      );
      job = null;
      retiredAtMs = interval.currentSimulationTime;
      input.retiredAgentIds.add(agent.agentId);
    }

    // Pension accrues for every interval that starts after the retirement
    // interval (the retirement itself fired at an interval end). Paid BEFORE
    // the departure checks: the agent was present for this whole interval, so
    // the departing agent receives their final pension and the estate burn
    // settles the post-pension balance.
    if (
      policy !== undefined &&
      retiredAtMs !== undefined &&
      retiredAtMs <= interval.previousSimulationTime
    ) {
      const accrual = calculatePensionAccrual({
        elapsedMs: interval.currentSimulationTime - interval.previousSimulationTime,
        policy,
      });
      const amount = treasuryFunded ? Math.min(accrual, treasuryBalance) : accrual;
      if (amount > 0) {
        const previousBalance = getCurrentBalance(input.balanceByAgent, agent);
        input.events.push(
          makeEvent(input.handlerInput, input.events.length, 'PensionPaid', {
            agentId: agent.agentId,
            amount,
            previousBalance,
            nextBalance: previousBalance + amount,
            fundingSource: treasuryFunded ? 'treasury' : 'mint',
            pensionPerHour: policy.pensionPerHour,
            elapsedMs: interval.currentSimulationTime - interval.previousSimulationTime,
            settledAt: interval.currentSimulationTime,
            policyVersion: policy.policyVersion,
            reason: 'retirement-pension',
          }),
        );
        input.balanceByAgent.set(agent.agentId, previousBalance + amount);
        if (treasuryFunded) {
          treasuryBalance -= amount;
        }
      }
    }

    if (policy !== undefined && ageMs !== undefined) {
      const lifespanMs = resolveAgentLifespanMs({
        agentId: agent.agentId,
        simulationSeedMaterial,
        policy,
      });
      let cause: 'old-age' | 'illness' | null = null;
      if (evaluateOldAgeDeath({ ageMs, lifespanMs })) {
        cause = 'old-age';
      } else {
        const health = getCurrentPhysiology(input.physiologyByAgent, agent).health;
        const roll = createSeededRandom(
          createIllnessDeathSeed({
            input: { handlerInput: input.handlerInput, payload: input.payload },
            agentId: agent.agentId,
            evaluatedAt: interval.currentSimulationTime,
          }),
        ).nextFloat();
        if (
          evaluateIllnessDeath({
            health,
            elapsedMs: interval.currentSimulationTime - interval.previousSimulationTime,
            roll,
            policy,
          })
        ) {
          cause = 'illness';
        }
      }

      if (cause !== null) {
        const estate = emitDepartureLiquidation(agent, job, interval.currentSimulationTime);
        input.events.push(
          makeEvent(input.handlerInput, input.events.length, 'AgentDied', {
            agentId: agent.agentId,
            cause,
            diedAt: interval.currentSimulationTime,
            ageDays: ageDays ?? 0,
            lifespanDays: lifespanMs / policy.dayLengthMs,
            retired: retiredAtMs !== undefined,
            policyVersion: policy.policyVersion,
            estate: {
              burnedCurrency: estate.burnedCurrency,
              inventoryByCommodity: summarizeInventory(agent),
              depositForfeited: estate.depositForfeited,
              writtenOffLoanIds: estate.writtenOffLoanIds,
            },
          }),
        );
        input.deceasedAgentIds.add(agent.agentId);
        continue;
      }
    }

    // Out-migration (town-migration-v1, CS2 NotHappy): the same per-cadence
    // roll discipline as illness death; the departing agent liquidates
    // through the shared path and leaves with their estate burned out of the
    // town economy.
    if (input.migration !== undefined) {
      // Fresh wellbeing: the interval's WellbeingChanged events are already
      // folded into the projection this block received, so read the refreshed
      // agent state — a resident recovering above the zero-crossing this
      // interval stays, one newly falling below it leaves now, not one
      // interval late.
      const liveAgent = projection.agents[agent.agentId] ?? agent;
      const wellbeing = liveAgent.wellbeing ?? input.migration.fallbackWellbeing;
      const roll = createSeededRandom(
        createOutMigrationSeed({
          input: { handlerInput: input.handlerInput },
          policyVersion: input.migration.policyVersion,
          agentId: agent.agentId,
          evaluatedAt: interval.currentSimulationTime,
        }),
      ).nextFloat();
      if (
        evaluateOutMigrationDecision({
          wellbeing,
          elapsedMs: interval.currentSimulationTime - interval.previousSimulationTime,
          roll,
          policy: input.migration,
        })
      ) {
        const estate = emitDepartureLiquidation(agent, job, interval.currentSimulationTime);
        input.events.push(
          makeEvent(input.handlerInput, input.events.length, 'AgentEmigrated', {
            agentId: agent.agentId,
            cause: 'dissatisfaction',
            emigratedAt: interval.currentSimulationTime,
            wellbeing,
            ...(ageDays === undefined ? {} : { ageDays }),
            policyVersion: input.migration.policyVersion,
            estate: {
              burnedCurrency: estate.burnedCurrency,
              inventoryByCommodity: summarizeInventory(agent),
              depositForfeited: estate.depositForfeited,
              writtenOffLoanIds: estate.writtenOffLoanIds,
            },
          }),
        );
        input.deceasedAgentIds.add(agent.agentId);
        continue;
      }
    }
  }
  return bank;
}

function summarizeInventory(agent: WorldAgentState): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(agent.inventory)
      .filter(([, quantity]) => quantity > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

/**
 * Stable across dispatch shapes: the seed depends ONLY on the run seed
 * material, the policy version, the agent, and the cadence boundary — never
 * the command id, the pre-advance clock, or the batch's total deltaMs. A
 * merged multi-cadence advance and per-cadence advances therefore draw the
 * SAME roll at the same boundary (cross-command cadence equivalence).
 */
function createOutMigrationSeed(input: {
  readonly input: {
    readonly handlerInput: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  };
  readonly policyVersion: string;
  readonly agentId: AgentId;
  readonly evaluatedAt: number;
}): string {
  const { handlerInput } = input.input;
  return [
    'agent-out-migration',
    ...(handlerInput.randomSeed === undefined ? [] : [handlerInput.randomSeed]),
    handlerInput.command.simulationId,
    input.policyVersion,
    input.agentId,
    input.evaluatedAt,
  ].join(':');
}
function createIllnessDeathSeed(input: {
  readonly input: {
    readonly handlerInput: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
    readonly payload: { readonly deltaMs: number };
  };
  readonly agentId: AgentId;
  readonly evaluatedAt: number;
}): string {
  const { handlerInput, payload } = input.input;
  return [
    'agent-illness-death',
    ...(handlerInput.randomSeed === undefined ? [] : [handlerInput.randomSeed]),
    handlerInput.command.simulationId,
    handlerInput.command.id,
    handlerInput.projection.clock.now,
    payload.deltaMs,
    input.evaluatedAt,
    input.agentId,
  ].join(':');
}

/**
 * Per-agent wellbeing settlement (town-wellbeing-v1). The running value lives
 * in `wellbeingByAgent` across the catch-up intervals of one advance (the same
 * convention as the physiology/balance maps), seeded from the durable
 * projection value or the policy initialValue for legacy agents. The lifestyle
 * factor reuses evaluateLifestyleTier with the pools visible in the agent's
 * region — never a recomputed formula — and the relation factors are means
 * over the agent's own outgoing relation scores, iterated in sorted key order
 * so the result is iteration-order independent.
 */
function appendWellbeingEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly agents: readonly WorldAgentState[];
  readonly physiologyByAgent: ReadonlyMap<AgentId, WorldAgentState['physiology']>;
  readonly balanceByAgent: ReadonlyMap<AgentId, number>;
  readonly arrearsByAgent: ReadonlyMap<AgentId, number>;
  readonly tierByAgent: ReadonlyMap<AgentId, number>;
  readonly wellbeingByAgent: Map<AgentId, number>;
  readonly projection: WorldProjection;
  readonly intervalFor: (agent: WorldAgentState) => {
    readonly previousSimulationTime: number;
    readonly currentSimulationTime: number;
  };
  readonly policy: WellbeingPolicy;
  readonly lifestyle?: LifestylePolicy;
}): void {
  for (const agent of input.agents) {
    const interval = input.intervalFor(agent);
    const previous = getCurrentWellbeing(input.wellbeingByAgent, agent, input.policy);
    const physiology = getCurrentPhysiology(input.physiologyByAgent, agent);
    const lifestyleTier =
      input.lifestyle === undefined
        ? undefined
        : evaluateLifestyleTier({
            netWorth: calculateNetWorth({
              currencyBalance: getCurrentBalance(input.balanceByAgent, agent),
              inventory: agent.inventory,
              pools: [
                ...iterateMarketPoolsByRegion(
                  input.projection,
                  resolveAgentRegion({
                    projection: input.projection,
                    agentLocationId: agent.locationId,
                  }),
                ),
              ],
            }),
            policy: input.lifestyle,
          });
    const relations = summarizeAgentWellbeingRelations(input.projection, agent.agentId);
    // Distress freshness: the physiological safety net settles EARLIER in this
    // same interval and its PhysiologicalDistressChanged events are not yet
    // folded into the projection — read the transition off the emitted batch
    // (last event wins) so a distress starting or clearing THIS interval moves
    // the wellbeing target immediately instead of one interval late.
    const distressActive = isDistressActiveInBatch(input.projection, input.events, agent.agentId);
    const evaluation = evaluateWellbeing({
      previous,
      inputs: {
        health: physiology.health,
        energy: physiology.energy,
        satiety: physiology.satiety,
        employed: agent.job !== null,
        residentialTier: input.tierByAgent.get(agent.agentId) ?? agent.residentialTier,
        ...(lifestyleTier === undefined ? {} : { lifestyleTier }),
        upkeepArrears: input.arrearsByAgent.get(agent.agentId) ?? agent.upkeepArrears ?? 0,
        distressActive,
        meanPositiveRelation: relations.meanPositiveRelation,
        meanNegativeRelation: relations.meanNegativeRelation,
        elapsedMs: interval.currentSimulationTime - interval.previousSimulationTime,
      },
      policy: input.policy,
    });
    if (evaluation.next === previous) {
      continue;
    }
    input.events.push(
      makeEvent(input.input, input.events.length, 'WellbeingChanged', {
        agentId: agent.agentId,
        previous,
        next: evaluation.next,
        target: evaluation.target,
        factorContributions: evaluation.factorContributions,
        policyVersion: input.policy.policyVersion,
        settledAt: interval.currentSimulationTime,
        reason: 'time-settlement',
      }),
    );
    input.wellbeingByAgent.set(agent.agentId, evaluation.next);
  }
}

function isDistressActiveInBatch(
  projection: WorldProjection,
  events: readonly WorldEvent[],
  agentId: AgentId,
): boolean {
  let active = projection.physiologicalDistressByAgent[agentId] !== undefined;
  for (const event of events) {
    if (event.type !== 'PhysiologicalDistressChanged' || event.payload.agentId !== agentId) {
      continue;
    }
    active = event.payload.status === 'active';
  }
  return active;
}

function getCurrentWellbeing(
  wellbeingByAgent: ReadonlyMap<AgentId, number>,
  agent: WorldAgentState,
  policy: WellbeingPolicy,
): number {
  return wellbeingByAgent.get(agent.agentId) ?? agent.wellbeing ?? policy.initialValue;
}

function summarizeAgentWellbeingRelations(
  projection: WorldProjection,
  agentId: AgentId,
): { readonly meanPositiveRelation: number; readonly meanNegativeRelation: number } {
  let positiveTotal = 0;
  let positiveCount = 0;
  let negativeTotal = 0;
  let negativeCount = 0;
  for (const key of Object.keys(projection.socialRelations).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const relation = projection.socialRelations[key];
    if (relation === undefined || relation.sourceAgentId !== agentId) {
      continue;
    }
    if (relation.relationScore > 0) {
      positiveTotal += relation.relationScore;
      positiveCount += 1;
    } else if (relation.relationScore < 0) {
      negativeTotal += -relation.relationScore;
      negativeCount += 1;
    }
  }
  return {
    meanPositiveRelation: positiveCount === 0 ? 0 : positiveTotal / positiveCount,
    meanNegativeRelation: negativeCount === 0 ? 0 : negativeTotal / negativeCount,
  };
}

function appendRecruitmentCycleEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly policy: RecruitmentCyclePolicy;
  /** Agents whose pending applications die with them (deceased or retired). */
  readonly excludeAgentIds?: ReadonlySet<AgentId>;
}): void {
  const cycleNumbers = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: input.policy.cycleDurationMs,
  });
  const excludeAgentIds = input.excludeAgentIds ?? new Set<AgentId>();
  const jobByAgent = new Map(
    Object.values(input.input.projection.agents).map(
      (agent) => [agent.agentId, agent.job] as const,
    ),
  );

  for (const cycleNumber of cycleNumbers) {
    const applications = input.input.projection.jobApplications
      .filter(
        (application) =>
          application.cycleNumber === cycleNumber &&
          application.status === 'pending' &&
          !excludeAgentIds.has(application.agentId),
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
  /** Agents whose pending exam applications die with them (deceased). */
  readonly excludeAgentIds?: ReadonlySet<AgentId>;
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
          application.cycleNumber === cycleNumber &&
          application.status === 'pending' &&
          !(input.excludeAgentIds ?? new Set<AgentId>()).has(application.agentId),
      )
      .map((application) => ({
        applicationId: application.applicationId,
        agentId: application.agentId,
        targetLevel: application.targetLevel,
        educationScore: application.educationScore,
        ...(application.effectiveEducationScore === undefined
          ? {}
          : { effectiveEducationScore: application.effectiveEducationScore }),
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

/**
 * Emits one TownDayPhaseChanged per phase start crossed by this advance,
 * never merging multiple crossed phases into one event (AGENTS.md §6: a
 * stateful cadence effect replays boundary by boundary). The phase timeline
 * is a pure function of the simulation clock and the calendar policy table —
 * no RNG, no carried state — so every partition advancing the same clock with
 * the same policy derives byte-identical events. That purity is what makes
 * the command-policy wiring (unlike authority-scoped weather) safe: identical
 * inputs force identical outputs everywhere, and replay re-derives the same
 * sequence. The previous phase is read off the same pure function, so the
 * projection calendar slice stays a read cache rather than a settlement input.
 */
function appendTownDayPhaseChangedEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
}): void {
  const policy = input.input.calendar;
  if (policy === undefined) {
    return;
  }
  assertValidTownCalendarPolicy(policy);
  let currentPhase = resolveTownDayPhase({
    atMs: input.previousSimulationTime,
    policy,
  }).phase;
  for (const start of listTownDayPhaseStarts({
    fromMs: input.previousSimulationTime,
    toMs: input.nextSimulationTime,
    policy,
  })) {
    if (start.phase === currentPhase) {
      continue;
    }
    input.events.push(
      makeEvent(input.input, input.events.length, 'TownDayPhaseChanged', {
        policyVersion: policy.policyVersion,
        dayIndex: start.dayIndex,
        previousPhase: currentPhase,
        phase: start.phase,
        startedAtMs: start.atMs,
        endsAtMs: start.phaseEndsAtMs,
      }),
    );
    currentPhase = start.phase;
  }
}

/** Open petitions that expired within this advance; no policy, no-op without the slice. */
function appendPetitionExpiryEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly nextSimulationTime: number;
}): void {
  const due = (input.input.projection.petitions ?? [])
    .filter(
      (petition) => petition.status === 'open' && petition.expiresAt <= input.nextSimulationTime,
    )
    .sort(
      (left, right) =>
        left.expiresAt - right.expiresAt || left.petitionId.localeCompare(right.petitionId),
    );
  for (const petition of due) {
    input.events.push(
      makeEvent(input.input, input.events.length, 'PetitionExpired', {
        petitionId: petition.petitionId,
        expiredAt: petition.expiresAt,
      }),
    );
  }
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
