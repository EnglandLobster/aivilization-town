import type { MobilityState } from '@aivilization/mobility';
import { applyResidentMobilityProjection } from './projectionReducers/residentMobility';
import { applyResidentParticipationEnded } from './projectionReducers/residentParticipation';
import type { ResidentLeaseState } from '@aivilization/society';
import { applyResidentLeaseProjection } from './projectionReducers/residentLeases';
import type { CommerceState } from '@aivilization/commerce';
import { applyResidentCommerceProjection } from './projectionReducers/residentCommerce';
import {
  addInventory,
  assertMoneySupplyDelta,
  calculateCirculatingMoneyDelta,
  createMoneyTransfer,
  economicAccount,
  removeInventory,
  type AmmPool,
  type EconomicAccountSector,
  type Inventory,
} from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type { AgentId, ConversationId, LocationId, SimulationClock } from '@aivilization/sim-core';
import type { HumanCommandAttribution } from '@aivilization/sim-core';
import {
  classifySocialCommitmentIntent,
  createDirectedSocialRelationKey,
  decaySocialRelation,
  type EducationLevel,
  type EducationExamResolutionStatus,
  type EducationExamTargetLevel,
  type EducationTrack,
  type PhysiologicalState,
  type PhysiologicalDistressState,
  type RecruitmentApplicationResolutionStatus,
  type SocialRelationState,
  type GovernanceChangeAuthority,
  type TownGovernanceState,
} from '@aivilization/society';
import type { WorldEvent } from './events';
import {
  applyEnterpriseDomainEvent,
  assertValidEnterpriseState,
  normalizeEnterpriseState,
  type WorldEnterpriseState,
} from './enterprise';
import { assertValidBankState, normalizeBankState, type WorldBankState } from './credit';
import type {
  AgentRegisteredPayload,
  AgentActivityKind,
  AgentActivityTimeCommittedPayload,
  EconomicCompositionRecordedPayload,
} from './events';
import { resolveMarketPoolKey } from './regionalMarkets';
import type { WorldWeatherState } from './weather';
import { cloneTownBulletin, type WorldBulletinState } from './bulletin';
import type { WorldPetitionState } from './petition';
import { appendWorldTownPulseRecord, type WorldTownPulseRecord } from './townPulse';
import { cloneSocialMatter, type WorldSocialMatterState } from './matters';
import type { WorldConflictRecord } from './conflict';
import { applyEnterpriseProjectionEvent } from './projectionReducers/enterprise';
import { applyCreditProjectionEvent } from './projectionReducers/credit';
import { applyRegionalLandValueProjectionEvent } from './projectionReducers/regionalLandValue';
import { applyRegionalServiceQualityProjectionEvent } from './projectionReducers/serviceQuality';
import { applyGovernanceProjectionEvent } from './projectionReducers/governance';

export type WorldRegionalServiceQualityState = {
  readonly service: 'education' | 'healthcare';
  readonly quality: number;
  readonly fundedAmount: number;
  readonly occupancy: number;
  readonly capacity: number;
  readonly budgetEfficiency: number;
  readonly occupancyRatio: number;
  readonly capacityEfficiency: number;
  readonly landValueContribution: number;
  readonly wellbeingContribution: number;
  readonly policyVersion: string;
  readonly settledAt: number;
};

export type WorldGovernanceState = TownGovernanceState & {
  readonly lastChangedAt: number;
  readonly lastChangedBy: GovernanceChangeAuthority;
  readonly lastChangeReason: string;
};

export type WorldAgentState = {
  readonly agentId: AgentId;
  readonly locationId: LocationId | null;
  /** Durable home assignment, independent of current physical location. */
  readonly residenceLocationId?: LocationId | null;
  readonly physiology: PhysiologicalState;
  readonly educationScore: number;
  readonly balance: number;
  readonly residentialTier: number;
  readonly job: string | null;
  readonly inventory: Inventory;
  /**
   * Discrete education level under education-system-v2. Optional so legacy
   * snapshots and registrations stay byte-for-byte compatible; absent means the
   * level is derived from `educationScore` via the education-system policy
   * thresholds.
   */
  readonly educationLevel?: EducationLevel;
  /**
   * Academic/vocational track, assigned when an exam-gated promotion splits
   * tracks (planned later stage). Absent means the default academic track.
   */
  readonly educationTrack?: EducationTrack;
  /** Cumulative exam attempts under the exam-release stage; absent means zero. */
  readonly examAttempts?: number;
  readonly durableGoods?: readonly {
    readonly lotId: string;
    readonly commodityName: string;
    readonly quantity: number;
    readonly utilityPoints: number;
    readonly acquiredAt: number;
    readonly expiresAt: number;
  }[];
  /**
   * Accumulated unpaid residential upkeep. Optional so legacy snapshots and
   * registrations stay byte-for-byte compatible; absent means zero arrears.
   */
  readonly upkeepArrears?: number;
  /**
   * Durable wellbeing scalar (town-wellbeing), settled during time
   * advancement via WellbeingChanged. Optional so legacy snapshots and
   * registrations stay byte-for-byte compatible; absent means the policy
   * initialValue (legacy).
   */
  readonly wellbeing?: number;
  /**
   * Durable versioned-lifecycle stage, updated by AgentAged.
   * Optional so legacy snapshots and registrations stay byte-for-byte
   * compatible; absent means 'adult' (every registered agent is an adult at
   * registration).
   */
  readonly lifeStage?: 'child' | 'teen' | 'adult' | 'elderly';
  /**
   * Simulation time the agent was forcibly retired by town lifecycle, set
   * by AgentRetired. Agents carrying this field accrue the hourly pension;
   * absent means not retired.
   */
  readonly retiredAtMs?: number;
  /**
   * Registration-time anchor carried by cross-partition ownership transfers
   * (the full registration record does not travel). The lifecycle age
   * derivation prefers the registration record and falls back to this anchor,
   * so a migrant keeps their true age instead of snapping back to time zero.
   */
  readonly registeredAtMs?: number;
  readonly registration?: {
    readonly registrationId: string;
    readonly policyVersion: string;
    readonly creatorId: string;
    readonly source: string;
    readonly displayName: string;
    readonly registeredAt: number;
    readonly provenance: 'post-bootstrap-command';
    readonly migrationArrival?: AgentRegisteredPayload['migrationArrival'];
    readonly humanAttribution?: HumanCommandAttribution;
  };
};

export type WorldAgentStateInput = Omit<WorldAgentState, 'locationId'> & {
  readonly locationId?: LocationId | null;
};

export type WorldLocationKind =
  | 'residence'
  | 'education'
  | 'healthcare'
  | 'food'
  | 'market'
  | 'production'
  | 'social';

export type WorldLocationState = {
  readonly locationId: LocationId;
  readonly name: string;
  readonly kind: WorldLocationKind;
  readonly activityAffinities: readonly string[];
  readonly capacity: number | null;
  readonly source?: string;
  readonly mapPosition?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly connections?: readonly {
    readonly targetLocationId: LocationId;
    readonly travelDurationSeconds: number;
  }[];
  /**
   * Optional regional market this location belongs to. When the regional-markets
   * switch is enabled, locations sharing a regionId trade against one shared AMM
   * pool per commodity, and prices can diverge across regions. Omitted/undefined
   * maps to {@link DEFAULT_MARKET_REGION_ID} so legacy single-market scenarios are
   * unchanged.
   */
  readonly regionId?: string;
};

export type WorldLocationStateInput = WorldLocationState;

export type WorldJobApplicationState = {
  readonly applicationId: string;
  readonly cycleNumber: number;
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly residentialTier: number;
  readonly educationScore: number;
  /** Effective score used for employer ranking when a vocational bonus applied. */
  readonly effectiveEducationScore?: number;
  readonly submittedAt: number;
  readonly status: 'pending' | RecruitmentApplicationResolutionStatus;
  readonly resolvedAt?: number;
  readonly resolutionReason?: string;
};

export type WorldRecruitmentCycleState = {
  readonly cycleNumber: number;
  readonly cycleStartedAt: number;
  readonly cycleEndedAt: number;
  readonly completedAt: number;
  readonly policyVersion: string;
  readonly applicationCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
};

export type WorldEducationExamApplicationState = {
  readonly applicationId: string;
  readonly cycleNumber: number;
  readonly agentId: AgentId;
  readonly targetLevel: EducationExamTargetLevel;
  readonly educationScore: number;
  /** Ranking-score snapshot (e.g. wellbeing-adjusted); absent ranks on raw. */
  readonly effectiveEducationScore?: number;
  readonly submittedAt: number;
  readonly status: 'pending' | EducationExamResolutionStatus;
  readonly resolvedAt?: number;
  readonly resolutionReason?: string;
};

export type WorldEducationExamCycleState = {
  readonly cycleNumber: number;
  readonly cycleStartedAt: number;
  readonly cycleEndedAt: number;
  readonly completedAt: number;
  readonly policyVersion: string;
  readonly applicationCount: number;
  readonly admittedCount: number;
  readonly rejectedCount: number;
  readonly applicationsByLevel: Readonly<Record<string, number>>;
  readonly admittedByLevel: Readonly<Record<string, number>>;
  readonly cutoffScoresByLevel: Readonly<Record<string, number>>;
};

export type WorldMarketPriceIndexState = {
  readonly baselineAt: number;
  readonly recordedAt: number;
  readonly food: number;
  readonly nonFood: number;
  readonly overall: number;
  readonly foodCount: number;
  readonly nonFoodCount: number;
  readonly ratios: Readonly<Record<string, number>>;
};

/**
 * Latest recorded economic-composition observation. The projection keeps only
 * the newest entry (replaced, not appended, by each EconomicCompositionRecorded)
 * so the slice stays bounded; the durable series lives in the event stream.
 */
export type WorldEconomicCompositionState = {
  readonly recordedAt: number;
  readonly moneySupply: number;
  readonly composition: {
    readonly agents: number;
    readonly enterprises: number;
    readonly treasury: number;
    readonly bank: number;
    readonly ammPoolCurrency: number;
    readonly ammPoolCommodityValue: number;
    readonly externalNetInflow: number;
  };
  readonly enterprises: {
    readonly total: number;
    readonly active: number;
    readonly insolvent: number;
    readonly bankruptTotal: number;
  };
  readonly gini: number;
  readonly deposits: number;
  readonly loansOutstanding: number;
  /**
   * Agent headcount per discrete education level ('0'..'5'); optional so
   * legacy snapshots and events recorded before the education-system
   * observability stage stay byte-for-byte compatible.
   */
  readonly educationDistribution?: Readonly<Record<string, number>>;
  readonly survival?: EconomicCompositionRecordedPayload['survival'];
};

export type WorldLocationObservationState = {
  readonly agentId: AgentId;
  readonly locationId: LocationId;
  readonly locationName: string;
  readonly observedAgentIds: readonly AgentId[];
  readonly activityAffinities: readonly string[];
  readonly observedAt: number;
  readonly focus?: string;
};

export type WorldConversationTurnState = {
  readonly turnIndex: number;
  readonly speakerAgentId: AgentId;
  readonly utterance: string;
  readonly intent?: string;
};

export type WorldConversationRecordState = {
  readonly conversationId: ConversationId;
  readonly initiatorAgentId: AgentId;
  readonly participantAgentIds: readonly AgentId[];
  readonly locationId: LocationId;
  readonly topic: string;
  readonly turns: readonly WorldConversationTurnState[];
  readonly recordedAt: number;
};

export type WorldSocialCommitmentState = {
  readonly commitmentId: string;
  readonly promisorAgentId: AgentId;
  readonly beneficiaryAgentId: AgentId;
  readonly topic: string;
  readonly statement: string;
  readonly status: 'open' | 'fulfilled' | 'breached';
  readonly createdAt: number;
  readonly resolvedAt?: number;
  readonly resolutionConversationId?: ConversationId;
};

export type WorldAgentActivityTimeState = {
  readonly agentId: AgentId;
  readonly activity: AgentActivityKind;
  readonly commandType: AgentActivityTimeCommittedPayload['commandType'];
  readonly policyVersion: AgentActivityTimeCommittedPayload['policyVersion'];
  readonly settlementTiming: AgentActivityTimeCommittedPayload['settlementTiming'];
  readonly startedAt: number;
  readonly durationSeconds: number;
  readonly availableAt: number;
  readonly committedAt: number;
};

export type WorldAgentTransitState = {
  readonly agentId: AgentId;
  readonly fromLocationId: LocationId;
  readonly toLocationId: LocationId;
  readonly routeLocationIds: readonly LocationId[];
  readonly spatialPolicyVersion: string;
  readonly baseTravelDurationSeconds: number;
  readonly congestionMultiplier: number;
  readonly edgeCongestionMultiplier?: number;
  readonly destinationCongestionMultiplier?: number;
  readonly routeEdgeFlows?: readonly {
    readonly fromLocationId: LocationId;
    readonly toLocationId: LocationId;
    readonly activeTraversalCount: number;
    readonly congestionMultiplier: number;
  }[];
  readonly travelDurationSeconds: number;
  readonly departedAt: number;
  readonly arrivesAt: number;
  readonly reason: string;
};

/**
 * Simulation-wide calendar slice (town-calendar-v1): the day/night phase
 * currently in effect. `since` is the simulation time the phase started (the
 * startedAtMs of the last TownDayPhaseChanged event). The phase is a pure
 * function of the clock and the calendar policy, so this slice is a cache of
 * the last settled transition, never an independent source of truth.
 */
export type WorldCalendarState = {
  readonly dayIndex: number;
  readonly phase: string;
  readonly since: number;
};

export type WorldRenewableResourceState = {
  readonly commodityName: string;
  readonly stock: number;
  readonly carryingCapacity: number;
  readonly lastRegenerationAt: number;
  readonly policyVersion: string;
  readonly updatedAt: number;
};

export type WorldSurvivalOutcomesState = {
  readonly deathsByCause: Readonly<Record<string, number>>;
  readonly emigrated: number;
};

export type WorldResourceFlowMetricsState = {
  readonly cumulativeExtractedByCommodity: Readonly<Record<string, number>>;
  readonly scarcityRejectionsByCommodity: Readonly<Record<string, number>>;
};

