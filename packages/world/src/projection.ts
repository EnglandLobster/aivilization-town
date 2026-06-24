import { addInventory, removeInventory, type AmmPool, type Inventory } from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type { AgentId, LocationId, SimulationClock } from '@aivilization/sim-core';
import {
  createDirectedSocialRelationKey,
  type PhysiologicalState,
  type SocialRelationState,
} from '@aivilization/society';
import type { WorldEvent } from './events';

export type WorldAgentState = {
  readonly agentId: AgentId;
  readonly locationId: LocationId | null;
  readonly physiology: PhysiologicalState;
  readonly educationScore: number;
  readonly balance: number;
  readonly residentialTier: number;
  readonly job: string | null;
  readonly inventory: Inventory;
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
};

export type WorldLocationStateInput = WorldLocationState;

export type WorldJobApplicationState = {
  readonly agentId: AgentId;
  readonly occupationName: string;
  readonly submittedAt: number;
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

export type WorldProjection = {
  readonly clock: SimulationClock;
  readonly agents: Readonly<Record<string, WorldAgentState>>;
  readonly locations: Readonly<Record<string, WorldLocationState>>;
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  readonly moneySupply: number;
  readonly jobApplications: readonly WorldJobApplicationState[];
  readonly locationObservations: readonly WorldLocationObservationState[];
  readonly socialRelations: Readonly<Record<string, SocialRelationState>>;
  readonly memoryRecords: readonly ShortTermMemoryRecord[];
  readonly rejectedActions: readonly {
    readonly agentId: AgentId;
    readonly commandType: string;
    readonly reason: string;
  }[];
};

export function createWorldProjection(input: {
  readonly agents: readonly WorldAgentStateInput[];
  readonly clock?: SimulationClock;
  readonly locations?: readonly WorldLocationStateInput[];
  readonly marketPools?: readonly AmmPool[];
  readonly moneySupply?: number;
  readonly jobApplications?: readonly WorldJobApplicationState[];
  readonly locationObservations?: readonly WorldLocationObservationState[];
  readonly socialRelations?: readonly SocialRelationState[];
}): WorldProjection {
  const locations: Record<string, WorldLocationState> = {};
  for (const location of input.locations ?? []) {
    if (locations[location.locationId] !== undefined) {
      throw new Error(`duplicate location id ${location.locationId}`);
    }
    locations[location.locationId] = {
      ...location,
      activityAffinities: [...location.activityAffinities],
    };
  }

  const agents: Record<string, WorldAgentState> = {};
  for (const agent of input.agents) {
    if (agents[agent.agentId] !== undefined) {
      throw new Error(`duplicate agent id ${agent.agentId}`);
    }
    const locationId = agent.locationId ?? null;
    if (locationId !== null && locations[locationId] === undefined) {
      throw new Error(`agent ${agent.agentId} location ${locationId} is not in projection locations`);
    }
    agents[agent.agentId] = {
      ...agent,
      locationId,
      inventory: { ...agent.inventory },
    };
  }

  const marketPools: Record<string, AmmPool> = {};
  for (const pool of input.marketPools ?? []) {
    if (marketPools[pool.commodity] !== undefined) {
      throw new Error(`duplicate AMM pool ${pool.commodity}`);
    }
    marketPools[pool.commodity] = { ...pool };
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
    jobApplications: [...(input.jobApplications ?? [])],
    locationObservations: (input.locationObservations ?? []).map((observation) => ({
      ...observation,
      observedAgentIds: [...observation.observedAgentIds],
      activityAffinities: [...observation.activityAffinities],
    })),
    socialRelations,
    memoryRecords: [],
    rejectedActions: [],
  };
}

export function applyWorldEvent(projection: WorldProjection, event: WorldEvent): WorldProjection {
  switch (event.type) {
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
            [event.payload.commodityName]: event.payload.poolAfter,
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
    case 'JobApplicationSubmitted':
      return {
        ...projection,
        jobApplications: [
          ...projection.jobApplications,
          {
            agentId: event.payload.agentId,
            occupationName: event.payload.occupationName,
            submittedAt: event.occurredAt,
          },
        ],
      };
    case 'JobAssigned':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        job: event.payload.occupationName,
      }));
    case 'ResidentialTierUpgraded':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        balance: agent.balance - event.payload.currencyCost,
        residentialTier: event.payload.nextResidentialTier,
        inventory: applyInventoryChanges(agent.inventory, event.payload.consumedInventory, -1),
      }));
    case 'SocialInteractionCompleted':
      return {
        ...projection,
        socialRelations: {
          ...projection.socialRelations,
          [createDirectedSocialRelationKey(event.payload.nextRelation)]: event.payload.nextRelation,
        },
      };
    case 'AgentLocationChanged':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        locationId: event.payload.nextLocationId,
      }));
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
    case 'EducationChanged':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        educationScore: event.payload.nextEducationScore,
      }));
    case 'WagePaid':
      return updateAgent(projection, event.payload.agentId, (agent) => ({
        ...agent,
        balance: agent.balance + event.payload.amount,
      }));
    case 'ShortTermMemoryRecorded':
      return {
        ...projection,
        memoryRecords: [...projection.memoryRecords, event.payload.record],
      };
    case 'SimulationTimeAdvanced':
      return {
        ...projection,
        clock: { ...event.payload.next },
      };
    case 'ActionRejected':
      return {
        ...projection,
        rejectedActions: [...projection.rejectedActions, event.payload],
      };
  }
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
