import { expect } from 'vitest';
import { createCommandEnvelope, asAgentId, asLocationId } from '@aivilization/sim-core';
import { PREMISES_POLICY, PUBLIC_LAND_USE_POLICY } from '@aivilization/premises';
import { createMaterialsPolicy } from '@aivilization/materials';
import { createWorldProjection, applyWorldEvent } from '../projection';
import {
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  residentMaterialReservationEvent,
  type MaterialAuthorization,
} from '../residentMaterials';
import {
  enableResidentPremisesEvent,
  residentConstructionEvent,
  settleResidentConstructionEvent,
  type PremisesAuthorization,
} from '../residentPremises';
import { handleAdvanceSimulationTimeCommand, handleAgentMoveToCommand } from '../agentActions';
import type { WorldEvent } from '../events';
export function residentConstructionFixture() {
  const initial = createWorldProjection({
    agents: ['donor', 'builder', 'worker'].map((id) => ({
      agentId: asAgentId(id),
      balance: 100,
      inventory: { Wood: 20 },
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: 0,
      residentialTier: 1,
      job: null,
      locationId: asLocationId('street'),
    })),
    locations: [
      {
        locationId: asLocationId('street'),
        name: '街道',
        kind: 'social',
        capacity: 30,
        activityAffinities: [],
        connections: [],
        regionId: 'north',
      },
    ],
    moneySupply: 300,
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const materialAuth: MaterialAuthorization = {
      authorize: () => undefined,
      controlAvailable: (c) => !!w.agents[c.id],
      mayStoreAt: () => true,
      hasExternalObligation: () => false,
    },
    auth: PremisesAuthorization = {
      authorize: () => undefined,
      controlAvailable: (c) => !!w.agents[c.id],
      additionalObligations: () => false,
    };
  const context = (actorId = 'builder') => ({
    projection: w,
    actorId,
    requestId: `r${++n}`,
    simulationId: 'sim',
    nextSequence: events.length + 1,
    authorization: auth,
  });
  const commit = (es: readonly WorldEvent[]) => {
    let next = w;
    for (const e of es) next = applyWorldEvent(next, e);
    w = next;
    events.push(...es);
    expect(w.moneySupply).toBe(300);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
  };
  const policy = createMaterialsPolicy([
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
  ]);
  commit([
    enableResidentMaterialsEvent({
      simulationId: 'sim',
      requestId: 'enablematerials',
      nextSequence: 1,
      at: 0,
      policy,
    }),
  ]);
  ok(
    enableResidentPremisesEvent({
      ...context(),
      policy: PREMISES_POLICY,
      landUsePolicy: PUBLIC_LAND_USE_POLICY,
      sites: [
        {
          id: 'site',
          parentLocationId: 'street',
          usableFloorArea: 20,
          occupiedFloorArea: 0,
          reservedFloorArea: 0,
          accessTravelMs: 60000,
          revision: 1,
          source: 'scenario-seed',
          sourceId: 'explicit-test-seed',
        },
      ],
    }),
  );
  const material = (
    command: Parameters<typeof residentMaterialEvent>[0]['command'],
    actorId = 'donor',
  ) => residentMaterialEvent({ ...context(actorId), authorization: materialAuth, command });
  ok(material({ type: 'create-stock', id: 's', title: '材料', locationId: 'street' }));
  ok(material({ type: 'deposit', id: 's', expectedRevision: 1, items: { Wood: 8 } }));
  ok(
    residentMaterialReservationEvent({
      ...context('donor'),
      authorization: materialAuth,
      command: {
        type: 'offer',
        offer: {
          id: 'r',
          stockId: 's',
          expectedStockRevision: 2,
          items: { Wood: 8 },
          beneficiary: { kind: 'resident', id: 'builder' },
          consumer: { domain: 'premises', id: 'p' },
          terms: '这一工程',
          expiresAt: 1000000,
        },
      },
    }),
  );
  const command: Parameters<typeof residentConstructionEvent>[0]['command'] = {
    type: 'create',
    construction: {
      id: 'p',
      kind: 'build',
      buildingId: 'home',
      siteId: 'site',
      expectedSiteRevision: 1,
      controller: { kind: 'resident', id: 'builder' },
      title: '自己的房屋',
      description: '居民选择用途和合作人',
      blueprint: {
        primaryUse: 'residence',
        floorArea: 8,
        capacity: 2,
        fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
      },
      workers: ['worker'],
      reservations: [{ id: 'r', revision: 1 }],
    },
  };
  ok(residentConstructionEvent({ ...context(), command }));
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
  const start = () =>
    ok(
      residentConstructionEvent({
        ...context('worker'),
        command: {
          type: 'start',
          id: 'p',
          revision: w.premises!.projects.p!.revision,
          until: w.clock.now + 480000,
        },
      }),
    );
  const tick = () => ok(settleResidentConstructionEvent({ ...context('system'), projectId: 'p' }));
  const move = (actorId: string) =>
    handleAgentMoveToCommand({
      projection: w,
      nextSequence: events.length + 1,
      command: createCommandEnvelope({
        id: `move${++n}`,
        simulationId: 'sim',
        source: 'agent-runtime',
        actorId,
        type: 'AgentMoveTo',
        issuedAt: w.clock.now,
        payload: { targetLocationId: asLocationId('premises-home') },
      }),
    });
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
    start,
    tick,
    material,
    move,
    materialAuth,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