export type WorldProjection = {
  readonly residentLeases?: ResidentLeaseState;
  readonly residentCommerce?: CommerceState;
  readonly residentMobility?: MobilityState;
  readonly clock: SimulationClock;
  readonly agents: Readonly<Record<string, WorldAgentState>>;
  readonly enterprises: Readonly<Record<string, WorldEnterpriseState>>;
  readonly locations: Readonly<Record<string, WorldLocationState>>;
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  /**
   * Optional renewable-resource stocks, keyed by region then commodity.
   * Absent on legacy snapshots and runs without the survival-resource policy.
   */
  readonly renewableResources?: Readonly<
    Record<string, Readonly<Record<string, WorldRenewableResourceState>>>
  >;
  /** Cumulative carrying-capacity experiment outcomes reconstructed from events. */
  readonly survivalOutcomes?: WorldSurvivalOutcomesState;
  readonly resourceFlowMetrics?: WorldResourceFlowMetricsState;
  readonly moneySupply: number;
  readonly marketPriceIndices: readonly WorldMarketPriceIndexState[];
  /**
   * Newest economic-composition observation from the worker market-metrics
   * channel. Optional so legacy snapshots stay byte-for-byte compatible;
   * absent means no EconomicCompositionRecorded has been applied yet.
   */
  readonly economicComposition?: WorldEconomicCompositionState;
  /**
   * Cumulative count of EnterpriseBankruptcyDeclared events applied. Tracked
   * separately from enterprise status because a bankrupt enterprise is closed
   * in the same settlement and its terminal `closed` status no longer records
   * the reason; absent on legacy snapshots and treated as zero.
   */
  readonly bankruptEnterpriseTotal?: number;
  readonly externalMarket?: {
    readonly commodityReserveNetImports: Readonly<Record<string, number>>;
    readonly currencyReserveNetImports: number;
  };
  /**
   * Optional external-trade slice: the rolling per-commodity net-export balance
   * (positive = net exports) that prices trades against the external sector.
   * Present only once the first ExternalTradeExecuted/ExternalTradeBalancesDecayed
   * event exists; absent keeps legacy snapshots byte-for-byte compatible. Exports
   * inject currency from the external sector and imports burn into it, so these
   * trades move moneySupply with the `external` counterpart sector.
   */
  readonly externalTrade?: {
    readonly balancesByCommodity: Readonly<Record<string, number>>;
    readonly lastDecayAt: number;
  };
  readonly jobApplications: readonly WorldJobApplicationState[];
  readonly recruitmentCycles: readonly WorldRecruitmentCycleState[];
  readonly educationExamApplications: readonly WorldEducationExamApplicationState[];
  readonly educationExamCycles: readonly WorldEducationExamCycleState[];
  readonly physiologicalDistressByAgent: Readonly<Record<string, PhysiologicalDistressState>>;
  readonly locationObservations: readonly WorldLocationObservationState[];
  readonly conversationRecords: readonly WorldConversationRecordState[];
  readonly socialCommitments: Readonly<Record<string, WorldSocialCommitmentState>>;
  readonly activityTimeByAgent: Readonly<Record<string, WorldAgentActivityTimeState>>;
  readonly transitByAgent?: Readonly<Record<string, WorldAgentTransitState>>;
  /**
   * Last simulation time each agent's per-agent time effects were settled.
   * Present only when time-settlement amortization is enabled; absent on legacy
   * projections (every agent settles every tick).
   */
  readonly timeSettlementByAgent?: Readonly<Record<string, number>>;
  /**
   * Public treasury balance funded by tax events and drained by
   * treasury-funded subsidies. Optional so legacy snapshots stay byte-for-byte
   * compatible; absent is treated as zero by the tax and subsidy cases.
   * Taxation and treasury spending are transfers and never move moneySupply.
   */
  readonly treasury?: number;
  /**
   * Optional per-region land value index slice (regionId -> smoothed index).
   * Present only once the first RegionalLandValueUpdated event exists (i.e. a
   * land value policy is active); absent keeps legacy snapshots byte-for-byte
   * compatible and keeps housing upkeep on flat v1 pricing. The index only
   * modulates upkeep pricing and never moves currency by itself.
   */
  readonly regionalLandValues?: Readonly<Record<string, number>>;
  /**
   * Authority-delivered land-value boundaries whose simulation timestamps are
   * ahead of this partition clock. The next local time advance consumes these
   * exact facts for segmented upkeep pricing, then clears them. Optional for
   * legacy snapshots and absent in single-writer/local-only runs.
   */
  readonly pendingRegionalLandValueUpdates?: readonly Extract<
    WorldEvent,
    { type: 'RegionalLandValueUpdated' }
  >['payload'][];
  /** Latest authoritative service-quality fact per region and service. */
  readonly regionalServiceQualities?: Readonly<
    Record<string, Partial<Record<'education' | 'healthcare', WorldRegionalServiceQualityState>>>
  >;
  /**
   * Optional town-bank slice (deposits, loan book, credit history and the bank
   * cash account). Present only once credit events exist or the scenario seeded
   * initial bank reserves; absent keeps legacy snapshots byte-for-byte
   * compatible. The bank cash account circulates, so banking transfers never
   * move moneySupply; a reserve seed counts towards the bootstrap supply.
   */
  readonly bank?: WorldBankState;
  readonly publicBudget?: {
    readonly cumulativeSpendingByService: Readonly<Record<string, number>>;
    readonly serviceBalances: Readonly<Record<string, number>>;
    readonly lastSettledAt: number;
  };
  /** Durable policy overrides enacted by the town governance aggregate. */
  readonly governance?: WorldGovernanceState;
  /**
   * Optional simulation-wide weather slice, present only when the town-weather
   * policy has produced at least one WeatherChanged event (or the projection
   * was created with an explicit initial weather). Omitted keeps legacy
   * snapshots byte-for-byte compatible.
   */
  readonly weather?: WorldWeatherState;
  /**
   * Optional simulation-wide calendar slice (town-calendar-v1), present only
   * when the town-calendar policy has produced at least one TownDayPhaseChanged
   * event (or the projection was created with an explicit initial phase).
   * Omitted keeps legacy snapshots byte-for-byte compatible. `since` is the
   * simulation time the current phase started.
   */
  readonly calendar?: WorldCalendarState;
  /**
   * Optional town-bulletin board state (opt-in town-bulletin switch). Absent
   * on legacy projections; present (possibly empty) once the board is used.
   */
  readonly bulletins?: readonly WorldBulletinState[];
  /**
   * Optional town petition slice (collective-action switch). Absent on legacy
   * projections; present (possibly empty) once petitions are used.
   */
  readonly petitions?: readonly WorldPetitionState[];
  /**
   * Optional social-matter board state (opt-in social-matters switch), keyed
   * by matterId. Absent on legacy projections.
   */
  readonly socialMatters?: Readonly<Record<string, WorldSocialMatterState>>;
  /**
   * Optional town-conflict log (opt-in town-conflict switch), one entry per
   * confrontation/attack/intervention, append-only in event order. Absent on
   * legacy projections.
   */
  readonly conflictRecords?: readonly WorldConflictRecord[];
  /**
   * Bounded town-pulse ring (read model, world-decision-context-view v3):
   * the most recent town-wide occurrences (death/emigration/arrival/petition
   * threshold/weather/enterprise lifecycle), newest last, capped at
   * WORLD_TOWN_PULSE_RING_CAPACITY. Deterministic from the event stream;
   * settlement never consumes it. Always present (empty for projections
   * predating the ring or built without one).
   */
  readonly townPulse: readonly WorldTownPulseRecord[];
  readonly socialRelations: Readonly<Record<string, SocialRelationState>>;
  readonly memoryRecords: readonly ShortTermMemoryRecord[];
  readonly rejectedActions: readonly {
    readonly agentId: AgentId;
    readonly commandType: string;
    readonly reason: string;
  }[];
};

export const WORLD_PROJECTION_MEMORY_RETENTION_POLICY_VERSION =
  'world-projection-memory-retention-v1';
export const WORLD_PROJECTION_RECENT_MEMORY_RECORD_LIMIT = 256;

export function createWorldProjectionMemoryRetentionPolicyManifest() {
  return {
    policyVersion: WORLD_PROJECTION_MEMORY_RETENTION_POLICY_VERSION,
    provenance: 'repository-design',
    projectionRole: 'bounded-recent-observability-cache-not-authoritative-memory',
    recentRecordLimit: WORLD_PROJECTION_RECENT_MEMORY_RECORD_LIMIT,
    authoritativeHistory: ['short-term-memory-ledger', 'world-event-stream'],
    cognitionReadPath: 'short-term-memory-repository',
    legacySnapshotHydration: 'retain-newest-records-to-current-limit',
  } as const;
}

export function enforceWorldProjectionMemoryRetention(
  projection: WorldProjection,
): WorldProjection {
  if (projection.memoryRecords.length <= WORLD_PROJECTION_RECENT_MEMORY_RECORD_LIMIT) {
    return projection;
  }
  return {
    ...projection,
    memoryRecords: projection.memoryRecords.slice(-WORLD_PROJECTION_RECENT_MEMORY_RECORD_LIMIT),
  };
}

/**
 * Fills the education-exam arrays introduced by education-system-v2 on legacy
 * snapshots that predate them. Checkpoint hydration deserializes the stored
 * projection verbatim, so a pre-exam snapshot would otherwise surface
 * `undefined` arrays to the 放榜 settlement, the per-cycle application dedupe
 * guard and the agent decision context.
 */
export function normalizeLegacyWorldProjectionSnapshot(
  projection: WorldProjection,
): WorldProjection {
  validateSpatialLocations(projection.locations);
  assertAgentLocationReferencesValid(projection.agents, projection.locations);
  assertPhysicalLocationCapacityNotExceeded(projection.agents, projection.locations);
  assertResidentialCapacityNotExceeded(projection.agents, projection.locations);
  for (const enterprise of Object.values(projection.enterprises)) {
    assertValidEnterpriseState(normalizeEnterpriseState(enterprise));
  }
  if (projection.bank !== undefined) {
    assertValidBankState(normalizeBankState(projection.bank));
  }
  if (
    projection.educationExamApplications !== undefined &&
    projection.educationExamCycles !== undefined &&
    projection.townPulse !== undefined
  ) {
    return projection;
  }
  return {
    ...projection,
    educationExamApplications: projection.educationExamApplications ?? [],
    educationExamCycles: projection.educationExamCycles ?? [],
    // Pre-ring snapshots carry no pulse; the ring then rebuilds from events
    // replayed after the snapshot sequence.
    townPulse: projection.townPulse ?? [],
  };
}

