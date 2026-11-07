// Diagnostic characterization of an incomplete path, not acceptance of correct settlement.
import assert from 'node:assert/strict';
import { expect, test } from 'vitest';
import type { WorldProjection } from './projection';
import { residentLeaseCommand } from './residentLeases';
import {
  createWorldProjection,
  applyWorldEvent,
  residentCommerceEvent,
  enableResidentCommerceEvent,
  advanceResidentLeases,
  prepareResidentExitCapture,
  RESIDENT_EXIT_PRESERVATION_POLICY,
} from './index';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import { applyEstateCashEvent, ESTATE_CASH_POLICY } from '@aivilization/economy';
import { applyEstateMaterialEvent, ESTATE_MATERIAL_CUSTODY_POLICY } from '@aivilization/materials';
import { applySuccessionEvent, RESIDENT_SUCCESSION_POLICY } from '@aivilization/society';
import { COMMERCE_POLICY } from '@aivilization/commerce';
function fixture(departed: 'host' | 'tenant' | 'both') {
  let w: WorldProjection = createWorldProjection({
    moneySupply: 40,
    agents: ['host', 'tenant'].map((id) => ({
      agentId: asAgentId(id),
      balance: 20,
      inventory: {},
      locationId: null,
      job: null,
      residentialTier: 1,
      educationScore: 0,
      physiology: { energy: 90, satiety: 90, health: 90 },
    })),
  });
  w = {
    ...w,
    residentExits: {
      policy: RESIDENT_EXIT_PRESERVATION_POLICY,
      records: {},
      cash: applyEstateCashEvent(undefined, {
        type: 'EstateCashEnabled',
        policy: ESTATE_CASH_POLICY,
      }),
      materials: applyEstateMaterialEvent(undefined, {
        type: 'EstateMaterialCustodyEnabled',
        policy: ESTATE_MATERIAL_CUSTODY_POLICY,
      }),
      arrangements: applySuccessionEvent(undefined, {
        type: 'SuccessionArrangementsEnabled',
        policy: RESIDENT_SUCCESSION_POLICY,
      }),
    },
  };
  w = applyWorldEvent(
    w,
    enableResidentCommerceEvent({
      simulationId: 'audit',
      requestId: 'enable',
      nextSequence: 1,
      at: 0,
      policy: COMMERCE_POLICY,
    }),
  );
  const d = residentCommerceEvent({
    projection: w,
    actorId: 'tenant',
    command: {
      type: 'deposits.lock',
      id: 'lease-deposit-audit',
      beneficiaryId: 'host',
      amount: 5,
      purpose: 'Existing lease deposit',
    },
    leaseSettlementId: 'lease-deposit-audit',
    requestId: 'lock',
    simulationId: 'audit',
    nextSequence: 2,
  });
  assert.equal(d.accepted, true);
  for (const e of d.events) w = applyWorldEvent(w, e);
  // Existing accepted snapshot: does not claim a new tenancy was consented during this probe.
  w = {
    ...w,
    residentLeases: {
      version: 'resident-leases-v1',
      leases: {
        audit: {
          id: 'audit',
          hostId: 'host',
          tenantId: 'tenant',
          locationId: 'historical-home',
          terms: 'Existing lease',
          rent: 1,
          deposit: 5,
          expiresAt: 100,
          nextRentAt: 86400000,
          arrears: 0,
          revision: 2,
          status: 'active',
          at: 0,
          depositId: 'lease-deposit-audit',
        },
      },
    },
  };
  for (const id of departed === 'both' ? ['host', 'tenant'] : [departed]) {
    const death = createEventEnvelope({
      id: `death-${id}`,
      simulationId: 'audit',
      sequence: id === 'host' ? 3 : 4,
      occurredAt: 0,
      type: 'AgentDied',
      payload: {
        agentId: asAgentId(id),
        cause: 'starvation' as const,
        diedAt: 0,
        ageDays: 0,
        retired: false,
        policyVersion: 'starvation-v1',
        estate: {
          burnedCurrency: 0,
          inventoryByCommodity: {},
          depositForfeited: 0,
          writtenOffLoanIds: [],
        },
      },
    });
    const capture = prepareResidentExitCapture(w, death);
    if (!capture.accepted) throw Error(capture.reason);
    w = applyWorldEvent(w, {
      ...death,
      payload: { ...death.payload, exitPreservation: capture.capture },
    });
  }
  w = { ...w, clock: { ...w.clock, now: 100 } };
  return w;
}

const advance = (w: WorldProjection) =>
  advanceResidentLeases({
    projection: w,
    simulationId: 'audit',
    requestId: 'expiry',
    nextSequence: 10,
    policies: {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 0,
      laborCost: { energyCostPerHour: 1, satietyCostPerHour: 1 },
      criticalThresholds: { energy: 0, health: 0 },
    },
  });
