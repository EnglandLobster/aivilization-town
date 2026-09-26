import type { OpenSocietyState } from './types';
import { resolveAgentResidenceLocationId, type WorldCommandPolicies } from '@aivilization/world';

/** Read-model assembly limits, not rules for a resident's intentions or durable state. */
export const RESIDENT_CONTEXT_DELIVERY = {
  version: 'resident-context-delivery-v1',
  inventoryItems: 12,
  textPreviewChars: 700,
  messagePreviewChars: 400,
  handoffChars: 4000,
} as const;

/** Explicit allowlist: additions to the canonical planner must not silently enter every prompt. */
export function residentPresentSelf(
  state: OpenSocietyState,
  actorId: string,
  policies: WorldCommandPolicies,
) {
  const agent = state.world.agents[actorId]!;
  const inventory = Object.entries(agent.inventory)
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b, 'en'));
  return {
    agentId: agent.agentId,
    locationId: agent.locationId,
    ...(policies.residentialAssignment === undefined
      ? {}
      : {
          residenceLocationId: resolveAgentResidenceLocationId(state.world, agent),
          housed: resolveAgentResidenceLocationId(state.world, agent) !== null,
        }),
    physiology: { ...agent.physiology },
    balance: agent.balance,
    job: agent.job,
    educationScore: agent.educationScore,
    residentialTier: agent.residentialTier,
    upkeepArrears: agent.upkeepArrears ?? 0,
    inventory: Object.fromEntries(inventory.slice(0, RESIDENT_CONTEXT_DELIVERY.inventoryItems)),
    inventoryTotal: inventory.length,
    inventoryTruncated: inventory.length > RESIDENT_CONTEXT_DELIVERY.inventoryItems,
    expandedBy: 'town city observe --view self',
    provenance: 'world-fact',
  };
}