export function createWorldProjection(input: {
  readonly agents: readonly WorldAgentStateInput[];
  readonly enterprises?: readonly WorldEnterpriseState[];
  readonly clock?: SimulationClock;
  readonly locations?: readonly WorldLocationStateInput[];
  readonly marketPools?: readonly AmmPool[];
  readonly moneySupply?: number;
  readonly marketPriceIndices?: readonly WorldMarketPriceIndexState[];
  readonly jobApplications?: readonly WorldJobApplicationState[];
  readonly recruitmentCycles?: readonly WorldRecruitmentCycleState[];
  readonly educationExamApplications?: readonly WorldEducationExamApplicationState[];
  readonly educationExamCycles?: readonly WorldEducationExamCycleState[];
  readonly physiologicalDistressByAgent?: Readonly<Record<string, PhysiologicalDistressState>>;
  readonly locationObservations?: readonly WorldLocationObservationState[];
  readonly conversationRecords?: readonly WorldConversationRecordState[];
  readonly socialCommitments?: readonly WorldSocialCommitmentState[];
  readonly socialRelations?: readonly SocialRelationState[];
  readonly weather?: WorldWeatherState;
  readonly calendar?: WorldCalendarState;
  /**
   * Optional initial in-flight travel slice (per-agent transit state), used
   * by snapshot hydration and tests. Omitted keeps the projection
   * transit-free until a move command creates state.
   */
  readonly transitByAgent?: Readonly<Record<string, WorldAgentTransitState>>;
  readonly treasury?: number;
  /**
   * Optional initial town-bank state, typically seeded from scenario reserves
   * via `createBankState`. Omitted leaves the projection bank-free until the
   * first credit event bootstraps it.
   */
  readonly bank?: WorldBankState;
  /**
   * Optional seed for the latest economic-composition observation and the
   * cumulative bankruptcy tally; omitted keeps constructed projections
   * byte-for-byte identical to legacy ones until the events apply.
   */
  readonly economicComposition?: WorldEconomicCompositionState;
  readonly bankruptEnterpriseTotal?: number;
  readonly bulletins?: readonly WorldBulletinState[];
  readonly petitions?: readonly WorldPetitionState[];
  readonly governance?: WorldGovernanceState;
  readonly socialMatters?: readonly WorldSocialMatterState[];
  /**
   * Optional initial town-pulse ring (snapshot hydration); omitted starts
   * empty and the ring rebuilds deterministically from replayed events.
   */
  readonly townPulse?: readonly WorldTownPulseRecord[];
}): WorldProjection {
  const locations: Record<string, WorldLocationState> = {};
  for (const location of input.locations ?? []) {
    if (locations[location.locationId] !== undefined) {
      throw new Error(`duplicate location id ${location.locationId}`);
    }
    locations[location.locationId] = {
      ...location,
      activityAffinities: [...location.activityAffinities],
      ...(location.mapPosition === undefined ? {} : { mapPosition: { ...location.mapPosition } }),
      ...(location.connections === undefined
        ? {}
        : { connections: location.connections.map((connection) => ({ ...connection })) }),
    };
  }
  validateSpatialLocations(locations);

  const agents: Record<string, WorldAgentState> = {};
  for (const agent of input.agents) {
    if (agents[agent.agentId] !== undefined) {
      throw new Error(`duplicate agent id ${agent.agentId}`);
    }
    const locationId = agent.locationId ?? null;
    if (locationId !== null && locations[locationId] === undefined) {
      throw new Error(
        `agent ${agent.agentId} location ${locationId} is not in projection locations`,
      );
    }
    if (agent.residenceLocationId !== undefined && agent.residenceLocationId !== null) {
      const residence = locations[agent.residenceLocationId];
      if (residence === undefined || residence.kind !== 'residence') {
        throw new Error(
          `agent ${agent.agentId} residence ${agent.residenceLocationId} is not a residential location`,
        );
      }
    }
    agents[agent.agentId] = {
      ...agent,
      locationId,
      inventory: { ...agent.inventory },
      ...(agent.durableGoods === undefined
        ? {}
        : { durableGoods: agent.durableGoods.map((lot) => ({ ...lot })) }),
    };
  }
  assertPhysicalLocationCapacityNotExceeded(agents, locations);
  assertResidentialCapacityNotExceeded(agents, locations);

  const marketPools: Record<string, AmmPool> = {};
  for (const pool of input.marketPools ?? []) {
    const poolKey = resolveMarketPoolKey({ regionId: pool.regionId, commodity: pool.commodity });
    if (marketPools[poolKey] !== undefined) {
      throw new Error(`duplicate AMM pool ${poolKey}`);
    }
    marketPools[poolKey] = { ...pool };
  }

  const socialRelations: Record<string, SocialRelationState> = {};
  for (const relation of input.socialRelations ?? []) {
    socialRelations[createDirectedSocialRelationKey(relation)] = relation;
  }

  const enterprises: Record<string, WorldEnterpriseState> = {};
  for (const enterprise of input.enterprises ?? []) {
    if (enterprises[enterprise.enterpriseId] !== undefined) {
      throw new Error(`duplicate enterprise id ${enterprise.enterpriseId}`);
    }
    // Terminal enterprise records remain in the projection for deterministic
    // replay and audit after an owner permanently leaves the town. Operational
    // enterprises still require a live owner because owner-scoped commands and
    // lifecycle settlement cannot be authorized otherwise.
    if (agents[enterprise.ownerAgentId] === undefined && enterprise.status !== 'closed') {
      throw new Error(`enterprise ${enterprise.enterpriseId} has unknown owner`);
    }
    const normalized = normalizeEnterpriseState(enterprise);
    assertValidEnterpriseState(normalized);
    enterprises[enterprise.enterpriseId] = normalized;
  }

  const bank = input.bank === undefined ? undefined : normalizeBankState(input.bank);
  if (bank !== undefined) {
    assertValidBankState(bank);
  }

  return {
    clock: input.clock === undefined ? { now: 0, tickDurationMs: 1000 } : { ...input.clock },
    agents,
    enterprises,
    locations,
    marketPools,
    moneySupply: input.moneySupply ?? 0,
    marketPriceIndices: (input.marketPriceIndices ?? []).map(cloneMarketPriceIndex),
    jobApplications: input.jobApplications?.map((application) => ({ ...application })) ?? [],
    recruitmentCycles: input.recruitmentCycles?.map((cycle) => ({ ...cycle })) ?? [],
    educationExamApplications:
      input.educationExamApplications?.map((application) => ({ ...application })) ?? [],
    educationExamCycles: input.educationExamCycles?.map((cycle) => ({ ...cycle })) ?? [],
    physiologicalDistressByAgent: clonePhysiologicalDistressByAgent(
      input.physiologicalDistressByAgent ?? {},
    ),
    locationObservations: (input.locationObservations ?? []).map((observation) => ({
      ...observation,
      observedAgentIds: [...observation.observedAgentIds],
      activityAffinities: [...observation.activityAffinities],
    })),
    conversationRecords: (input.conversationRecords ?? []).map(cloneConversationRecord),
    socialCommitments: Object.fromEntries(
      (input.socialCommitments ?? []).map((commitment) => [
        commitment.commitmentId,
        { ...commitment },
      ]),
    ),
    activityTimeByAgent: {},
    transitByAgent: {},
    ...(input.weather === undefined ? {} : { weather: { ...input.weather } }),
    ...(input.transitByAgent === undefined
      ? {}
      : {
          transitByAgent: Object.fromEntries(
            Object.entries(input.transitByAgent).map(([agentId, transit]) => [
              agentId,
              {
                ...transit,
                routeLocationIds: [...transit.routeLocationIds],
                ...(transit.routeEdgeFlows === undefined
                  ? {}
                  : { routeEdgeFlows: transit.routeEdgeFlows.map((edge) => ({ ...edge })) }),
              },
            ]),
          ),
        }),
    ...(input.calendar === undefined ? {} : { calendar: { ...input.calendar } }),
    ...(input.treasury === undefined ? {} : { treasury: input.treasury }),
    ...(bank === undefined ? {} : { bank }),
    ...(input.economicComposition === undefined
      ? {}
      : { economicComposition: cloneEconomicComposition(input.economicComposition) }),
    ...(input.bankruptEnterpriseTotal === undefined
      ? {}
      : { bankruptEnterpriseTotal: input.bankruptEnterpriseTotal }),
    ...(input.bulletins === undefined
      ? {}
      : {
          bulletins: input.bulletins.map((bulletin) => ({ ...bulletin })),
        }),
    ...(input.petitions === undefined
      ? {}
      : {
          petitions: input.petitions.map((petition) => ({
            ...petition,
            signatureAgentIds: [...petition.signatureAgentIds],
          })),
        }),
    ...(input.governance === undefined
      ? {}
      : {
          governance: {
            ...input.governance,
            ...(input.governance.tax === undefined
              ? {}
              : {
                  tax: {
                    ...input.governance.tax,
                    incomeTaxBrackets: input.governance.tax.incomeTaxBrackets.map((bracket) => ({
                      ...bracket,
                    })),
                  },
                }),
            ...(input.governance.publicBudget === undefined
              ? {}
              : {
                  publicBudget: {
                    ...input.governance.publicBudget,
                    allocations: input.governance.publicBudget.allocations.map((allocation) => ({
                      ...allocation,
                    })),
                  },
                }),
            ...(input.governance.subsidy === undefined
              ? {}
              : { subsidy: { ...input.governance.subsidy } }),
            consumedPetitionIds: [...input.governance.consumedPetitionIds],
            lastChangedBy: { ...input.governance.lastChangedBy },
          },
        }),
    ...(input.socialMatters === undefined
      ? {}
      : {
          socialMatters: Object.fromEntries(
            input.socialMatters.map((matter) => [matter.matterId, cloneSocialMatter(matter)]),
          ),
        }),
    townPulse: input.townPulse?.map((record) => ({ ...record })) ?? [],
    socialRelations,
    memoryRecords: [],
    rejectedActions: [],
  };
}

function validateSpatialLocations(locations: Readonly<Record<string, WorldLocationState>>): void {
  for (const location of Object.values(locations)) {
    if (
      location.capacity !== null &&
      (!Number.isInteger(location.capacity) || location.capacity < 1)
    ) {
      throw new Error(
        `location ${location.locationId} capacity must be null or a positive integer`,
      );
    }
    if (location.mapPosition !== undefined) {
      for (const [field, value] of Object.entries(location.mapPosition)) {
        const minimum = field === 'width' || field === 'height' ? Number.EPSILON : 0;
        if (!Number.isFinite(value) || value < minimum || value > 1) {
          throw new Error(
            `location ${location.locationId} mapPosition.${field} must be ${minimum === 0 ? 'between 0 and 1' : 'greater than 0 and at most 1'}`,
          );
        }
      }
    }
    const targets = new Set<LocationId>();
    for (const connection of location.connections ?? []) {
      if (locations[connection.targetLocationId] === undefined) {
        throw new Error(
          `location ${location.locationId} connection targets unknown location ${connection.targetLocationId}`,
        );
      }
      if (connection.targetLocationId === location.locationId) {
        throw new Error(`location ${location.locationId} cannot connect to itself`);
      }
      if (targets.has(connection.targetLocationId)) {
        throw new Error(
          `location ${location.locationId} has duplicate connection ${connection.targetLocationId}`,
        );
      }
      if (
        !Number.isFinite(connection.travelDurationSeconds) ||
        connection.travelDurationSeconds <= 0
      ) {
        throw new Error(
          `location ${location.locationId} connection duration must be positive finite`,
        );
      }
      targets.add(connection.targetLocationId);
    }
  }
  for (const location of Object.values(locations)) {
    for (const connection of location.connections ?? []) {
      const reciprocal = locations[connection.targetLocationId]?.connections?.find(
        (candidate) => candidate.targetLocationId === location.locationId,
      );
      if (
        reciprocal === undefined ||
        reciprocal.travelDurationSeconds !== connection.travelDurationSeconds
      ) {
        throw new Error(
          `location connection ${location.locationId}<->${connection.targetLocationId} must be reciprocal with equal duration`,
        );
      }
    }
  }
}