for (const departed of ['host', 'tenant', 'both'] as const)
  test(`lease expiry refunds original tenant after ${departed} departure, atomically and replayably`, () => {
    const w = fixture(departed),
      before = structuredClone(w),
      events = advance(w);
    expect(events).toHaveLength(1);
    const after = events.reduce(applyWorldEvent, w);
    expect(after.residentLeases!.leases.audit!.status).toBe('ended');
    expect(after.residentCommerce!.deposits['lease-deposit-audit']!.held).toBe(0);
    expect(after.moneySupply).toBe(40);
    expect(
      after.agents.tenant?.balance ??
        Object.values(after.residentExits!.cash.accounts).find((a) => a.ownerId === 'tenant')!
          .balance,
    ).toBe(20);
    expect(events.reduce(applyWorldEvent, structuredClone(before))).toEqual(after);
    expect(w).toEqual(before);
    expect(() => applyWorldEvent(after, events[0]!)).toThrow();
    const event = events[0]!;
    if (event.type !== 'ResidentLeaseChanged') throw Error('wrong event');
    const { continuity, ...payload } = event.payload;
    expect(() => applyWorldEvent(w, { ...event, payload })).toThrow(
      'lease-continuity-proof-required',
    );
    expect(() =>
      applyWorldEvent(w, {
        ...event,
        payload: { ...event.payload, continuity: { ...continuity!, paidRent: 99 } },
      }),
    ).toThrow();
    expect(() =>
      applyWorldEvent(w, {
        ...event,
        payload: { ...event.payload, continuity: { ...continuity!, transactions: [] } },
      }),
    ).toThrow();
    expect(w).toEqual(before);
  });
test('living tenant can end original lease after host departure; departed host cannot impersonate a command', () => {
  const w = fixture('host');
  const command = { type: 'end' as const, id: 'audit', expectedRevision: 2 };
  const context = {
    projection: w,
    simulationId: 'audit',
    requestId: 'end',
    nextSequence: 10,
    policies: {
      satietyRecoveryByCommodity: {},
      maxSatiety: 100,
      wageCalculator: () => 0,
      laborCost: { energyCostPerHour: 1, satietyCostPerHour: 1 },
      criticalThresholds: { energy: 0, health: 0 },
    },
  };
  expect(residentLeaseCommand({ ...context, actorId: 'host', command })).toEqual({
    accepted: false,
    reason: 'lease-living-actor-required',
  });
  const result = residentLeaseCommand({ ...context, actorId: 'tenant', command });
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw Error(result.reason);
  const after = result.events.reduce(applyWorldEvent, w);
  expect(after.agents.tenant!.balance).toBe(20);
  expect(after.residentLeases!.leases.audit!.status).toBe('ended');
});

test('original rent across two estate accounts and expiry are equal under whole or segmented cadence', () => {
  const day = 86400000;
  let w = fixture('both');
  w = {
    ...w,
    clock: { ...w.clock, now: 0 },
    residentLeases: {
      ...w.residentLeases!,
      leases: {
        audit: { ...w.residentLeases!.leases.audit!, expiresAt: 3 * day, nextRentAt: day },
      },
    },
  };
  const end = { ...w, clock: { ...w.clock, now: 3 * day } };
  const whole = advance(end).reduce(applyWorldEvent, end);
  let split = w;
  for (const now of [day, 2 * day, 3 * day]) {
    split = { ...split, clock: { ...split.clock, now } };
    split = advance(split).reduce(applyWorldEvent, split);
  }
  expect(split).toEqual(whole);
  expect(
    Object.values(whole.residentExits!.cash.accounts).find((a) => a.ownerId === 'tenant')!.balance,
  ).toBe(18);
  expect(
    Object.values(whole.residentExits!.cash.accounts).find((a) => a.ownerId === 'host')!.balance,
  ).toBe(22);
  expect(whole.moneySupply).toBe(40);
  expect(whole.residentLeases!.leases.audit!.status).toBe('ended');
});
test('insufficient preserved cash accrues original arrears without consuming the refundable deposit', () => {
  const day = 86400000;
  let w = fixture('tenant');
  w = {
    ...w,
    clock: { ...w.clock, now: day },
    residentLeases: {
      ...w.residentLeases!,
      leases: {
        audit: {
          ...w.residentLeases!.leases.audit!,
          rent: 16,
          expiresAt: 2 * day,
          nextRentAt: day,
        },
      },
    },
  };
  const after = advance(w).reduce(applyWorldEvent, w);
  expect(after.residentLeases!.leases.audit!.arrears).toBe(16);
  expect(after.residentCommerce!.deposits['lease-deposit-audit']!.held).toBe(5);
  expect(Object.values(after.residentExits!.cash.accounts)[0]!.balance).toBe(15);
  expect(after.agents.host!.balance).toBe(20);
});
