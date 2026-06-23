import { addInventory, removeInventory, type Inventory } from '@aivilization/economy';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { PhysiologicalState } from '@aivilization/society';
import type { WorldEvent } from './events';

export type WorldAgentState = {
  readonly agentId: AgentId;
  readonly physiology: PhysiologicalState;
  readonly educationScore: number;
  readonly balance: number;
  readonly residentialTier: number;
  readonly job: string | null;
  readonly inventory: Inventory;
};

export type WorldProjection = {
  readonly agents: Readonly<Record<string, WorldAgentState>>;
  readonly memoryRecords: readonly ShortTermMemoryRecord[];
  readonly rejectedActions: readonly {
    readonly agentId: AgentId;
    readonly commandType: string;
    readonly reason: string;
  }[];
};

export function createWorldProjection(input: {
  readonly agents: readonly WorldAgentState[];
}): WorldProjection {
  const agents: Record<string, WorldAgentState> = {};
  for (const agent of input.agents) {
    if (agents[agent.agentId] !== undefined) {
      throw new Error(`duplicate agent id ${agent.agentId}`);
    }
    agents[agent.agentId] = {
      ...agent,
      inventory: { ...agent.inventory },
    };
  }

  return {
    agents,
    memoryRecords: [],
    rejectedActions: [],
  };
}

export function applyWorldEvent(projection: WorldProjection, event: WorldEvent): WorldProjection {
  switch (event.type) {
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
    case 'ActionRejected':
      return {
        ...projection,
        rejectedActions: [...projection.rejectedActions, event.payload],
      };
  }
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