export function applyWorldEvent(
  sourceProjection: WorldProjection,
  event: WorldEvent,
): WorldProjection {
  // Town-pulse ring first: it snapshots subject names from the PRE-event
  // state (death/emigration remove the agent, closure may drop the
  // enterprise), so it must run before every event-specific reducer below.
  // The pulsed projection then shadows the source name so the reducers below
  // are untouched.
  const townPulse = appendWorldTownPulseRecord({
    records: sourceProjection.townPulse,
    event,
    resolveAgentDisplayName: (agentId) =>
      sourceProjection.agents[agentId]?.registration?.displayName,
    resolveEnterpriseName: (enterpriseId) => sourceProjection.enterprises[enterpriseId]?.name,
  });
  const projection =
    townPulse === sourceProjection.townPulse
      ? sourceProjection
      : { ...sourceProjection, townPulse };
  const leaseProjection = applyResidentLeaseProjection(projection, event);
  if (leaseProjection !== undefined) return leaseProjection;
  const mobilityProjection = applyResidentMobilityProjection(projection, event);
  if (mobilityProjection !== undefined) return mobilityProjection;
  const commerceProjection = applyResidentCommerceProjection(projection, event);
  if (commerceProjection !== undefined) return commerceProjection;
  const enterpriseProjection = applyEnterpriseProjectionEvent(projection, event);
  if (enterpriseProjection !== undefined) {
    return enterpriseProjection;
  }
  const creditProjection = applyCreditProjectionEvent(projection, event);
  if (creditProjection !== undefined) {
    return creditProjection;
  }
  const landValueProjection = applyRegionalLandValueProjectionEvent(projection, event);
  if (landValueProjection !== undefined) {
    return landValueProjection;
  }
  const serviceQualityProjection = applyRegionalServiceQualityProjectionEvent(projection, event);
  if (serviceQualityProjection !== undefined) {
    return serviceQualityProjection;
  }
  const governanceProjection = applyGovernanceProjectionEvent(projection, event);
  if (governanceProjection !== undefined) {
    return governanceProjection;
  }
  switch (event.type) {
    case 'AgentRegistered': {
      if (projection.agents[event.payload.agentId] !== undefined) {
        throw new Error(`cannot replay duplicate agent registration ${event.payload.agentId}`);
      }
      const initialState = event.payload.initialState;
      if (
        initialState.residenceLocationId !== undefined &&
        initialState.residenceLocationId !== null
      ) {
        const residence = projection.locations[initialState.residenceLocationId];
        if (residence === undefined || residence.kind !== 'residence') {
          throw new Error(
            `registered agent ${event.payload.agentId} has invalid residence ${initialState.residenceLocationId}`,
          );
        }
        const occupied = resolveResidentialOccupancy(projection, initialState.residenceLocationId);
        if (residence.capacity !== null && occupied >= residence.capacity) {
          throw new Error(
            `registered agent ${event.payload.agentId} exceeds residence ${residence.locationId} capacity`,
          );
        }
      }
      return applyMoneyTransferToSupply(
        {
          ...projection,
          agents: {
            ...projection.agents,
            [event.payload.agentId]: {
              agentId: event.payload.agentId,
              ...initialState,
              physiology: { ...initialState.physiology },
              inventory: { ...initialState.inventory },
              registration: {
                registrationId: event.payload.registrationId,
                policyVersion: event.payload.policyVersion,
                creatorId: event.payload.creatorId,
                source: event.payload.source,
                displayName: event.payload.displayName,
                registeredAt: event.occurredAt,
                provenance: 'post-bootstrap-command',
                ...(event.payload.migrationArrival === undefined
                  ? {}
                  : { migrationArrival: { ...event.payload.migrationArrival } }),
                ...(event.payload.humanAttribution === undefined
                  ? {}
                  : {
                      humanAttribution: {
                        ...event.payload.humanAttribution,
                        principalRoles: [...event.payload.humanAttribution.principalRoles],
                      },
                    }),
              },
            },
          },
        },
        {
          transactionId: event.id,
          reason: 'runtime-agent-registration',
          fromSector: 'monetary-authority',
          fromId: 'runtime-registration',
          toSector: 'agent',
          toId: event.payload.agentId,
          amount: event.payload.moneySupplyDelta,
        },
      );
    }
    case 'AgentRegistrationRejected':
      return {
        ...projection,
        rejectedActions: [
          ...projection.rejectedActions,
          {
            agentId: event.payload.agentId,
            commandType: 'RegisterAgent',
            reason: event.payload.reason,
          },
        ],
      };
    case 'RenewableResourceRegenerated':
      return updateRenewableResource(projection, {
        regionId: event.payload.regionId,
        commodityName: event.payload.commodityName,
        stock: event.payload.nextStock,
        carryingCapacity: event.payload.carryingCapacity,
        lastRegenerationAt: event.payload.settledThrough,
        policyVersion: event.payload.policyVersion,
        updatedAt: event.payload.settledThrough,
      });
    case 'RenewableResourceExtracted':
      return {
        ...updateRenewableResource(projection, {
          regionId: event.payload.regionId,
          commodityName: event.payload.commodityName,
          stock: event.payload.nextStock,
          carryingCapacity: event.payload.carryingCapacity,
          lastRegenerationAt: event.payload.lastRegenerationAt,
          policyVersion: event.payload.policyVersion,
          updatedAt: event.occurredAt,
        }),
        resourceFlowMetrics: {
          cumulativeExtractedByCommodity: incrementMetric(
            projection.resourceFlowMetrics?.cumulativeExtractedByCommodity,
            event.payload.commodityName,
            event.payload.extractedStock,
          ),
          scarcityRejectionsByCommodity: {
            ...projection.resourceFlowMetrics?.scarcityRejectionsByCommodity,
          },
        },
      };
    case 'CommodityProduced':
      return updateAgent(
        event.payload.enterpriseId === undefined
          ? projection
          : updateEnterprise(projection, event.payload.enterpriseId, (enterprise) => ({
              ...enterprise,
              inventory: applyInventoryChanges(
                applyInventoryChanges(enterprise.inventory, event.payload.consumedInputs, -1),
                event.payload.produced,
                1,
              ),
            })),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          ...(event.payload.enterpriseId === undefined
            ? {
                inventory: applyInventoryChanges(
                  applyInventoryChanges(agent.inventory, event.payload.consumedInputs, -1),
                  event.payload.produced,
                  1,
                ),
              }
            : {}),
          physiology: {
            ...agent.physiology,
            energy: Math.max(0, agent.physiology.energy - event.payload.energyCost),
            satiety: Math.max(0, agent.physiology.satiety - event.payload.satietyCost),
          },
        }),
      );
    case 'TradeExecuted': {
      const actorSector: EconomicAccountSector =
        event.payload.enterpriseId === undefined ? 'agent' : 'enterprise';
      const actorId = event.payload.enterpriseId ?? event.payload.agentId;
      const marketAccount = economicAccount(
        'market',
        resolveMarketPoolKey({
          regionId: event.payload.regionId,
          commodity: event.payload.commodityName,
        }),
      );
      const transaction = createMoneyTransfer({
        transactionId: event.id,
        reason: `trade-${event.payload.side}`,
        from: event.payload.side === 'buy' ? economicAccount(actorSector, actorId) : marketAccount,
        to: event.payload.side === 'buy' ? marketAccount : economicAccount(actorSector, actorId),
        amount: event.payload.currencyQuantity,
      });
      // Legacy trade events used zero as an unspecified accounting delta.
      // Preserve replay compatibility; all versioned/non-zero deltas are
      // checked against the double-entry transaction.
      if (event.payload.moneySupplyDelta !== 0) {
        assertMoneySupplyDelta({
          transaction,
          moneySupplyDelta: event.payload.moneySupplyDelta,
        });
      }
      const marketProjection = {
        ...projection,
        marketPools: {
          ...projection.marketPools,
          [resolveMarketPoolKey({
            regionId: event.payload.regionId,
            commodity: event.payload.commodityName,
          })]: event.payload.poolAfter,
        },
        moneySupply: projection.moneySupply + event.payload.moneySupplyDelta,
      };
      if (event.payload.enterpriseId !== undefined) {
        return updateEnterprise(marketProjection, event.payload.enterpriseId, (enterprise) =>
          applyEnterpriseDomainEvent(
            enterprise,
            event.payload.side === 'sell'
              ? {
                  type: 'EnterpriseSaleRecorded',
                  amount: event.payload.currencyQuantity,
                  commodityName: event.payload.commodityName,
                  quantity: event.payload.commodityQuantity,
                }
              : {
                  type: 'EnterprisePurchaseRecorded',
                  amount: event.payload.currencyQuantity,
                  commodityName: event.payload.commodityName,
                  quantity: event.payload.commodityQuantity,
                },
          ),
        );
      }
      return updateAgent(marketProjection, event.payload.agentId, (agent) => ({
        ...agent,
        balance:
          event.payload.side === 'buy'
            ? agent.balance - event.payload.currencyQuantity
            : agent.balance + event.payload.currencyQuantity,
        inventory:
          event.payload.side === 'buy'
            ? addInventory(
                agent.inventory,
                event.payload.commodityName,
                event.payload.commodityQuantity,
              )
            : removeInventory(
                agent.inventory,
                event.payload.commodityName,
                event.payload.commodityQuantity,
              ),
      }));
    }
    case 'ExternalMarketRebalanced': {
      const poolKey = resolveMarketPoolKey({
        regionId: event.payload.regionId,
        commodity: event.payload.commodityName,
      });
      return {
        ...projection,
        marketPools: { ...projection.marketPools, [poolKey]: event.payload.poolAfter },
        externalMarket: {
          commodityReserveNetImports: {
            ...(projection.externalMarket?.commodityReserveNetImports ?? {}),
            [poolKey]:
              (projection.externalMarket?.commodityReserveNetImports[poolKey] ?? 0) +
              event.payload.commodityReserveDelta,
          },
          currencyReserveNetImports:
            (projection.externalMarket?.currencyReserveNetImports ?? 0) +
            event.payload.currencyReserveDelta,
        },
      };
    }
    case 'ExternalTradeExecuted': {
      const trader = event.payload.trader;
      const traderSector: EconomicAccountSector = 'agentId' in trader ? 'agent' : 'enterprise';
      const traderId = 'agentId' in trader ? trader.agentId : trader.enterpriseId;
      // Partition projections only contain aggregates owned by that partition.
      // The net-export balance is a town-wide fact broadcast everywhere, while
      // cash, money supply, and inventory change only where the trader exists.
      const traderIsPresent =
        'agentId' in trader
          ? projection.agents[trader.agentId] !== undefined
          : projection.enterprises[trader.enterpriseId] !== undefined;
      // Export = injection from the external sector (supply rises); import =
      // burn into the external sector (supply falls).
      const settledProjection = traderIsPresent
        ? applyMoneyTransferToSupply(projection, {
            transactionId: event.id,
            reason: `external-trade-${event.payload.direction}`,
            ...(event.payload.direction === 'export'
              ? {
                  fromSector: 'external',
                  fromId: 'external-market',
                  toSector: traderSector,
                  toId: traderId,
                }
              : {
                  fromSector: traderSector,
                  fromId: traderId,
                  toSector: 'external',
                  toId: 'external-market',
                }),
            amount: event.payload.totalCurrency,
          })
        : projection;
      const balanceBefore =
        projection.externalTrade?.balancesByCommodity[event.payload.commodityName] ?? 0;
      const balanceAfter =
        event.payload.direction === 'export'
          ? balanceBefore + event.payload.quantity
          : balanceBefore - event.payload.quantity;
      assertExternalTradeBalanceTransition({
        event,
        balanceBefore,
        balanceAfter,
      });
      const tradedProjection = {
        ...settledProjection,
        externalTrade: {
          balancesByCommodity: {
            ...(projection.externalTrade?.balancesByCommodity ?? {}),
            [event.payload.commodityName]: balanceAfter,
          },
          lastDecayAt: projection.externalTrade?.lastDecayAt ?? 0,
        },
      };
      if (!traderIsPresent) {
        return tradedProjection;
      }
      if ('enterpriseId' in trader) {
        return updateEnterprise(tradedProjection, trader.enterpriseId, (enterprise) =>
          applyEnterpriseDomainEvent(
            enterprise,
            event.payload.direction === 'export'
              ? {
                  type: 'EnterpriseSaleRecorded',
                  amount: event.payload.totalCurrency,
                  commodityName: event.payload.commodityName,
                  quantity: event.payload.quantity,
                }
              : {
                  type: 'EnterprisePurchaseRecorded',
                  amount: event.payload.totalCurrency,
                  commodityName: event.payload.commodityName,
                  quantity: event.payload.quantity,
                },
          ),
        );
      }
      return updateAgent(tradedProjection, trader.agentId, (agent) => ({
        ...agent,
        balance:
          event.payload.direction === 'export'
            ? agent.balance + event.payload.totalCurrency
            : agent.balance - event.payload.totalCurrency,
        inventory:
          event.payload.direction === 'export'
            ? removeInventory(agent.inventory, event.payload.commodityName, event.payload.quantity)
            : addInventory(agent.inventory, event.payload.commodityName, event.payload.quantity),
      }));
    }
    case 'ExternalTradeBalancesDecayed': {
      const current = projection.externalTrade?.balancesByCommodity ?? {};
      for (const [commodityName, balance] of Object.entries(event.payload.balancesBefore)) {
        if (Math.abs((current[commodityName] ?? 0) - balance) > 1e-9) {
          throw new Error(
            `external trade balance for ${commodityName} is ${current[commodityName] ?? 0}, cannot replay decay from ${balance}`,
          );
        }
      }
      return {
        ...projection,
        externalTrade: {
          balancesByCommodity: { ...event.payload.balancesAfter },
          lastDecayAt: event.payload.decayedAt,
        },
      };
    }
    case 'ResourceTransferred': {
      const hasSource = projection.agents[event.payload.sourceAgentId] !== undefined;
      const hasTarget = projection.agents[event.payload.targetAgentId] !== undefined;
      if (!hasSource && !hasTarget) {
        throw new Error(
          `cannot replay resource transfer without participant ${event.payload.sourceAgentId} or ${event.payload.targetAgentId}`,
        );
      }
      const afterSource = !hasSource
        ? projection
        : updateAgent(projection, event.payload.sourceAgentId, (agent) => ({
            ...agent,
            inventory: removeInventory(
              agent.inventory,
              event.payload.commodityName,
              event.payload.quantity,
            ),
          }));
      return !hasTarget
        ? afterSource
        : updateAgent(afterSource, event.payload.targetAgentId, (agent) => ({
            ...agent,
            inventory: addInventory(
              agent.inventory,
              event.payload.commodityName,
              event.payload.quantity,
            ),
          }));
    }
    case 'CommodityConsumed':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        inventory: removeInventory(
          agent.inventory,
          event.payload.commodityName,
          event.payload.quantity,
        ),
        ...(event.payload.kind === 'durable' &&
        event.payload.durableLotId !== undefined &&
        event.payload.expiresAt !== undefined
          ? {
              durableGoods: [
                ...(agent.durableGoods ?? []),
                {
                  lotId: event.payload.durableLotId,
                  commodityName: event.payload.commodityName,
                  quantity: event.payload.quantity,
                  utilityPoints: event.payload.utilityPoints,
                  acquiredAt: event.occurredAt,
                  expiresAt: event.payload.expiresAt,
                },
              ],
            }
          : {}),
      }));
    case 'DurableGoodExpired':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        durableGoods: (agent.durableGoods ?? []).filter((lot) => lot.lotId !== event.payload.lotId),
      }));
    case 'MarketPriceIndexRecorded':
      return {
        ...projection,
        marketPriceIndices: [
          ...projection.marketPriceIndices,
          cloneMarketPriceIndex({
            baselineAt: event.payload.baselineAt,
            recordedAt: event.occurredAt,
            food: event.payload.food,
            nonFood: event.payload.nonFood,
            overall: event.payload.overall,
            foodCount: event.payload.foodCount,
            nonFoodCount: event.payload.nonFoodCount,
            ratios: event.payload.ratios,
          }),
        ],
      };
    case 'EconomicCompositionRecorded':
      // Read-model fact only: replace the latest observation, never recompute it.
      return {
        ...projection,
        economicComposition: cloneEconomicComposition(event.payload),
      };
    case 'JobApplicationSubmitted':
      return {
        ...projection,
        jobApplications: [
          ...projection.jobApplications,
          {
            applicationId: event.payload.applicationId,
            cycleNumber: event.payload.cycleNumber,
            agentId: event.payload.agentId,
            occupationName: event.payload.occupationName,
            residentialTier: event.payload.residentialTier,
            educationScore: event.payload.educationScore,
            ...(event.payload.effectiveEducationScore === undefined
              ? {}
              : { effectiveEducationScore: event.payload.effectiveEducationScore }),
            submittedAt: event.occurredAt,
            status: 'pending',
          },
        ],
      };
    case 'JobApplicationResolved':
      assertMatchingPendingJobApplication(projection, event.payload);
      return {
        ...projection,
        jobApplications: projection.jobApplications.map((application) =>
          application.applicationId === event.payload.applicationId
            ? {
                ...application,
                status: event.payload.status,
                resolvedAt: event.occurredAt,
                resolutionReason: event.payload.reason,
              }
            : application,
        ),
      };
    case 'JobAssigned':
      return updateAgent(
        {
          ...projection,
          jobApplications: markAssignedJobApplication(projection, event),
        },
        event.payload.agentId,
        (agent) => ({
          ...agent,
          job: event.payload.occupationName,
        }),
      );
    case 'RecruitmentCycleCompleted':
      return {
        ...projection,
        recruitmentCycles: [
          ...projection.recruitmentCycles,
          {
            cycleNumber: event.payload.cycleNumber,
            cycleStartedAt: event.payload.cycleStartedAt,
            cycleEndedAt: event.payload.cycleEndedAt,
            completedAt: event.occurredAt,
            policyVersion: event.payload.policyVersion,
            applicationCount: event.payload.applicationCount,
            acceptedCount: event.payload.acceptedCount,
            rejectedCount: event.payload.rejectedCount,
          },
        ],
      };
    case 'EducationExamApplicationSubmitted':
      return {
        ...projection,
        educationExamApplications: [
          ...projection.educationExamApplications,
          {
            applicationId: event.payload.applicationId,
            cycleNumber: event.payload.cycleNumber,
            agentId: event.payload.agentId,
            targetLevel: event.payload.targetLevel,
            educationScore: event.payload.educationScore,
            ...(event.payload.effectiveEducationScore === undefined
              ? {}
              : { effectiveEducationScore: event.payload.effectiveEducationScore }),
            submittedAt: event.occurredAt,
            status: 'pending',
          },
        ],
      };
    case 'EducationExamResolved': {
      assertMatchingPendingEducationExamApplication(projection, event.payload);
      // A rejected resolution is also the agent's exam-attempt bookkeeping: the
      // counter moves only here, never in the EducationLevelChanged reducer.
      const resolvedProjection = {
        ...projection,
        educationExamApplications: projection.educationExamApplications.map((application) =>
          application.applicationId === event.payload.applicationId
            ? {
                ...application,
                status: event.payload.status,
                resolvedAt: event.occurredAt,
                resolutionReason: event.payload.reason,
              }
            : application,
        ),
      };
      if (event.payload.status !== 'rejected') {
        return resolvedProjection;
      }
      return updateAgent(resolvedProjection, event.payload.agentId, (agent) => ({
        ...agent,
        examAttempts: (agent.examAttempts ?? 0) + 1,
      }));
    }
    case 'EducationExamCycleCompleted':
      return {
        ...projection,
        educationExamCycles: [
          ...projection.educationExamCycles,
          {
            cycleNumber: event.payload.cycleNumber,
            cycleStartedAt: event.payload.cycleStartedAt,
            cycleEndedAt: event.payload.cycleEndedAt,
            completedAt: event.occurredAt,
            policyVersion: event.payload.policyVersion,
            applicationCount: event.payload.applicationCount,
            admittedCount: event.payload.admittedCount,
            rejectedCount: event.payload.rejectedCount,
            applicationsByLevel: { ...event.payload.applicationsByLevel },
            admittedByLevel: { ...event.payload.admittedByLevel },
            cutoffScoresByLevel: { ...event.payload.cutoffScoresByLevel },
          },
        ],
      };
    case 'ResidentialTierUpgraded':
      // The upgrade fee is burned: it leaves circulation entirely.
      return updateAgent(
        applyMoneyTransferToSupply(projection, {
          transactionId: event.id,
          reason: 'residential-tier-upgrade',
          fromSector: 'agent',
          fromId: event.payload.agentId,
          toSector: 'external',
          toId: 'housing-construction',
          amount: event.payload.currencyCost,
        }),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: agent.balance - event.payload.currencyCost,
          residentialTier: event.payload.nextResidentialTier,
          inventory: applyInventoryChanges(agent.inventory, event.payload.consumedInventory, -1),
        }),
      );
    case 'AgentResidenceChanged': {
      const residence = projection.locations[event.payload.nextResidenceLocationId];
      if (residence === undefined || residence.kind !== 'residence') {
        throw new Error(`unknown residential location ${event.payload.nextResidenceLocationId}`);
      }
      if (
        residence.capacity !== event.payload.capacityAtDecision ||
        event.payload.occupancyAfter !== event.payload.occupancyBefore + 1 ||
        event.payload.occupancyBefore < 0 ||
        (event.payload.capacityAtDecision !== null &&
          event.payload.occupancyAfter > event.payload.capacityAtDecision)
      ) {
        throw new Error(`invalid residence occupancy evidence for ${residence.locationId}`);
      }
      const occupied = resolveResidentialOccupancy(
        projection,
        event.payload.nextResidenceLocationId,
      );
      if (occupied !== event.payload.occupancyBefore) {
        throw new Error(
          `residence ${residence.locationId} occupancy expected ${event.payload.occupancyBefore}, available ${occupied}`,
        );
      }
      return updateAgent(projection, event.payload.agentId, (agent) => {
        const previous = resolveAgentResidenceLocationId(projection, agent);
        if (previous !== event.payload.previousResidenceLocationId) {
          throw new Error(
            `agent ${agent.agentId} residence expected ${String(event.payload.previousResidenceLocationId)}, available ${String(previous)}`,
          );
        }
        return { ...agent, residenceLocationId: event.payload.nextResidenceLocationId };
      });
    }
    case 'HousingCapacityExpanded': {
      const location = projection.locations[event.payload.locationId];
      if (location === undefined) {
        throw new Error(`unknown housing location ${event.payload.locationId}`);
      }
      if (location.kind !== 'residence' || location.capacity === null) {
        throw new Error(`location ${location.locationId} is not finite residential capacity`);
      }
      if (location.capacity !== event.payload.previousCapacity) {
        throw new Error(
          `housing capacity for ${location.locationId} expected ${event.payload.previousCapacity}, available ${location.capacity}`,
        );
      }
      if (
        event.payload.addedCapacity <= 0 ||
        event.payload.nextCapacity !== event.payload.previousCapacity + event.payload.addedCapacity
      ) {
        throw new Error(`invalid housing capacity expansion for ${location.locationId}`);
      }
      return {
        ...projection,
        locations: {
          ...projection.locations,
          [location.locationId]: {
            ...location,
            capacity: event.payload.nextCapacity,
          },
        },
      };
    }
    case 'ResidentialTierDowngraded':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        residentialTier: event.payload.nextResidentialTier,
        upkeepArrears: 0,
      }));
    case 'ResidentialUpkeepArrearsUpdated':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        upkeepArrears: event.payload.nextArrears,
      }));
    case 'AgentTimeEffectsSettled':
      return {
        ...projection,
        timeSettlementByAgent: {
          ...(projection.timeSettlementByAgent ?? {}),
          [event.payload.agentId]: event.payload.nextSettledAt,
        },
      };
    case 'ResidentialUpkeepCharged':
      return updateAgent(
        applyMoneyTransferToSupply(projection, {
          transactionId: event.id,
          reason: 'residential-upkeep',
          fromSector: 'agent',
          fromId: event.payload.agentId,
          toSector: 'external',
          toId: 'housing-maintenance',
          amount: event.payload.amount,
        }),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: event.payload.nextBalance,
        }),
      );
    case 'MedicalTreatmentCharged':
      return updateAgent(
        applyMoneyTransferToSupply(projection, {
          transactionId: event.id,
          reason: 'medical-treatment',
          fromSector: 'agent',
          fromId: event.payload.agentId,
          toSector: 'external',
          toId: 'medical-services',
          amount: event.payload.amount,
        }),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: event.payload.nextBalance,
        }),
      );
    case 'SocialInteractionCompleted':
      return {
        ...projection,
        socialRelations: {
          ...projection.socialRelations,
          [createDirectedSocialRelationKey(event.payload.nextRelation)]: event.payload.nextRelation,
        },
      };
    case 'AgentTravelStarted': {
      const agent = projection.agents[event.payload.agentId];
      if (agent === undefined) {
        throw new Error(`unknown agent ${event.payload.agentId}`);
      }
      if (agent.locationId !== event.payload.fromLocationId) {
        throw new Error(
          `agent ${event.payload.agentId} travel origin ${event.payload.fromLocationId} does not match location ${agent.locationId}`,
        );
      }
      if ((projection.transitByAgent ?? {})[event.payload.agentId] !== undefined) {
        throw new Error(`agent ${event.payload.agentId} is already in transit`);
      }
      return {
        ...projection,
        transitByAgent: {
          ...(projection.transitByAgent ?? {}),
          [event.payload.agentId]: {
            ...event.payload,
            routeLocationIds: [...event.payload.routeLocationIds],
            ...(event.payload.routeEdgeFlows === undefined
              ? {}
              : {
                  routeEdgeFlows: event.payload.routeEdgeFlows.map((edge) => ({ ...edge })),
                }),
          },
        },
      };
    }
    case 'AgentLocationChanged':
      return {
        ...updateAgent(projection, event.payload.agentId, (agent) => ({
          ...agent,
          locationId: event.payload.nextLocationId,
        })),
        transitByAgent: Object.fromEntries(
          Object.entries(projection.transitByAgent ?? {}).filter(
            ([agentId]) => agentId !== event.payload.agentId,
          ),
        ),
      };
    case 'LocationObserved':
      return {
        ...projection,
        locationObservations: [
          ...projection.locationObservations,
          {
            agentId: event.payload.agentId,
            locationId: event.payload.locationId,
            locationName: event.payload.locationName,
            observedAgentIds: [...event.payload.observedAgentIds],
            activityAffinities: [...event.payload.activityAffinities],
            observedAt: event.occurredAt,
            ...(event.payload.focus === undefined ? {} : { focus: event.payload.focus }),
          },
        ],
      };
    case 'ConversationRecorded':
      return {
        ...projection,
        conversationRecords: [
          ...projection.conversationRecords,
          cloneConversationRecord({
            conversationId: event.payload.conversationId,
            initiatorAgentId: event.payload.initiatorAgentId,
            participantAgentIds: event.payload.participantAgentIds,
            locationId: event.payload.locationId,
            topic: event.payload.topic,
            turns: event.payload.turns,
            recordedAt: event.occurredAt,
          }),
        ],
        socialCommitments: applyConversationCommitmentChanges(projection, event),
      };
    case 'InventoryChanged':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        inventory:
          event.payload.delta >= 0
            ? addInventory(agent.inventory, event.payload.itemName, event.payload.delta)
            : removeInventory(agent.inventory, event.payload.itemName, -event.payload.delta),
      }));
    case 'PhysiologyChanged':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        physiology: event.payload.next,
      }));
    case 'PhysiologicalDistressChanged':
      return applyPhysiologicalDistressChange(projection, event);
    case 'SafetyNetGranted':
      return applySafetyNetGrant(projection, event);
    case 'WellbeingChanged':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        wellbeing: event.payload.next,
      }));
    case 'EducationInvestmentPaid':
      return updateAgent(
        applyMoneyTransferToSupply(projection, {
          transactionId: event.id,
          reason: 'education-investment',
          fromSector: 'agent',
          fromId: event.payload.agentId,
          toSector: 'external',
          toId: 'education-services',
          amount: event.payload.currencyCost,
        }),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: event.payload.nextBalance,
          inventory: applyInventoryChanges(agent.inventory, event.payload.consumedInventory, -1),
        }),
      );
    case 'EducationChanged':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        educationScore: event.payload.nextEducationScore,
      }));
    case 'EducationLevelChanged':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        educationLevel: event.payload.nextLevel,
        ...(event.payload.track === undefined ? {} : { educationTrack: event.payload.track }),
      }));
    case 'EducationCompulsoryFeeCovered': {
      // Treasury-covered tuition follows the PublicBudgetSpent treatment: a
      // transfer from the treasury into the public education service account
      // that leaves moneySupply unchanged. The self-paid share follows the
      // legacy education-investment treatment and leaves circulation.
      const treasuryProjection =
        event.payload.coveredAmount > 0
          ? applyMoneyTransferToSupply(
              {
                ...projection,
                treasury: (projection.treasury ?? 0) - event.payload.coveredAmount,
                // The covered tuition lands in the public education service
                // account, mirroring the PublicBudgetSpent treatment.
                publicBudget: {
                  cumulativeSpendingByService: {
                    ...(projection.publicBudget?.cumulativeSpendingByService ?? {}),
                  },
                  serviceBalances: {
                    ...(projection.publicBudget?.serviceBalances ?? {}),
                    education:
                      (projection.publicBudget?.serviceBalances['education'] ?? 0) +
                      event.payload.coveredAmount,
                  },
                  lastSettledAt: projection.publicBudget?.lastSettledAt ?? event.occurredAt,
                },
              },
              {
                transactionId: event.id,
                reason: 'compulsory-education-tuition',
                fromSector: 'treasury',
                fromId: 'public-treasury',
                toSector: 'public-service',
                toId: 'education',
                amount: event.payload.coveredAmount,
              },
            )
          : projection;
      return updateAgent(
        event.payload.selfPaidAmount === 0
          ? treasuryProjection
          : applyMoneyTransferToSupply(treasuryProjection, {
              transactionId: `${event.id}:self-paid`,
              reason: 'compulsory-education-self-payment',
              fromSector: 'agent',
              fromId: event.payload.agentId,
              toSector: 'external',
              toId: 'education-services',
              amount: event.payload.selfPaidAmount,
            }),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: agent.balance - event.payload.selfPaidAmount,
        }),
      );
    }
    case 'ResidentParticipationEnded':
      return applyResidentParticipationEnded(projection, event);
    case 'AgentActivityTimeCommitted':
      return applyAgentActivityTimeCommitment(projection, event);
    case 'WagePaid': {
      // Minted wages increase the money supply; employer/treasury-paid wages are
      // transfers and leave the supply unchanged (the payer account is debited
      // by its own companion event).
      const fundingSource = event.payload.fundingSource ?? 'mint';
      const fundedProjection =
        fundingSource === 'mint'
          ? applyMoneyTransferToSupply(projection, {
              transactionId: event.id,
              reason: 'minted-wage',
              fromSector: 'monetary-authority',
              fromId: 'system',
              toSector: 'agent',
              toId: event.payload.agentId,
              amount: event.payload.amount,
            })
          : fundingSource === 'employer' && event.payload.enterpriseId !== undefined
            ? updateEnterprise(
                applyMoneyTransferToSupply(projection, {
                  transactionId: event.id,
                  reason: 'employer-payroll',
                  fromSector: 'enterprise',
                  fromId: event.payload.enterpriseId,
                  toSector: 'agent',
                  toId: event.payload.agentId,
                  amount: event.payload.amount,
                }),
                event.payload.enterpriseId,
                (enterprise) =>
                  applyEnterpriseDomainEvent(enterprise, {
                    type: 'EnterprisePayrollRecorded',
                    amount: event.payload.amount,
                  }),
              )
            : fundingSource === 'treasury'
              ? applyMoneyTransferToSupply(
                  { ...projection, treasury: (projection.treasury ?? 0) - event.payload.amount },
                  {
                    transactionId: event.id,
                    reason: 'treasury-payroll',
                    fromSector: 'treasury',
                    fromId: 'public-treasury',
                    toSector: 'agent',
                    toId: event.payload.agentId,
                    amount: event.payload.amount,
                  },
                )
              : projection;
      return updateAgent(fundedProjection, event.payload.agentId, (agent) => ({
        ...agent,
        balance: agent.balance + event.payload.amount,
      }));
    }
    case 'IncomeTaxCharged':
      // Taxes are transfers: the agent balance is debited and the treasury is
      // credited by the same amount; moneySupply is unchanged.
      return updateAgent(
        applyMoneyTransferToSupply(
          {
            ...projection,
            treasury: (projection.treasury ?? 0) + event.payload.amount,
          },
          {
            transactionId: event.id,
            reason: 'income-tax',
            fromSector: 'agent',
            fromId: event.payload.agentId,
            toSector: 'treasury',
            toId: 'public-treasury',
            amount: event.payload.amount,
          },
        ),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: event.payload.nextBalance,
        }),
      );
    case 'TradeTaxCharged':
      if (event.payload.enterpriseId !== undefined) {
        return updateEnterprise(
          applyMoneyTransferToSupply(
            {
              ...projection,
              treasury: (projection.treasury ?? 0) + event.payload.amount,
            },
            {
              transactionId: event.id,
              reason: 'enterprise-trade-tax',
              fromSector: 'enterprise',
              fromId: event.payload.enterpriseId,
              toSector: 'treasury',
              toId: 'public-treasury',
              amount: event.payload.amount,
            },
          ),
          event.payload.enterpriseId,
          (enterprise) =>
            applyEnterpriseDomainEvent(enterprise, {
              type: 'EnterpriseTaxRecorded',
              amount: event.payload.amount,
            }),
        );
      }
      return updateAgent(
        applyMoneyTransferToSupply(
          {
            ...projection,
            treasury: (projection.treasury ?? 0) + event.payload.amount,
          },
          {
            transactionId: event.id,
            reason: 'trade-tax',
            fromSector: 'agent',
            fromId: event.payload.agentId,
            toSector: 'treasury',
            toId: 'public-treasury',
            amount: event.payload.amount,
          },
        ),
        event.payload.agentId,
        (agent) => ({ ...agent, balance: event.payload.nextBalance }),
      );
    case 'DividendTaxCharged':
      // Dividend tax is a transfer from the enterprise cash account into the
      // treasury; moneySupply is unchanged. The treasury delta is computed
      // incrementally (not from the audit payload) so same-tick budget
      // spending cannot resurrect or double-count funds.
      return updateEnterprise(
        applyMoneyTransferToSupply(
          {
            ...projection,
            treasury: (projection.treasury ?? 0) + event.payload.amount,
          },
          {
            transactionId: event.id,
            reason: 'dividend-tax',
            fromSector: 'enterprise',
            fromId: event.payload.enterpriseId,
            toSector: 'treasury',
            toId: 'public-treasury',
            amount: event.payload.amount,
          },
        ),
        event.payload.enterpriseId,
        (enterprise) =>
          applyEnterpriseDomainEvent(enterprise, {
            type: 'EnterpriseTaxRecorded',
            amount: event.payload.amount,
          }),
      );
    case 'SubsidyPaid': {
      // Minted subsidies increase the money supply; treasury-funded subsidies
      // are transfers from the treasury (supply unchanged).
      const fundingSource = event.payload.fundingSource ?? 'mint';
      return updateAgent(
        fundingSource === 'treasury'
          ? applyMoneyTransferToSupply(
              { ...projection, treasury: (projection.treasury ?? 0) - event.payload.amount },
              {
                transactionId: event.id,
                reason: 'treasury-subsidy',
                fromSector: 'treasury',
                fromId: 'public-treasury',
                toSector: 'agent',
                toId: event.payload.agentId,
                amount: event.payload.amount,
              },
            )
          : applyMoneyTransferToSupply(projection, {
              transactionId: event.id,
              reason: 'minted-subsidy',
              fromSector: 'monetary-authority',
              fromId: 'system',
              toSector: 'agent',
              toId: event.payload.agentId,
              amount: event.payload.amount,
            }),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: event.payload.nextBalance,
        }),
      );
    }
    case 'PublicBudgetSpent':
      return applyMoneyTransferToSupply(
        {
          ...projection,
          treasury: event.payload.nextTreasury,
          publicBudget: {
            cumulativeSpendingByService: {
              ...(projection.publicBudget?.cumulativeSpendingByService ?? {}),
              [event.payload.service]:
                (projection.publicBudget?.cumulativeSpendingByService[event.payload.service] ?? 0) +
                event.payload.amount,
            },
            serviceBalances: {
              ...(projection.publicBudget?.serviceBalances ?? {}),
              [event.payload.service]:
                (projection.publicBudget?.serviceBalances[event.payload.service] ?? 0) +
                event.payload.amount,
            },
            lastSettledAt: event.payload.settledAt,
          },
        },
        {
          transactionId: event.id,
          reason: `public-budget:${event.payload.service}`,
          fromSector: 'treasury',
          fromId: 'public-treasury',
          toSector: 'public-service',
          toId: event.payload.service,
          amount: event.payload.amount,
        },
      );
    case 'ShortTermMemoryRecorded':
      return {
        ...projection,
        memoryRecords: [
          ...projection.memoryRecords.slice(-(WORLD_PROJECTION_RECENT_MEMORY_RECORD_LIMIT - 1)),
          event.payload.record,
        ],
      };
    case 'SimulationTimeAdvanced':
      if (
        event.payload.socialRelationDecayPolicyVersion !== undefined &&
        event.payload.socialRelationDecayPolicyVersion !== 'social-relation-decay-v1'
      ) {
        throw new Error(
          `unsupported social relation decay policy ${event.payload.socialRelationDecayPolicyVersion}`,
        );
      }
      return {
        ...projection,
        clock: { ...event.payload.next },
        ...(projection.pendingRegionalLandValueUpdates === undefined
          ? {}
          : {
              pendingRegionalLandValueUpdates: projection.pendingRegionalLandValueUpdates.filter(
                (update) => update.settledAt > event.payload.next.now,
              ),
            }),
        socialRelations: Object.fromEntries(
          Object.entries(projection.socialRelations).map(([key, relation]) => [
            key,
            decaySocialRelation(relation, event.payload.deltaMs),
          ]),
        ),
      };
    case 'ActionRejected':
      return {
        ...projection,
        rejectedActions: [...projection.rejectedActions, event.payload],
        ...(resolveScarcityRejectionCommodity(event.payload.reason) === undefined
          ? {}
          : {
              resourceFlowMetrics: {
                cumulativeExtractedByCommodity: {
                  ...projection.resourceFlowMetrics?.cumulativeExtractedByCommodity,
                },
                scarcityRejectionsByCommodity: incrementMetric(
                  projection.resourceFlowMetrics?.scarcityRejectionsByCommodity,
                  resolveScarcityRejectionCommodity(event.payload.reason)!,
                  1,
                ),
              },
            }),
      };
    case 'GovernanceChangeRejected':
      return projection;
    case 'WeatherChanged':
      return {
        ...projection,
        weather: {
          current: event.payload.to,
          since: event.payload.transitionedAt,
        },
      };
    case 'TownDayPhaseChanged':
      return {
        ...projection,
        calendar: {
          dayIndex: event.payload.dayIndex,
          phase: event.payload.phase,
          since: event.payload.startedAtMs,
        },
      };
    case 'AgentAged':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        lifeStage: event.payload.nextStage,
      }));
    case 'AgentRetired':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        job: null,
        retiredAtMs: event.payload.retiredAtMs,
      }));
    case 'PensionPaid':
      // Treasury-funded pensions transfer between circulating accounts
      // (supply unchanged); runs without a treasury slice mint instead,
      // mirroring the WagePaid/SubsidyPaid funding-source convention.
      return updateAgent(
        event.payload.fundingSource === 'treasury'
          ? applyMoneyTransferToSupply(
              { ...projection, treasury: (projection.treasury ?? 0) - event.payload.amount },
              {
                transactionId: event.id,
                reason: 'retirement-pension',
                fromSector: 'treasury',
                fromId: 'public-treasury',
                toSector: 'agent',
                toId: event.payload.agentId,
                amount: event.payload.amount,
              },
            )
          : applyMoneyTransferToSupply(projection, {
              transactionId: event.id,
              reason: 'minted-pension',
              fromSector: 'monetary-authority',
              fromId: 'system',
              toSector: 'agent',
              toId: event.payload.agentId,
              amount: event.payload.amount,
            }),
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: event.payload.nextBalance,
        }),
      );
    case 'AgentDied':
      return applyAgentDeparture(
        {
          ...projection,
          survivalOutcomes: {
            deathsByCause: incrementMetric(
              projection.survivalOutcomes?.deathsByCause,
              event.payload.cause,
              1,
            ),
            emigrated: projection.survivalOutcomes?.emigrated ?? 0,
          },
        },
        event.payload.agentId,
        event.payload.estate,
        event.id,
      );
    case 'AgentEmigrated':
      return applyAgentDeparture(
        {
          ...projection,
          survivalOutcomes: {
            deathsByCause: { ...projection.survivalOutcomes?.deathsByCause },
            emigrated: (projection.survivalOutcomes?.emigrated ?? 0) + 1,
          },
        },
        event.payload.agentId,
        event.payload.estate,
        event.id,
      );
    case 'BulletinScheduled': {
      const bulletins = projection.bulletins ?? [];
      if (bulletins.some((bulletin) => bulletin.bulletinId === event.payload.bulletin.bulletinId)) {
        throw new Error(`cannot replay duplicate bulletin ${event.payload.bulletin.bulletinId}`);
      }
      return {
        ...projection,
        bulletins: [
          ...bulletins,
          { ...cloneTownBulletin(event.payload.bulletin), status: 'scheduled' },
        ],
      };
    }

    case 'PetitionRaised': {
      if (
        (projection.petitions ?? []).some(
          (petition) => petition.petitionId === event.payload.petition.petitionId,
        )
      ) {
        throw new Error(`cannot replay duplicate petition ${event.payload.petition.petitionId}`);
      }
      return {
        ...projection,
        petitions: [
          ...(projection.petitions ?? []),
          {
            ...event.payload.petition,
            signatureAgentIds: [...event.payload.petition.signatureAgentIds],
          },
        ],
      };
    }
    case 'PetitionSigned': {
      const petition = requirePetition(projection, event.payload.petitionId);
      if (petition.status !== 'open') {
        throw new Error(`cannot sign ${petition.status} petition ${petition.petitionId}`);
      }
      if (petition.signatureAgentIds.includes(event.payload.agentId)) {
        throw new Error(
          `agent ${event.payload.agentId} already signed petition ${petition.petitionId}`,
        );
      }
      if (petition.signatureAgentIds.length + 1 !== event.payload.signatureCount) {
        throw new Error(
          `petition signature count disagrees with the book for ${petition.petitionId}`,
        );
      }
      return {
        ...projection,
        petitions: (projection.petitions ?? []).map((candidate) =>
          candidate.petitionId === petition.petitionId
            ? {
                ...candidate,
                signatureAgentIds: [...candidate.signatureAgentIds, event.payload.agentId],
              }
            : candidate,
        ),
      };
    }
    case 'PetitionThresholdReached': {
      const petition = requirePetition(projection, event.payload.petitionId);
      if (petition.status !== 'open') {
        throw new Error(
          `petition ${petition.petitionId} is ${petition.status}, cannot reach threshold`,
        );
      }
      if (event.payload.signatureCount !== petition.signatureAgentIds.length) {
        throw new Error(
          `petition threshold count disagrees with the book for ${petition.petitionId}`,
        );
      }
      return {
        ...projection,
        petitions: (projection.petitions ?? []).map((candidate) =>
          candidate.petitionId === petition.petitionId
            ? {
                ...candidate,
                status: 'threshold-reached' as const,
                thresholdReachedAt: event.payload.reachedAt,
              }
            : candidate,
        ),
      };
    }
    case 'PetitionExpired': {
      const petition = requirePetition(projection, event.payload.petitionId);
      if (petition.status !== 'open') {
        throw new Error(`petition ${petition.petitionId} is ${petition.status}, cannot expire`);
      }
      return {
        ...projection,
        petitions: (projection.petitions ?? []).map((candidate) =>
          candidate.petitionId === petition.petitionId
            ? { ...candidate, status: 'expired' as const }
            : candidate,
        ),
      };
    }
    case 'BulletinPosted': {
      const bulletins = projection.bulletins ?? [];
      const bulletinId = event.payload.bulletin.bulletinId;
      if (bulletins.some((bulletin) => bulletin.bulletinId === bulletinId)) {
        // Activation of a previously scheduled bulletin.
        return {
          ...projection,
          bulletins: bulletins.map((bulletin) =>
            bulletin.bulletinId === bulletinId
              ? { ...cloneTownBulletin(event.payload.bulletin), status: 'effective' }
              : bulletin,
          ),
        };
      }
      return {
        ...projection,
        bulletins: [
          ...bulletins,
          { ...cloneTownBulletin(event.payload.bulletin), status: 'effective' },
        ],
      };
    }
    case 'MatterRaised': {
      const matters = projection.socialMatters ?? {};
      const matter = event.payload.matter;
      if (matters[matter.matterId] !== undefined) {
        throw new Error(`cannot replay duplicate social matter ${matter.matterId}`);
      }
      return {
        ...projection,
        socialMatters: { ...matters, [matter.matterId]: cloneSocialMatter(matter) },
      };
    }
    case 'MatterResponded': {
      const matter = requireSocialMatter(projection, event.payload.matterId);
      if (matter.status !== 'open' && matter.status !== 'collecting') {
        throw new Error(`social matter ${matter.matterId} is not open for responses`);
      }
      const retained = matter.responses.filter(
        (response) => response.responderAgentId !== event.payload.responderAgentId,
      );
      const responses =
        event.payload.decision === 'withdraw'
          ? retained
          : [
              ...retained,
              {
                responderAgentId: event.payload.responderAgentId,
                decision: event.payload.decision,
                respondedAt: event.payload.respondedAt,
              },
            ];
      return {
        ...projection,
        socialMatters: {
          ...projection.socialMatters,
          [matter.matterId]: {
            ...cloneSocialMatter(matter),
            responses,
            status: responses.some((response) => response.decision === 'accept')
              ? 'collecting'
              : 'open',
          },
        },
      };
    }
    case 'MatterAssigned': {
      const matter = requireSocialMatter(projection, event.payload.matterId);
      if (matter.status !== 'open' && matter.status !== 'collecting') {
        throw new Error(`social matter ${matter.matterId} is not assignable`);
      }
      return {
        ...projection,
        socialMatters: {
          ...projection.socialMatters,
          [matter.matterId]: {
            ...cloneSocialMatter(matter),
            status: 'assigned',
            assigneeAgentId: event.payload.assigneeAgentId,
            assignedAt: event.payload.assignedAt,
          },
        },
      };
    }
    case 'MatterProgressed': {
      const matter = requireSocialMatter(projection, event.payload.matterId);
      if (matter.status !== 'assigned' && matter.status !== 'executing') {
        throw new Error(`social matter ${matter.matterId} is not in progress`);
      }
      return {
        ...projection,
        socialMatters: {
          ...projection.socialMatters,
          [matter.matterId]: {
            ...cloneSocialMatter(matter),
            status: 'executing',
            deliveredQuantity: event.payload.deliveredQuantity,
          },
        },
      };
    }
    case 'MatterClosed': {
      const matter = requireSocialMatter(projection, event.payload.matterId);
      if (matter.status === 'closed') {
        throw new Error(`social matter ${matter.matterId} is already closed`);
      }
      return {
        ...projection,
        socialMatters: {
          ...projection.socialMatters,
          [matter.matterId]: {
            ...cloneSocialMatter(matter),
            status: 'closed',
            closure: event.payload.closure,
            closedAt: event.payload.closedAt,
            ...(event.payload.fulfillmentEventId === undefined
              ? {}
              : { fulfillmentEventId: event.payload.fulfillmentEventId }),
          },
        },
      };
    }
    case 'ConfrontationRecorded':
      return {
        ...projection,
        conflictRecords: [
          ...(projection.conflictRecords ?? []),
          {
            conflictId: event.payload.conflictId,
            kind: 'confrontation',
            actorAgentId: event.payload.initiatorAgentId,
            targetAgentId: event.payload.targetAgentId,
            locationId: event.payload.locationId,
            summary: event.payload.statement,
            recordedAt: event.payload.recordedAt,
          },
        ],
      };
    case 'AttackRecorded':
      return {
        ...projection,
        conflictRecords: [
          ...(projection.conflictRecords ?? []),
          {
            conflictId: event.payload.conflictId,
            kind: 'attack',
            actorAgentId: event.payload.attackerAgentId,
            targetAgentId: event.payload.targetAgentId,
            locationId: event.payload.locationId,
            damage: event.payload.damage,
            summary: `Attack on ${event.payload.targetAgentId} for ${event.payload.damage} damage`,
            recordedAt: event.payload.recordedAt,
          },
        ],
      };
    case 'InterventionRecorded':
      return {
        ...projection,
        conflictRecords: [
          ...(projection.conflictRecords ?? []),
          {
            conflictId: event.payload.conflictId,
            kind: 'intervention',
            actorAgentId: event.payload.intervenerAgentId,
            targetAgentId: event.payload.targetAgentId,
            counterpartyAgentId: event.payload.attackerAgentId,
            locationId: event.payload.locationId,
            summary: event.payload.statement,
            recordedAt: event.payload.recordedAt,
          },
        ],
      };
    case 'AgentOwnershipDeparted': {
      const agent = projection.agents[event.payload.agentId];
      if (agent === undefined) {
        throw new Error(
          `cannot replay ownership departure for unknown agent ${event.payload.agentId}`,
        );
      }
      const agents = { ...projection.agents };
      delete agents[event.payload.agentId];
      const transitByAgent = { ...(projection.transitByAgent ?? {}) };
      delete transitByAgent[event.payload.agentId];
      const activityTimeByAgent = { ...projection.activityTimeByAgent };
      delete activityTimeByAgent[event.payload.agentId];
      const timeSettlementByAgent = { ...(projection.timeSettlementByAgent ?? {}) };
      delete timeSettlementByAgent[event.payload.agentId];
      const physiologicalDistressByAgent = { ...projection.physiologicalDistressByAgent };
      delete physiologicalDistressByAgent[event.payload.agentId];
      const circulatingBalanceTransferred = event.payload.circulatingBalanceTransferred ?? 0;
      assertOwnershipCirculatingBalance({
        eventType: event.type,
        agentBalance: agent.balance,
        circulatingBalanceTransferred,
        currentMoneySupply: projection.moneySupply,
      });
      return {
        ...projection,
        moneySupply: projection.moneySupply - circulatingBalanceTransferred,
        agents,
        transitByAgent,
        activityTimeByAgent,
        timeSettlementByAgent,
        physiologicalDistressByAgent,
        // Departure cancels the migrant's pending applications in the source
        // projection: the later recruitment/exam cycles of THIS partition must
        // never resolve an application for an agent that now lives elsewhere
        // (the memory-event lookup would crash the whole advance). The
        // migrant re-applies on the destination partition next cycle.
        jobApplications: withoutPendingApplicationsOf(
          projection.jobApplications,
          event.payload.agentId,
        ),
        educationExamApplications: withoutPendingApplicationsOf(
          projection.educationExamApplications,
          event.payload.agentId,
        ),
      };
    }
    case 'AgentOwnershipArrived': {
      if (projection.agents[event.payload.agentId] !== undefined) {
        throw new Error(
          `cannot replay duplicate ownership arrival for agent ${event.payload.agentId}`,
        );
      }
      const state = event.payload.agentState;
      const circulatingBalanceTransferred = event.payload.circulatingBalanceTransferred ?? 0;
      assertOwnershipCirculatingBalance({
        eventType: event.type,
        agentBalance: state.balance,
        circulatingBalanceTransferred,
        currentMoneySupply: projection.moneySupply,
      });
      const socialRelations = { ...projection.socialRelations };
      for (const relation of event.payload.socialRelations ?? []) {
        socialRelations[createDirectedSocialRelationKey(relation)] = { ...relation };
      }
      const socialCommitments = { ...projection.socialCommitments };
      for (const commitment of event.payload.socialCommitments ?? []) {
        socialCommitments[commitment.commitmentId] = { ...commitment };
      }
      const incomingConflictIds = new Set(
        (projection.conflictRecords ?? []).map((record) => record.conflictId),
      );
      const conflictRecords = [
        ...(projection.conflictRecords ?? []),
        ...(event.payload.conflictRecords ?? [])
          .filter((record) => !incomingConflictIds.has(record.conflictId))
          .map((record) => ({ ...record })),
      ];
      return {
        ...projection,
        moneySupply: projection.moneySupply + circulatingBalanceTransferred,
        socialRelations,
        socialCommitments,
        ...(projection.conflictRecords === undefined && event.payload.conflictRecords === undefined
          ? {}
          : { conflictRecords }),
        agents: {
          ...projection.agents,
          [event.payload.agentId]: {
            agentId: event.payload.agentId,
            locationId: state.locationId,
            ...(state.residenceLocationId === undefined
              ? {}
              : { residenceLocationId: state.residenceLocationId }),
            physiology: { ...state.physiology },
            educationScore: state.educationScore,
            balance: state.balance,
            residentialTier: state.residentialTier,
            job: state.job,
            inventory: { ...state.inventory },
            ...(state.durableGoods === undefined
              ? {}
              : { durableGoods: state.durableGoods.map((lot) => ({ ...lot })) }),
            ...(state.upkeepArrears === undefined ? {} : { upkeepArrears: state.upkeepArrears }),
            ...(state.wellbeing === undefined ? {} : { wellbeing: state.wellbeing }),
            ...(state.lifeStage === undefined ? {} : { lifeStage: state.lifeStage }),
            ...(state.retiredAtMs === undefined ? {} : { retiredAtMs: state.retiredAtMs }),
            ...(state.registeredAtMs === undefined ? {} : { registeredAtMs: state.registeredAtMs }),
            ...(state.educationLevel === undefined ? {} : { educationLevel: state.educationLevel }),
            ...(state.educationTrack === undefined ? {} : { educationTrack: state.educationTrack }),
            ...(state.examAttempts === undefined ? {} : { examAttempts: state.examAttempts }),
            ...(state.registration === undefined
              ? {}
              : {
                  registration: {
                    ...state.registration,
                    ...(state.registration.humanAttribution === undefined
                      ? {}
                      : {
                          humanAttribution: {
                            ...state.registration.humanAttribution,
                            principalRoles: [...state.registration.humanAttribution.principalRoles],
                          },
                        }),
                  },
                }),
          },
        },
        ...(event.payload.activityTime === undefined
          ? {}
          : {
              activityTimeByAgent: {
                ...projection.activityTimeByAgent,
                [event.payload.agentId]: { ...event.payload.activityTime },
              },
            }),
        ...(event.payload.lastTimeSettledAt === undefined
          ? {}
          : {
              timeSettlementByAgent: {
                ...(projection.timeSettlementByAgent ?? {}),
                [event.payload.agentId]: event.payload.lastTimeSettledAt,
              },
            }),
        ...(event.payload.physiologicalDistress === undefined
          ? {}
          : {
              physiologicalDistressByAgent: {
                ...projection.physiologicalDistressByAgent,
                [event.payload.agentId]: {
                  ...event.payload.physiologicalDistress,
                  lowAxes: [...event.payload.physiologicalDistress.lowAxes],
                },
              },
            }),
      };
    }
  }
  throw new Error(`unhandled world event ${event.type}`);
}

