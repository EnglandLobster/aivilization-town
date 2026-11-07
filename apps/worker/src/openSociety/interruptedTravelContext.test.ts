import { expect, test } from 'vitest';
import { asAgentId, asLocationId } from '@aivilization/sim-core';
import { interruptedTravelContext } from './interruptedTravelContext';
import { observeResidentWorld, buildOpenResidentContext } from './context';
import { createOpenSocietyManifest } from './manifest';
import { initialOpenSocietyState } from './state';
const policies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 1, satietyCostPerHour: 1 },
  criticalThresholds: { energy: 0, health: 0 },
};
function fixture() {
  const manifest = createOpenSocietyManifest({ count: 2, continuity: true });
  const state = initialOpenSocietyState(manifest);
  const [a, b] = manifest.residents.map((r) => r.id) as [string, string];
  const record = {
    vehicleId: 'car',
    source: {
      version: 'resident-departure-activity-v1' as const,
      executor: 'system' as const,
      actorId: 'driver',
      populationEventId: 'departure-driver',
      populationType: 'AgentDied' as const,
      populationPolicyVersion: 'DO-NOT-INJECT-CAUSE',
      at: 50,
    },
    transit: {
      agentId: asAgentId(a),
      fromLocationId: asLocationId('origin'),
      toLocationId: asLocationId('destination'),
      routeLocationIds: [asLocationId('origin'), asLocationId('destination')],
      spatialPolicyVersion: 'town-spatial-graph-v2',
      baseTravelDurationSeconds: 0.1,
      congestionMultiplier: 1,
      travelDurationSeconds: 0.1,
      departedAt: 0,
      arrivesAt: 100,
      reason: 'OWN-ORIGINAL-ONLY-ON-DEMAND',
    },
  };
  return {
    manifest,
    a,
    b,
    state: {
      ...state,
      world: {
        ...state.world,
        agents: { ...state.world.agents, [a]: { ...state.world.agents[a]!, locationId: null } },
        interruptedTravelByAgent: { [a]: record },
      },
    },
  };
}
test('own interruption preview is bounded and route expansion is independent of another resident', () => {
  const { state, a, b } = fixture();
  const before = structuredClone(state);
  expect(interruptedTravelContext(state.world, b, true)).toEqual({});
  expect(interruptedTravelContext({ ...state.world, interruptedTravelByAgent: {} }, a)).toEqual({});
  const preview = interruptedTravelContext(state.world, a);
  expect(preview).toEqual({
    interruptedTravel: {
      status: 'interrupted',
      vehicleId: 'car',
      stoppedAt: 50,
      requires: 'authorized-travel-resumption',
      readWith: 'town city observe --view action',
    },
  });
  const detail = interruptedTravelContext(state.world, a, true);
  expect(detail).toMatchObject({
    interruptedTravel: {
      elapsedMs: 50,
      originalTravel: state.world.interruptedTravelByAgent[a]!.transit,
      source: { version: 'resident-departure-activity-v1', populationEventId: 'departure-driver' },
    },
  });
  expect(detail.interruptedTravel?.originalTravel).not.toBe(
    state.world.interruptedTravelByAgent[a]!.transit,
  );
  expect(JSON.stringify(detail)).not.toContain('DO-NOT-INJECT-CAUSE');
  expect(state).toEqual(before);
});
test('existing action query expands own interrupted route without adding original text to routine context', () => {
  const { state, manifest, a, b } = fixture();
  const before = structuredClone(state);
  const context = buildOpenResidentContext(state, manifest, a, policies);
  expect(context.action).toMatchObject(interruptedTravelContext(state.world, a));
  expect(JSON.stringify(context)).not.toContain('OWN-ORIGINAL-ONLY-ON-DEMAND');
  expect(JSON.stringify(context)).not.toContain('DO-NOT-INJECT-CAUSE');
  const query = observeResidentWorld(state, manifest, a, policies, { view: 'action' });
  expect(query).toMatchObject(interruptedTravelContext(state.world, a, true));
  expect(JSON.stringify(query)).toContain('OWN-ORIGINAL-ONLY-ON-DEMAND');
  expect(observeResidentWorld(state, manifest, b, policies, { view: 'action' })).not.toHaveProperty(
    'interruptedTravel',
  );
  expect(state).toEqual(before);
});
