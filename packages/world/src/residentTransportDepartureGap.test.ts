import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import { freightEscrowBalance } from '@aivilization/logistics';
import { applyWorldEvent } from './projection';
import { advanceResidentMobility, residentMobilityCommand } from './residentMobility';
import { residentLogisticsEvent } from './residentLogistics';
import { prepareResidentEmploymentDeparture } from './residentEmploymentDeparture';
import { freightWorldFixture } from './testFixtures/residentFreight';
import {
  capturedResidentDeparture,
  residentDeathFixture,
  residentExitFixture,
} from './testFixtures/residentExit';

for (const inTransit of [false, true])
  test(`diagnostic: carrier departure leaves loaded vehicle custody without a usable custodian (transit ${inTransit})`, () => {
    const t = freightWorldFixture({ vehicle: true });
    t.ready();
    t.ok(t.freight('carrier', 'load'));
    if (inTransit)
      t.ok(
        t.mobility('carrier', {
          type: 'vehicles.drive',
          id: 'car',
          destinationId: 'east',
          expectedRevision: 1,
        }),
      );
    const w = {
      ...t.w,
      residentExits: residentExitFixture().residentExits,
      clock: {
        ...t.w.clock,
        now: inTransit ? t.w.residentMobility.vehicles.car!.journey!.arrivesAt / 2 : 0,
      },
    };
    const before = structuredClone(w),
      raw = residentDeathFixture();
    const death = {
      ...raw,
      occurredAt: w.clock.now,
      payload: { ...raw.payload, agentId: asAgentId('carrier'), diedAt: w.clock.now },
    };
    const candidate = prepareResidentEmploymentDeparture({ projection: w, departure: death });
    // The current candidate now records interrupted travel; capture-first remains unsupported below.
    expect(candidate.accepted).toBe(true);
    const departed = applyWorldEvent(w, capturedResidentDeparture(w, death));
    expect(departed.agents.carrier).toBeUndefined();
    expect(departed.transitByAgent?.carrier).toBeUndefined();
    expect(departed.residentMobility!.vehicles.car).toEqual(w.residentMobility.vehicles.car);
    expect(departed.materials!.custodies!.records.parcel).toEqual(
      w.materials!.custodies!.records.parcel,
    );
    expect(departed.logistics!.freight.parcel).toMatchObject({
      carrierId: 'carrier',
      status: 'loaded',
      escrow: 8,
    });
    const atArrival = {
      ...departed,
      clock: {
        ...departed.clock,
        now: w.residentMobility.vehicles.car!.journey?.arrivesAt ?? 60000,
      },
    };
    expect(advanceResidentMobility({ ...t.context('system'), projection: atArrival })).toEqual([]);
    const replacement = residentMobilityCommand({
      ...t.context('friend'),
      projection: atArrival,
      command: {
        type: 'vehicles.drive',
        id: 'car',
        destinationId: 'east',
        expectedRevision: atArrival.residentMobility!.vehicles.car!.revision,
      },
    });
    expect(replacement.accepted).toBe(false);
    expect(
      residentLogisticsEvent({
        ...t.context('carrier'),
        projection: atArrival,
        command: {
          type: 'return',
          id: 'parcel',
          expectedRevision: atArrival.logistics!.freight.parcel!.revision,
        },
      }),
    ).toMatchObject({ accepted: false, reason: 'invalid-freight-actor-time-or-id' });
    expect(
      residentLogisticsEvent({
        ...t.context('friend'),
        projection: atArrival,
        command: {
          type: 'return',
          id: 'parcel',
          expectedRevision: atArrival.logistics!.freight.parcel!.revision,
        },
      }),
    ).toMatchObject({ accepted: false, reason: 'freight-personal-carrier-required' });
    const estate = Object.values(departed.residentExits!.cash.accounts)[0]!;
    expect(
      Object.values(departed.agents).reduce((n, a) => n + a.balance, estate.balance) +
        freightEscrowBalance(departed.logistics),
    ).toBe(departed.moneySupply);
    expect(w).toEqual(before);
  });