/** Resolves legacy snapshots without inventing a durable mutation during hydration. */
export function resolveAgentResidenceLocationId(
  projection: Pick<WorldProjection, 'locations'>,
  agent: Pick<WorldAgentState, 'locationId' | 'residenceLocationId'>,
): LocationId | null {
  if (agent.residenceLocationId !== undefined) return agent.residenceLocationId;
  if (agent.locationId !== null && projection.locations[agent.locationId]?.kind === 'residence') {
    return agent.locationId;
  }
  return null;
}

export function resolveResidentialOccupancy(
  projection: Pick<WorldProjection, 'agents' | 'locations'>,
  locationId: LocationId,
): number {
  return Object.values(projection.agents).filter(
    (agent) => resolveAgentResidenceLocationId(projection, agent) === locationId,
  ).length;
}

export function assertResidentialCapacityNotExceeded(
  agents: Readonly<Record<string, WorldAgentState>>,
  locations: Readonly<Record<string, WorldLocationState>>,
): void {
  for (const location of Object.values(locations)) {
    if (location.kind !== 'residence' || location.capacity === null) continue;
    const occupied = resolveResidentialOccupancy({ agents, locations }, location.locationId);
    if (occupied > location.capacity) {
      throw new Error(
        `residence ${location.locationId} occupancy ${occupied} exceeds capacity ${location.capacity}`,
      );
    }
  }
}

