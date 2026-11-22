import { commonAccountsBalance } from '@aivilization/economy';
import { expect } from 'vitest';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { createMaterialsPolicy, type MaterialCommand } from '@aivilization/materials';
import {
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  PREMISES_FACILITY_USE_POLICY,
} from '@aivilization/premises';
import { createWorldProjection, applyWorldEvent } from '../projection';
import {
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  type MaterialAuthorization,
} from '../residentMaterials';
import { enableResidentPremisesEvent } from '../residentPremises';
import { handleAdvanceSimulationTimeCommand } from '../agentActions';
import type { WorldEvent } from '../events';

/** Two connected places, five residents and two stocks; money is checked after every commit. */
export function materialsWorldFixture() {
  const initial = createWorldProjection({
    agents: ['source', 'recipient', 'payer', 'carrier', 'friend'].map((id) => ({
      agentId: asAgentId(id),
      balance: 100,
      inventory: id === 'source' ? { Wood: 10 } : id === 'carrier' ? { Wood: 1 } : {},
      physiology: { health: 100, energy: 100, satiety: 100 },
      educationScore: 0,
      residentialTier: 1,
      job: null,
      locationId: asLocationId(id === 'recipient' ? 'east' : 'west'),
    })),
    moneySupply: 500,
    locations: ['west', 'east'].map((id) => ({
      locationId: asLocationId(id),
      name: id,
      kind: 'social',
      capacity: 10,
      activityAffinities: [],
      connections: [
        {
          targetLocationId: asLocationId(id === 'west' ? 'east' : 'west'),
          travelDurationSeconds: 60,
        },
      ],
    })),
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const auth = { authorize: () => undefined, controllerAvailable: () => true };
  const context = (actorId = 'source') => ({
    projection: w,
    actorId,
    requestId: `f${++n}`,
    simulationId: 'sim',
    nextSequence: events.length + 1,
    authorization: auth,
  });
  const materialAuth: MaterialAuthorization = {
    authorize: () => undefined,
    controlAvailable: () => true,
    hasExternalObligation: () => false,
    mayStoreAt: () => true,
  };
  const commit = (batch: readonly WorldEvent[]) => {
    let next = w;
    for (const e of batch) next = applyWorldEvent(next, e);
    w = next;
    events.push(...batch);
    expect(w.moneySupply).toBe(initial.moneySupply);
    expect(
      Object.values(w.agents).reduce((sum, a) => sum + a.balance, 0) +
        commonAccountsBalance(w.commonAccounts) +
        (w.treasury ?? 0),
    ).toBeCloseTo(initial.moneySupply, 8);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    commit(d.events);
    return d.events;
  };
  commit([
    enableResidentMaterialsEvent({
      ...context(),
      at: 0,
      policy: createMaterialsPolicy([
        {
          id: 'book',
          version: 'v1',
          inputs: { Wood: 1 },
          outputs: { Book: 1 },
          workMs: 1000,
          energyCost: 1,
          satietyCost: 1,
          minResidentialTier: 1,
        },
      ]),
    }),
  ]);
  ok(
    enableResidentPremisesEvent({
      ...context(),
      policy: PREMISES_POLICY,
      landUsePolicy: PUBLIC_LAND_USE_POLICY,
      facilityUsePolicy: PREMISES_FACILITY_USE_POLICY,
      sites: [],
    }),
  );
  const material = (actor: string, command: MaterialCommand) =>
    residentMaterialEvent({ ...context(actor), authorization: materialAuth, command });
  for (const actor of ['source', 'recipient'])
    ok(
      material(actor, {
        type: 'create-stock',
        id: `${actor}-stock`,
        title: actor,
        locationId: actor === 'source' ? 'west' : 'east',
      }),
    );
  ok(
    material('source', {
      type: 'deposit',
      id: 'source-stock',
      expectedRevision: 1,
      items: { Wood: 8 },
    }),
  );
  const time = (deltaMs: number) =>
    commit(
      handleAdvanceSimulationTimeCommand({
        projection: w,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `time${++n}`,
          simulationId: 'sim',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs },
        }),
      }),
    );
  return {
    get w() {
      return w;
    },
    initial,
    events,
    context,
    ok,
    commit,
    time,
    material,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
