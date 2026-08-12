import { addInventory, removeInventory, type AmmPool, type Inventory } from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type { AgentId, ConversationId, LocationId, SimulationClock } from '@aivilization/sim-core';
import type { HumanCommandAttribution } from '@aivilization/sim-core';
import {
  classifySocialCommitmentIntent,
  createDirectedSocialRelationKey,
  decaySocialRelation,
  type PhysiologicalState,
  type PhysiologicalDistressState,
  type RecruitmentApplicationResolutionStatus,
  type SocialRelationState,
} from '@aivilization/society';
import type { WorldEvent } from './events';
import type { AgentActivityKind, AgentActivityTimeCommittedPayload } from './events';
import { resolveMarketPoolKey } from './regionalMarkets';
import type { WorldWeatherState } from './weather';
import { cloneTownBulletin, type WorldBulletinState } from './bulletin';
import { cloneSocialMatter, type WorldSocialMatterState } from './matters';
import type { WorldConflictRecord } from './conflict';

export type WorldAgentState = {
  readonly agentId: AgentId;
  readonly locationId: LocationId | null;
  readonly physiology: PhysiologicalState;
  readonly educationScore: number;
  readonly balance: number;
  readonly residentialTier: number;
  readonly job: string | null;
  readonly inventory: Inventory;
  readonly registration?: {
    readonly registrationId: string;
    readonly policyVersion: string;
    readonly creatorId: string;
    readonly source: string;
    readonly displayName: string;
    readonly registeredAt: number;
    readonly provenance: 'post-bootstrap-command';
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
  readonly travelDurationSeconds: number;
  readonly departedAt: number;
  readonly arrivesAt: number;
  readonly reason: string;
};

export type WorldProjection = {
  readonly clock: SimulationClock;
  readonly agents: Readonly<Record<string, WorldAgentState>>;
  readonly locations: Readonly<Record<string, WorldLocationState>>;
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  readonly moneySupply: number;
  readonly marketPriceIndices: readonly WorldMarketPriceIndexState[];
  readonly jobApplications: readonly WorldJobApplicationState[];
  readonly recruitmentCycles: readonly WorldRecruitmentCycleState[];
  readonly physiologicalDistressByAgent: Readonly<Record<string, PhysiologicalDistressState>>;
  readonly locationObservations: readonly WorldLocationObservationState[];
  readonly conversationRecords: readonly WorldConversationRecordState[];
  readonly socialCommitments: Readonly<Record<string, WorldSocialCommitmentState>>;
  readonly activityTimeByAgent: Readonly<Record<string, WorldAgentActivityTimeState>>;
  readonly transitByAgent?: Readonly<Record<string, WorldAgentTransitState>>;
  /**
   * Optional simulation-wide weather slice, present only when the town-weather
   * policy has produced at least one WeatherChanged event (or the projection
   * was created with an explicit initial weather). Omitted keeps legacy
   * snapshots byte-for-byte compatible.
   */
  readonly weather?: WorldWeatherState;
  /**
   * Optional town-bulletin board state (opt-in town-bulletin switch). Absent
   * on legacy projections; present (possibly empty) once the board is used.
   */
  readonly bulletins?: readonly WorldBulletinState[];
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

export function createWorldProjection(input: {
  readonly agents: readonly WorldAgentStateInput[];
  readonly clock?: SimulationClock;
  readonly locations?: readonly WorldLocationStateInput[];
  readonly marketPools?: readonly AmmPool[];
  readonly moneySupply?: number;
  readonly marketPriceIndices?: readonly WorldMarketPriceIndexState[];
  readonly jobApplications?: readonly WorldJobApplicationState[];
  readonly recruitmentCycles?: readonly WorldRecruitmentCycleState[];
  readonly physiologicalDistressByAgent?: Readonly<Record<string, PhysiologicalDistressState>>;
  readonly locationObservations?: readonly WorldLocationObservationState[];
  readonly conversationRecords?: readonly WorldConversationRecordState[];
  readonly socialCommitments?: readonly WorldSocialCommitmentState[];
  readonly socialRelations?: readonly SocialRelationState[];
  readonly weather?: WorldWeatherState;
  readonly bulletins?: readonly WorldBulletinState[];
  readonly socialMatters?: readonly WorldSocialMatterState[];
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
    agents[agent.agentId] = {
      ...agent,
      locationId,
      inventory: { ...agent.inventory },
    };
  }

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

  return {
    clock: input.clock === undefined ? { now: 0, tickDurationMs: 1000 } : { ...input.clock },
    agents,
    locations,
    marketPools,
    moneySupply: input.moneySupply ?? 0,
    marketPriceIndices: (input.marketPriceIndices ?? []).map(cloneMarketPriceIndex),
    jobApplications: input.jobApplications?.map((application) => ({ ...application })) ?? [],
    recruitmentCycles: input.recruitmentCycles?.map((cycle) => ({ ...cycle })) ?? [],
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
    ...(input.bulletins === undefined
      ? {}
      : {
          bulletins: input.bulletins.map((bulletin) => ({ ...bulletin })),
        }),
    ...(input.socialMatters === undefined
      ? {}
      : {
          socialMatters: Object.fromEntries(
            input.socialMatters.map((matter) => [matter.matterId, cloneSocialMatter(matter)]),
          ),
        }),
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

export function applyWorldEvent(projection: WorldProjection, event: WorldEvent): WorldProjection {
  switch (event.type) {
    case 'AgentRegistered': {
      if (projection.agents[event.payload.agentId] !== undefined) {
        throw new Error(`cannot replay duplicate agent registration ${event.payload.agentId}`);
      }
      const initialState = event.payload.initialState;
      return {
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
        moneySupply: projection.moneySupply + event.payload.moneySupplyDelta,
      };
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
    case 'CommodityProduced':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        inventory: applyInventoryChanges(
          applyInventoryChanges(agent.inventory, event.payload.consumedInputs, -1),
          event.payload.produced,
          1,
        ),
        physiology: {
          ...agent.physiology,
          energy: Math.max(0, agent.physiology.energy - event.payload.energyCost),
          satiety: Math.max(0, agent.physiology.satiety - event.payload.satietyCost),
        },
      }));
    case 'TradeExecuted':
      return updateAgent(
        {
          ...projection,
          marketPools: {
            ...projection.marketPools,
            [resolveMarketPoolKey({
              regionId: event.payload.regionId,
              commodity: event.payload.commodityName,
            })]: event.payload.poolAfter,
          },
          moneySupply: projection.moneySupply + event.payload.moneySupplyDelta,
        },
        event.payload.agentId,
        (agent) => ({
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
        }),
      );
    case 'ResourceTransferred':
      return updateAgent(
        updateAgent(projection, event.payload.sourceAgentId, (agent) => ({
          ...agent,
          inventory: removeInventory(
            agent.inventory,
            event.payload.commodityName,
            event.payload.quantity,
          ),
        })),
        event.payload.targetAgentId,
        (agent) => ({
          ...agent,
          inventory: addInventory(
            agent.inventory,
            event.payload.commodityName,
            event.payload.quantity,
          ),
        }),
      );
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
    case 'ResidentialTierUpgraded':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        balance: agent.balance - event.payload.currencyCost,
        residentialTier: event.payload.nextResidentialTier,
        inventory: applyInventoryChanges(agent.inventory, event.payload.consumedInventory, -1),
      }));
    case 'ResidentialUpkeepCharged':
      return updateAgent(
        {
          ...projection,
          moneySupply: projection.moneySupply - event.payload.amount,
        },
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: event.payload.nextBalance,
        }),
      );
    case 'MedicalTreatmentCharged':
      return updateAgent(
        {
          ...projection,
          moneySupply: projection.moneySupply - event.payload.amount,
        },
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
    case 'EducationInvestmentPaid':
      return updateAgent(
        {
          ...projection,
          moneySupply: projection.moneySupply - event.payload.currencyCost,
        },
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
    case 'AgentActivityTimeCommitted':
      return applyAgentActivityTimeCommitment(projection, event);
    case 'WagePaid':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        balance: agent.balance + event.payload.amount,
      }));
    case 'SubsidyPaid':
      return updateAgent(
        {
          ...projection,
          moneySupply: projection.moneySupply + event.payload.amount,
        },
        event.payload.agentId,
        (agent) => ({
          ...agent,
          balance: event.payload.nextBalance,
        }),
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
      return {
        ...projection,
        clock: { ...event.payload.next },
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
      };
    case 'WeatherChanged':
      return {
        ...projection,
        weather: {
          current: event.payload.to,
          since: event.payload.transitionedAt,
        },
      };
    case 'BulletinScheduled': {
      const bulletins = projection.bulletins ?? [];
      if (bulletins.some((bulletin) => bulletin.bulletinId === event.payload.bulletin.bulletinId)) {
        throw new Error(
          `cannot replay duplicate bulletin ${event.payload.bulletin.bulletinId}`,
        );
      }
      return {
        ...projection,
        bulletins: [
          ...bulletins,
          { ...cloneTownBulletin(event.payload.bulletin), status: 'scheduled' },
        ],
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
      return {
        ...projection,
        agents,
        transitByAgent,
      };
    }
    case 'AgentOwnershipArrived': {
      if (projection.agents[event.payload.agentId] !== undefined) {
        throw new Error(
          `cannot replay duplicate ownership arrival for agent ${event.payload.agentId}`,
        );
      }
      const state = event.payload.agentState;
      return {
        ...projection,
        agents: {
          ...projection.agents,
          [event.payload.agentId]: {
            agentId: event.payload.agentId,
            locationId: state.locationId,
            physiology: { ...state.physiology },
            educationScore: state.educationScore,
            balance: state.balance,
            residentialTier: state.residentialTier,
            job: state.job,
            inventory: { ...state.inventory },
          },
        },
      };
    }
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
