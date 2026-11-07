import { evidenceTradeEscrowBalance } from '@aivilization/commerce';
import { commonAccountsBalance } from '@aivilization/economy';
import { engagementEscrowBalance } from '@aivilization/services';
import { expect } from 'vitest';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { createMaterialsPolicy, type MaterialCommand } from '@aivilization/materials';
import {
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  PREMISES_FACILITY_USE_POLICY,
} from '@aivilization/premises';
import {
  LOGISTICS_POLICY,
  freightEscrowBalance,
  type FreightTerms,
  type LogisticsCommand,
} from '@aivilization/logistics';
import { emptyMobilityState, type MobilityCommand } from '@aivilization/mobility';
import { createWorldProjection, applyWorldEvent } from '../projection';
import {
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  residentMaterialReservationEvent,
  type MaterialAuthorization,
} from '../residentMaterials';
import { enableResidentPremisesEvent } from '../residentPremises';
import {
  enableResidentLogisticsEvent,
  residentLogisticsEvent,
  advanceResidentLogistics,
} from '../residentLogistics';
import { residentMobilityCommand, advanceResidentMobility } from '../residentMobility';
import { handleAdvanceSimulationTimeCommand, dispatchWorldCommand } from '../agentActions';
import type { WorldEvent } from '../events';

export function freightWorldFixture(
  options: {
    carrierBag?: number;
    vehicle?: boolean;
    capacity?: number;
    enabled?: boolean;
    treasury?: number;
  } = {},
) {
  const initial = {
    ...createWorldProjection({
      agents: ['source', 'recipient', 'payer', 'carrier', 'friend'].map((id) => ({
        agentId: asAgentId(id),
        balance: 100,
        inventory:
          id === 'source'
            ? { Wood: 10 }
            : id === 'carrier'
              ? { Wood: options.carrierBag ?? 1 }
              : {},
        physiology: { health: 100, energy: 100, satiety: 100 },
        educationScore: 0,
        residentialTier: 1,
        job: null,
        locationId: asLocationId(id === 'recipient' ? 'east' : 'west'),
      })),
      moneySupply: 500 + (options.treasury ?? 0),
      ...(options.treasury === undefined ? {} : { treasury: options.treasury }),
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
    }),
    residentMobility: emptyMobilityState([
      {
        id: 'car',
        ownerId: 'carrier',
        authorized: ['friend'],
        locationId: 'west',
        seats: 2,
        revision: 1,
        cargoCapacity: {
          version: 'vehicle-cargo-capacity-v1',
          units: options.capacity ?? 30,
          source: 'scenario-seed',
          sourceId: 'explicit-world-test',
        },
      },
    ]),
  };
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
    for (const e of batch) next = applyWorldEvent(next, e) as typeof initial;
    w = next;
    events.push(...batch);
    expect(w.moneySupply).toBe(initial.moneySupply);
    expect(
      Object.values(w.agents).reduce((n, a) => n + a.balance, 0) +
        freightEscrowBalance(w.logistics) +
        evidenceTradeEscrowBalance(w.residentTrade) +
        engagementEscrowBalance(w.serviceEngagements) +
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
  if (options.enabled !== false)
    ok(enableResidentLogisticsEvent({ ...context(), policy: LOGISTICS_POLICY }));
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
  ok(
    residentMaterialReservationEvent({
      ...context(),
      authorization: materialAuth,
      command: {
        type: 'offer',
        offer: {
          id: 'goods',
          stockId: 'source-stock',
          expectedStockRevision: 2,
          items: { Wood: 4 },
          beneficiary: { kind: 'resident', id: 'source' },
          consumer: { domain: 'logistics', id: 'parcel' },
          terms: '四件木料原物',
          expiresAt: 3600000,
        },
      },
    }),
  );
  const terms: FreightTerms = {
    id: 'parcel',
    controller: { kind: 'resident', id: 'source' },
    recipient: { kind: 'resident', id: 'recipient' },
    sourceStockId: 'source-stock',
    destinationStockId: 'recipient-stock',
    sourceLocationId: 'west',
    destinationLocationId: 'east',
    materialRef: { id: 'goods', revision: 1 },
    items: { Wood: 4 },
    carrierId: 'carrier',
    ...(options.vehicle ? { vehicleId: 'car' } : {}),
    payer: { sector: 'agent', id: 'payer' },
    deliveryFee: 8,
    returnFee: 3,
    deadline: 3600000,
    title: '自己组织的运输',
    terms: '实际送到再付费，中途取消则实际退回',
  };
  const freight = (actorId: string, type: Exclude<LogisticsCommand['type'], 'offer'>) =>
    residentLogisticsEvent({
      ...context(actorId),
      command: { type, id: 'parcel', expectedRevision: w.logistics!.freight.parcel!.revision },
    });
  const ready = () => {
    ok(residentLogisticsEvent({ ...context(), command: { type: 'offer', ...terms } }));
    ok(freight('recipient', 'accept'));
    ok(freight('payer', 'fund'));
  };
  const move = (actor: string, location = 'east') =>
    dispatchWorldCommand({
      projection: w,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 1, satietyCostPerHour: 1 },
        criticalThresholds: { energy: 0, health: 0 },
      },
      nextSequence: events.length + 1,
      command: createCommandEnvelope({
        id: `move${++n}`,
        simulationId: 'sim',
        source: 'agent-runtime',
        actorId: actor,
        type: 'AgentMoveTo',
        issuedAt: w.clock.now,
        payload: { targetLocationId: asLocationId(location) },
      }),
    });
  const mobility = (actorId: string, command: MobilityCommand) =>
    residentMobilityCommand({ ...context(actorId), command });
  const time = (deltaMs: number) => {
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
    commit(advanceResidentMobility(context('system')));
    commit(advanceResidentLogistics(context('system')));
  };
  const arrive = (actor = 'carrier') => time(w.transitByAgent![actor]!.arrivesAt - w.clock.now);
  return {
    get w() {
      return w;
    },
    initial,
    events,
    context,
    ok,
    commit,
    ready,
    freight,
    move,
    mobility,
    time,
    arrive,
    material,
    terms,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