export function assertPhysicalLocationCapacityNotExceeded(
  agents: Readonly<Record<string, WorldAgentState>>,
  locations: Readonly<Record<string, WorldLocationState>>,
): void {
  const occupancyByLocationId: Record<string, number> = {};
  for (const agent of Object.values(agents)) {
    if (agent.locationId === null) continue;
    occupancyByLocationId[agent.locationId] = (occupancyByLocationId[agent.locationId] ?? 0) + 1;
  }
  for (const location of Object.values(locations)) {
    if (location.capacity === null) continue;
    const occupied = occupancyByLocationId[location.locationId] ?? 0;
    if (occupied > location.capacity) {
      throw new Error(
        `location ${location.locationId} occupancy ${occupied} exceeds capacity ${location.capacity}`,
      );
    }
  }
}

function assertAgentLocationReferencesValid(
  agents: Readonly<Record<string, WorldAgentState>>,
  locations: Readonly<Record<string, WorldLocationState>>,
): void {
  for (const agent of Object.values(agents)) {
    if (agent.locationId !== null && locations[agent.locationId] === undefined) {
      throw new Error(
        `agent ${agent.agentId} location ${agent.locationId} is not in projection locations`,
      );
    }
    if (agent.residenceLocationId === undefined || agent.residenceLocationId === null) continue;
    const residence = locations[agent.residenceLocationId];
    if (residence === undefined || residence.kind !== 'residence') {
      throw new Error(
        `agent ${agent.agentId} residence ${agent.residenceLocationId} is not a residential location`,
      );
    }
  }
}

