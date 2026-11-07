import { expect, test } from 'vitest';
import { createCommandEnvelope, createEventEnvelope, asAgentId } from '@aivilization/sim-core';
import { freightWorldFixture } from './testFixtures/residentFreight';
import { enableResidentExtractionEvent } from './residentExtraction';
import { settleResidentMaterialEvent } from './residentMaterials';
import { dispatchWorldCommand, type WorldCommandPolicies } from './agentActions';
import { applyWorldEvent } from './projection';
const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 1, satietyCostPerHour: 1 },
  criticalThresholds: { energy: 0, health: 0 },
};
const sources = [
  {
    id: 'forest',
    locationId: 'west',
    commodity: 'Wood',
    initialQuantity: 5,
    workMs: 1000,
    energyCost: 4,
    satietyCost: 2,
    capacity: 1,
  },
];
test('explicit activation preserves old inventory, disables instant legacy production, and records actual extraction in one conserved world', () => {
  const t = freightWorldFixture(),
    before = t.w;
  const activation = enableResidentExtractionEvent({ ...t.context(), policies, sources });
  t.commit([activation]);
  expect(t.w.agents).toEqual(before.agents);
  expect(t.w.materials!.stocks).toEqual(before.materials!.stocks);
  const source = () => t.w.materials!.extraction!.sources.forest!;
  t.ok(
    t.material('source', {
      type: 'create-extraction',
      id: 'gather',
      stockId: 'source-stock',
      expectedRevision: t.w.materials!.stocks['source-stock']!.revision,
      sourceId: 'forest',
      sourceRevision: 1,
      quantity: 2,
      workers: ['source'],
      productName: 'Wood',
      description: 'Original choice',
    }),
  );
  const job = () => t.w.materials!.productions.gather!;
  expect(source().remaining).toBe(3);
  expect(t.w.materials!.stocks['source-stock']!.inventory.Wood).toBe(4);
  t.ok(
    t.material('source', {
      type: 'start-production',
      id: 'gather',
      expectedRevision: 1,
      until: 2000,
    }),
  );
  t.time(1000);
  t.ok(
    settleResidentMaterialEvent({
      ...t.context('system'),
      productionId: 'gather',
      authorization: {
        authorize: () => undefined,
        controlAvailable: () => true,
        mayStoreAt: () => true,
        hasExternalObligation: () => false,
      },
    }),
  );
  expect(job().completed).toBe(1);
  expect(t.w.materials!.stocks['source-stock']!.inventory.Wood).toBe(5);
  t.ok(
    t.material('source', {
      type: 'cancel-production',
      id: 'gather',
      expectedRevision: job().revision,
    }),
  );
  expect(source().remaining).toBe(4);
  expect(t.w.agents.source!.physiology.energy).toBe(96);
  const rejected = dispatchWorldCommand({
    projection: t.w,
    policies,
    nextSequence: t.events.length + 1,
    command: createCommandEnvelope({
      id: 'old',
      simulationId: 'sim',
      actorId: 'source',
      source: 'agent-runtime',
      type: 'AgentProduce',
      issuedAt: t.w.clock.now,
      payload: { commodityName: 'Wood', quantity: 1, availableLaborSeconds: 60 },
    }),
  });
  expect(
    rejected.some(
      (e) =>
        e.type === 'ActionRejected' && e.payload.reason.includes('physical-production-required'),
    ),
  ).toBe(true);
  const oldProduced = createEventEnvelope({
    id: 'legacy-fact',
    simulationId: 'sim',
    type: 'CommodityProduced' as const,
    occurredAt: 0,
    sequence: 1,
    payload: {
      agentId: asAgentId('source'),
      produced: { Wood: 1 },
      consumedInputs: {},
      energyCost: 1,
      satietyCost: 0,
      laborSeconds: 1,
    },
  });
  expect(applyWorldEvent(before, oldProduced).agents.source!.inventory.Wood).toBe(3);
  expect(() => applyWorldEvent(t.w, oldProduced)).toThrow('legacy-instant-production-disabled');
  t.replay();
});
test('activation rejects unknown places, a duplicate pool and active prepaid production without changing history', () => {
  const t = freightWorldFixture();
  expect(() =>
    enableResidentExtractionEvent({
      ...t.context(),
      policies,
      sources: sources.map((s) => ({ ...s, locationId: 'missing' })),
    }),
  ).toThrow();
  expect(() =>
    enableResidentExtractionEvent({
      ...t.context(),
      projection: { ...t.w, renewableResources: {} },
      policies,
      sources,
    }),
  ).toThrow('physical-production-cannot-duplicate-legacy-resource-pool');
  const previous = createEventEnvelope({
    id: 'old-busy',
    simulationId: 'sim',
    type: 'AgentActivityTimeCommitted' as const,
    sequence: 1,
    occurredAt: 0,
    payload: {
      agentId: asAgentId('source'),
      activity: 'production' as const,
      commandType: 'AgentProduce' as const,
      durationSeconds: 60,
      startedAt: 0,
      availableAt: 60000,
      settlementTiming: 'effects-at-commit' as const,
      policyVersion: 'exclusive-agent-activity-time-v1' as const,
    },
  });
  const busy = applyWorldEvent(t.w, previous);
  expect(() =>
    enableResidentExtractionEvent({ ...t.context(), projection: busy, policies, sources }),
  ).toThrow('invalid-physical-production-activation-or-active-legacy-production');
  expect(t.w.materials!.extraction).toBeUndefined();
  t.replay();
});