function assertOwnershipCirculatingBalance(input: {
  readonly eventType: 'AgentOwnershipDeparted' | 'AgentOwnershipArrived';
  readonly agentBalance: number;
  readonly circulatingBalanceTransferred: number;
  readonly currentMoneySupply: number;
}): void {
  if (
    !Number.isFinite(input.circulatingBalanceTransferred) ||
    input.circulatingBalanceTransferred < 0
  ) {
    throw new Error(`${input.eventType} circulating balance must be finite and non-negative`);
  }
  if (
    input.circulatingBalanceTransferred !== 0 &&
    input.circulatingBalanceTransferred !== input.agentBalance
  ) {
    throw new Error(`${input.eventType} circulating balance must equal the Agent balance`);
  }
  if (
    input.eventType === 'AgentOwnershipDeparted' &&
    input.circulatingBalanceTransferred > input.currentMoneySupply
  ) {
    throw new Error('AgentOwnershipDeparted circulating balance exceeds partition money supply');
  }
}

export function isAgentAvailableForWorldAction(
  projection: WorldProjection,
  agentId: AgentId,
): boolean {
  if (projection.agents[agentId] === undefined) {
    throw new Error(`unknown agent ${agentId}`);
  }
  const activity = projection.activityTimeByAgent[agentId];
  return activity === undefined || projection.clock.now >= activity.availableAt;
}

function applyAgentActivityTimeCommitment(
  projection: WorldProjection,
  event: Extract<WorldEvent, { readonly type: 'AgentActivityTimeCommitted' }>,
): WorldProjection {
  const payload = event.payload;
  if (projection.agents[payload.agentId] === undefined) {
    throw new Error(`unknown agent ${payload.agentId}`);
  }
  if (!Number.isFinite(payload.durationSeconds) || payload.durationSeconds < 0) {
    throw new Error('agent activity durationSeconds must be non-negative finite');
  }
  if (payload.startedAt !== projection.clock.now) {
    throw new Error(
      `agent activity startedAt ${payload.startedAt} must equal simulation time ${projection.clock.now}`,
    );
  }
  const expectedAvailableAt = payload.startedAt + payload.durationSeconds * 1000;
  if (!Number.isFinite(expectedAvailableAt) || payload.availableAt !== expectedAvailableAt) {
    throw new Error(
      `agent activity availableAt ${payload.availableAt} must equal ${expectedAvailableAt}`,
    );
  }
  const previous = projection.activityTimeByAgent[payload.agentId];
  if (previous !== undefined && previous.availableAt > payload.startedAt) {
    throw new Error(
      `agent ${payload.agentId} activity overlaps ${previous.activity} until ${previous.availableAt}`,
    );
  }
  return {
    ...projection,
    activityTimeByAgent: {
      ...projection.activityTimeByAgent,
      [payload.agentId]: {
        ...payload,
        committedAt: event.occurredAt,
      },
    },
  };
}

function applyInventoryChanges(
  inventory: Inventory,
  changes: Inventory,
  direction: 1 | -1,
): Inventory {
  return Object.entries(changes).reduce(
    (nextInventory, [itemName, quantity]) =>
      direction === 1
        ? addInventory(nextInventory, itemName, quantity)
        : removeInventory(nextInventory, itemName, quantity),
    inventory,
  );
}

function cloneConversationRecord(
  record: WorldConversationRecordState,
): WorldConversationRecordState {
  return {
    ...record,
    participantAgentIds: [...record.participantAgentIds],
    turns: record.turns.map((turn) => ({ ...turn })),
  };
}

function applyConversationCommitmentChanges(
  projection: WorldProjection,
  event: Extract<WorldEvent, { readonly type: 'ConversationRecorded' }>,
): Readonly<Record<string, WorldSocialCommitmentState>> {
  const commitments: Record<string, WorldSocialCommitmentState> = Object.fromEntries(
    Object.entries(projection.socialCommitments).map(([id, commitment]) => [id, { ...commitment }]),
  );
  const participantIds = event.payload.participantAgentIds;

  for (const turn of event.payload.turns) {
    const intent = classifySocialCommitmentIntent(turn.intent);
    if (intent !== 'fulfilled' && intent !== 'breached') {
      continue;
    }
    const openCommitment = Object.values(commitments)
      .filter(
        (commitment) =>
          commitment.status === 'open' &&
          commitment.promisorAgentId === turn.speakerAgentId &&
          commitment.topic === event.payload.topic &&
          participantIds.includes(commitment.beneficiaryAgentId),
      )
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.commitmentId.localeCompare(right.commitmentId)
          : left.createdAt - right.createdAt,
      )[0];
    if (openCommitment !== undefined) {
      commitments[openCommitment.commitmentId] = {
        ...openCommitment,
        status: intent,
        resolvedAt: event.occurredAt,
        resolutionConversationId: event.payload.conversationId,
      };
    }
  }

  for (const turn of event.payload.turns) {
    if (classifySocialCommitmentIntent(turn.intent) !== 'created') {
      continue;
    }
    const beneficiaryAgentId = participantIds.find(
      (participantAgentId) => participantAgentId !== turn.speakerAgentId,
    );
    if (beneficiaryAgentId === undefined) {
      continue;
    }
    const commitmentId = `${event.payload.conversationId}:${turn.turnIndex}`;
    commitments[commitmentId] = {
      commitmentId,
      promisorAgentId: turn.speakerAgentId,
      beneficiaryAgentId,
      topic: event.payload.topic,
      statement: turn.utterance,
      status: 'open',
      createdAt: event.occurredAt,
    };
  }
  return commitments;
}

function requirePetition(projection: WorldProjection, petitionId: string): WorldPetitionState {
  const petition = (projection.petitions ?? []).find(
    (candidate) => candidate.petitionId === petitionId,
  );
  if (petition === undefined) {
    throw new Error(`unknown petition ${petitionId}`);
  }
  return petition;
}

function requireSocialMatter(
  projection: WorldProjection,
  matterId: string,
): WorldSocialMatterState {
  const matter = projection.socialMatters?.[matterId];
  if (matter === undefined) {
    throw new Error(`cannot replay social matter event for unknown matter ${matterId}`);
  }
  return matter;
}

function clonePhysiologicalDistressByAgent(
  states: Readonly<Record<string, PhysiologicalDistressState>>,
): Readonly<Record<string, PhysiologicalDistressState>> {
  return Object.fromEntries(
    Object.entries(states).map(([agentId, state]) => [
      agentId,
      clonePhysiologicalDistressState(state),
    ]),
  );
}

function clonePhysiologicalDistressState(
  state: PhysiologicalDistressState,
): PhysiologicalDistressState {
  return { ...state, lowAxes: [...state.lowAxes] };
}

function applyPhysiologicalDistressChange(
  projection: WorldProjection,
  event: Extract<WorldEvent, { readonly type: 'PhysiologicalDistressChanged' }>,
): WorldProjection {
  if (projection.agents[event.payload.agentId] === undefined) {
    throw new Error(`unknown agent ${event.payload.agentId}`);
  }
  const current = projection.physiologicalDistressByAgent ?? {};
  if (event.payload.status === 'active') {
    if (event.payload.state.policyVersion.trim().length === 0) {
      throw new Error('active physiological distress policyVersion must not be empty');
    }
    if (event.payload.state.lowAxes.length === 0) {
      throw new Error('active physiological distress requires at least one low axis');
    }
    if (event.payload.state.distressStartedAt > event.payload.evaluatedAt) {
      throw new Error('physiological distress cannot start after evaluation time');
    }
    if (
      event.payload.state.lastGrantedAt !== null &&
      (event.payload.state.lastGrantedAt < event.payload.state.distressStartedAt ||
        event.payload.state.lastGrantedAt > event.payload.evaluatedAt)
    ) {
      throw new Error('physiological distress last grant must be within the active interval');
    }
    return {
      ...projection,
      physiologicalDistressByAgent: {
        ...current,
        [event.payload.agentId]: clonePhysiologicalDistressState(event.payload.state),
      },
    };
  }

  const activeState = current[event.payload.agentId];
  if (activeState === undefined) {
    throw new Error(`cannot clear missing physiological distress for ${event.payload.agentId}`);
  }
  if (!arePhysiologicalDistressStatesEqual(activeState, event.payload.previousState)) {
    throw new Error(`physiological distress clear state does not match ${event.payload.agentId}`);
  }
  if (event.payload.evaluatedAt < activeState.distressStartedAt) {
    throw new Error('physiological distress cannot clear before it starts');
  }
  const next = { ...current };
  delete next[event.payload.agentId];
  return { ...projection, physiologicalDistressByAgent: next };
}

function arePhysiologicalDistressStatesEqual(
  left: PhysiologicalDistressState,
  right: PhysiologicalDistressState,
): boolean {
  return (
    left.policyVersion === right.policyVersion &&
    left.distressStartedAt === right.distressStartedAt &&
    left.lastGrantedAt === right.lastGrantedAt &&
    left.lowAxes.length === right.lowAxes.length &&
    left.lowAxes.every((axis, index) => axis === right.lowAxes[index])
  );
}

function applySafetyNetGrant(
  projection: WorldProjection,
  event: Extract<WorldEvent, { readonly type: 'SafetyNetGranted' }>,
): WorldProjection {
  const distressStates = projection.physiologicalDistressByAgent ?? {};
  const distressState = distressStates[event.payload.agentId];
  if (distressState === undefined) {
    throw new Error(`safety-net grant requires active distress for ${event.payload.agentId}`);
  }
  if (distressState.policyVersion !== event.payload.policyVersion) {
    throw new Error(`safety-net grant policy does not match distress state`);
  }
  if (
    event.payload.grantedAt < distressState.distressStartedAt ||
    event.payload.distressDurationMs !== event.payload.grantedAt - distressState.distressStartedAt
  ) {
    throw new Error('safety-net grant duration does not match distress state');
  }
  if (
    distressState.lowAxes.length !== event.payload.lowAxes.length ||
    !distressState.lowAxes.every((axis, index) => axis === event.payload.lowAxes[index])
  ) {
    throw new Error('safety-net grant axes do not match distress state');
  }
  if (
    distressState.lastGrantedAt !== null &&
    event.payload.grantedAt < distressState.lastGrantedAt
  ) {
    throw new Error('safety-net grant time precedes the previous grant');
  }
  if (Object.keys(event.payload.inventory).length === 0) {
    throw new Error('safety-net grant inventory must not be empty');
  }

  return updateAgent(
    {
      ...projection,
      physiologicalDistressByAgent: {
        ...distressStates,
        [event.payload.agentId]: {
          ...distressState,
          lastGrantedAt: event.payload.grantedAt,
        },
      },
    },
    event.payload.agentId,
    (agent) => ({
      ...agent,
      inventory: applyInventoryChanges(agent.inventory, event.payload.inventory, 1),
    }),
  );
}

function assertMatchingPendingJobApplication(
  projection: WorldProjection,
  payload: Extract<WorldEvent, { readonly type: 'JobApplicationResolved' }>['payload'],
): void {
  const application = projection.jobApplications.find(
    (candidate) => candidate.applicationId === payload.applicationId,
  );
  if (application === undefined) {
    throw new Error(`unknown job application ${payload.applicationId}`);
  }
  if (
    application.agentId !== payload.agentId ||
    application.occupationName !== payload.occupationName ||
    application.cycleNumber !== payload.cycleNumber
  ) {
    throw new Error(`job application resolution does not match ${payload.applicationId}`);
  }
  if (application.status !== 'pending') {
    throw new Error(`job application ${payload.applicationId} is already ${application.status}`);
  }
}

function assertMatchingPendingEducationExamApplication(
  projection: WorldProjection,
  payload: Extract<WorldEvent, { readonly type: 'EducationExamResolved' }>['payload'],
): void {
  const application = projection.educationExamApplications.find(
    (candidate) => candidate.applicationId === payload.applicationId,
  );
  if (application === undefined) {
    throw new Error(`unknown education exam application ${payload.applicationId}`);
  }
  if (
    application.agentId !== payload.agentId ||
    application.targetLevel !== payload.targetLevel ||
    application.cycleNumber !== payload.cycleNumber
  ) {
    throw new Error(`education exam resolution does not match ${payload.applicationId}`);
  }
  if (application.status !== 'pending') {
    throw new Error(
      `education exam application ${payload.applicationId} is already ${application.status}`,
    );
  }
}

function markAssignedJobApplication(
  projection: WorldProjection,
  event: Extract<WorldEvent, { readonly type: 'JobAssigned' }>,
): readonly WorldJobApplicationState[] {
  const explicitApplicationId = event.payload.applicationId;
  let applicationId = explicitApplicationId;
  if (applicationId === undefined) {
    for (let index = projection.jobApplications.length - 1; index >= 0; index -= 1) {
      const candidate = projection.jobApplications[index];
      if (
        candidate?.status === 'pending' &&
        candidate.agentId === event.payload.agentId &&
        candidate.occupationName === event.payload.occupationName
      ) {
        applicationId = candidate.applicationId;
        break;
      }
    }
  }
  if (applicationId === undefined) {
    return projection.jobApplications;
  }

  const application = projection.jobApplications.find(
    (candidate) => candidate.applicationId === applicationId,
  );
  if (application === undefined) {
    throw new Error(`unknown assigned job application ${applicationId}`);
  }
  if (application.status === 'rejected') {
    throw new Error(`cannot assign rejected job application ${applicationId}`);
  }
  if (application.status === 'accepted') {
    return projection.jobApplications;
  }
  return projection.jobApplications.map((candidate) =>
    candidate.applicationId === applicationId
      ? {
          ...candidate,
          status: 'accepted',
          resolvedAt: event.occurredAt,
          resolutionReason: 'legacy-immediate-assignment',
        }
      : candidate,
  );
}

function cloneMarketPriceIndex(index: WorldMarketPriceIndexState): WorldMarketPriceIndexState {
  return {
    ...index,
    ratios: { ...index.ratios },
  };
}

function cloneEconomicComposition(
  composition: WorldEconomicCompositionState,
): WorldEconomicCompositionState {
  return {
    ...composition,
    composition: { ...composition.composition },
    enterprises: { ...composition.enterprises },
    ...(composition.educationDistribution === undefined
      ? {}
      : { educationDistribution: { ...composition.educationDistribution } }),
    ...(composition.survival === undefined
      ? {}
      : {
          survival: {
            ...composition.survival,
            deathsByCause: { ...composition.survival.deathsByCause },
            resources: composition.survival.resources.map((resource) => ({ ...resource })),
          },
        }),
  };
}

function incrementMetric(
  current: Readonly<Record<string, number>> | undefined,
  key: string,
  delta: number,
): Readonly<Record<string, number>> {
  return { ...current, [key]: (current?.[key] ?? 0) + delta };
}

function resolveScarcityRejectionCommodity(reason: string): string | undefined {
  const match = /^insufficient-renewable-resource: (.+?) requires /u.exec(reason);
  return match?.[1];
}

function updateRenewableResource(
  projection: WorldProjection,
  input: { readonly regionId: string } & WorldRenewableResourceState,
): WorldProjection {
  if (
    !Number.isFinite(input.stock) ||
    input.stock < 0 ||
    !Number.isFinite(input.carryingCapacity) ||
    input.carryingCapacity <= 0 ||
    input.stock > input.carryingCapacity
  ) {
    throw new Error(
      `invalid renewable resource stock for ${input.regionId}/${input.commodityName}`,
    );
  }
  const region = projection.renewableResources?.[input.regionId] ?? {};
  return {
    ...projection,
    renewableResources: {
      ...projection.renewableResources,
      [input.regionId]: {
        ...region,
        [input.commodityName]: {
          commodityName: input.commodityName,
          stock: input.stock,
          carryingCapacity: input.carryingCapacity,
          lastRegenerationAt: input.lastRegenerationAt,
          policyVersion: input.policyVersion,
          updatedAt: input.updatedAt,
        },
      },
    },
  };
}

function updateAgent(
  projection: WorldProjection,
  agentId: AgentId,
  update: (agent: WorldAgentState) => WorldAgentState,
): WorldProjection {
  const current = projection.agents[agentId];
  if (current === undefined) {
    throw new Error(`unknown agent ${agentId}`);
  }

  return {
    ...projection,
    agents: {
      ...projection.agents,
      [agentId]: update(current),
    },
  };
}

function updateEnterprise(
  projection: WorldProjection,
  enterpriseId: string,
  update: (enterprise: WorldEnterpriseState) => WorldEnterpriseState,
): WorldProjection {
  const current = projection.enterprises[enterpriseId];
  if (current === undefined) {
    throw new Error(`unknown enterprise ${enterpriseId}`);
  }
  return {
    ...projection,
    enterprises: {
      ...projection.enterprises,
      [enterpriseId]: update(current),
    },
  };
}

function assertExternalTradeBalanceTransition(input: {
  readonly event: Extract<WorldEvent, { readonly type: 'ExternalTradeExecuted' }>;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}): void {
  const payload = input.event.payload;
  if (Math.abs(payload.balanceBefore - input.balanceBefore) > 1e-9) {
    throw new Error(
      `external trade balanceBefore ${payload.balanceBefore} does not match projection balance ${input.balanceBefore} for ${payload.commodityName}`,
    );
  }
  if (Math.abs(payload.balanceAfter - input.balanceAfter) > 1e-9) {
    throw new Error(
      `external trade balanceAfter ${payload.balanceAfter} does not match ${payload.direction} of ${payload.quantity} from ${input.balanceBefore} for ${payload.commodityName}`,
    );
  }
}

function applyMoneyTransferToSupply(
  projection: WorldProjection,
  input: {
    readonly transactionId: string;
    readonly reason: string;
    readonly fromSector: EconomicAccountSector;
    readonly fromId: string;
    readonly toSector: EconomicAccountSector;
    readonly toId: string;
    readonly amount: number;
  },
): WorldProjection {
  // A zero-valued factual settlement (for example an upkeep cadence fully
  // covered by arrears) has no accounting entries. Economy correctly rejects
  // zero-entry transfers, so preserve it as an explicit projection no-op.
  if (input.amount === 0) {
    return projection;
  }
  const transaction = createMoneyTransfer({
    transactionId: input.transactionId,
    reason: input.reason,
    from: economicAccount(input.fromSector, input.fromId),
    to: economicAccount(input.toSector, input.toId),
    amount: input.amount,
  });
  return {
    ...projection,
    moneySupply: projection.moneySupply + calculateCirculatingMoneyDelta(transaction),
  };
}

/**
 * Age anchor for lifecycle derivations: the registration record when present
 * (partition-local agents), else the transfer-carried anchor, else simulation
 * time zero (scenario-seeded legacy agents).
 */
export function resolveAgentAgeAnchorMs(agent: WorldAgentState): number {
  return agent.registration?.registeredAt ?? agent.registeredAtMs ?? 0;
}

/**
 * Shared reducer effect of a permanent departure (death or out-migration):
 * remove the agent, cancel their pending applications, and move the estate's
 * circulating currency out of the town economy (AGENTS.md §7 category 3;
 * inventory perishes/travels with the holder, no currency effect).
 */
function applyAgentDeparture(
  projection: WorldProjection,
  agentId: AgentId,
  estate: { readonly burnedCurrency: number },
  eventId: string,
): WorldProjection {
  const agent = projection.agents[agentId];
  if (agent === undefined) {
    throw new Error(`cannot replay departure of unknown agent ${agentId}`);
  }
  const agents = { ...projection.agents };
  delete agents[agentId];
  const transitByAgent = { ...(projection.transitByAgent ?? {}) };
  delete transitByAgent[agentId];
  const timeSettlementByAgent = { ...(projection.timeSettlementByAgent ?? {}) };
  delete timeSettlementByAgent[agentId];
  const activityTimeByAgent = { ...projection.activityTimeByAgent };
  delete activityTimeByAgent[agentId];
  const physiologicalDistressByAgent = { ...projection.physiologicalDistressByAgent };
  delete physiologicalDistressByAgent[agentId];
  const departed: WorldProjection = {
    ...projection,
    agents,
    transitByAgent,
    timeSettlementByAgent,
    activityTimeByAgent,
    physiologicalDistressByAgent,
    jobApplications: withoutPendingApplicationsOf(projection.jobApplications, agentId),
    educationExamApplications: withoutPendingApplicationsOf(
      projection.educationExamApplications,
      agentId,
    ),
  };
  return estate.burnedCurrency > 0
    ? applyMoneyTransferToSupply(departed, {
        transactionId: eventId,
        reason: 'departure-estate-burned',
        fromSector: 'agent',
        fromId: agentId,
        toSector: 'external',
        toId: 'departure-estate',
        amount: estate.burnedCurrency,
      })
    : departed;
}

/** Drops an agent's pending applications (job or exam); used by death and
 * cross-partition departure so later cycles never resolve for a missing agent. */
function withoutPendingApplicationsOf<
  TApplication extends { readonly agentId: AgentId; readonly status: string },
>(applications: readonly TApplication[], agentId: AgentId): readonly TApplication[] {
  return applications.filter(
    (application) => application.agentId !== agentId || application.status !== 'pending',
  );
}
