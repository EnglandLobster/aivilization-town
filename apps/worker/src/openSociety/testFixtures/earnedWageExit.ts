import { engagementEscrowBalance } from '@aivilization/services';
import { expect } from 'vitest';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import { applyEstateCashEvent, ESTATE_CASH_POLICY, estateCashBalance } from '@aivilization/economy';
import { applyEstateMaterialEvent, ESTATE_MATERIAL_CUSTODY_POLICY } from '@aivilization/materials';
import { applySuccessionEvent, RESIDENT_SUCCESSION_POLICY } from '@aivilization/society';
import {
  applyWorldEvent,
  advanceResidentServiceEngagements,
  settleResidentMaterialEvent,
  prepareResidentExitCapture,
  prepareResidentEmploymentDeparture,
  RESIDENT_EXIT_PRESERVATION_POLICY,
  settleDepartedProductiveWageEvent,
  settleDepartedServiceWageEvent,
  claimProductiveWageEvent,
  claimServiceWageEvent,
  type WorldProjection,
} from '@aivilization/world';

/** Continues a real runtime-produced claim in an isolated population-boundary fixture. */
export function verifyEndedWageAfterExit(
  world: WorldProjection,
  actorId: string,
  id: string,
  kind: 'service' | 'productive',
  active = false,
) {
  const initial: WorldProjection = {
    ...world,
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
  const claim = initial.enterprises.firm!.earnedPayroll!.claims[id]!;
  expect(claim.earnedMicros).toBeGreaterThan(claim.paidMicros);
  expect(claim.status).toBe(active ? 'active' : 'ended');
  const death = createEventEnvelope({
    id: `wage-exit-${kind}`,
    simulationId: 'wage-exit',
    sequence: 10000,
    occurredAt: world.clock.now,
    type: 'AgentDied',
    payload: {
      agentId: asAgentId(actorId),
      cause: 'starvation' as const,
      diedAt: world.clock.now,
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
  if (active) {
    const beforePreparation = structuredClone(initial);
    const coordinated = prepareResidentEmploymentDeparture({
      projection: initial,
      departure: death,
    });
    if (!coordinated.accepted) throw Error(coordinated.reason);
    expect(coordinated.events.at(-1)?.type).toBe('AgentDied');
    expect(coordinated.events.every((e, i) => e.sequence === death.sequence + i)).toBe(true);
    const departed = coordinated.events.reduce(applyWorldEvent, initial);
    const endedClaim = departed.enterprises.firm!.earnedPayroll!.claims[id]!;
    expect(endedClaim.status).toBe('ended');
    expect(endedClaim.earnedMicros).toBe(claim.earnedMicros);
    expect(endedClaim.elapsedMs).toBe(claim.elapsedMs);
    expect(departed.agents[actorId]).toBeUndefined();
    expect(departed.activityTimeByAgent[actorId]).toBeUndefined();
    expect(departed.enterprises.firm!.employeeAgentIds).not.toContain(actorId);
    if (kind === 'productive') {
      expect(departed.materials!.productions.job!.session).toBeUndefined();
      expect(departed.materials!.productions.job!.progressMs).toBe(
        initial.materials!.productions.job!.progressMs,
      );
      expect(departed.materials!.productions.job!.held).toEqual(
        initial.materials!.productions.job!.held,
      );
    } else {
      expect(departed.serviceEngagements!.engagements.service!.providerPresence).toBeUndefined();
      expect(departed.serviceEngagements!.engagements.service!.recipientPresence).toBeUndefined();
      expect(departed.serviceEngagements!.engagements.service!.progressMs).toBe(
        initial.serviceEngagements!.engagements.service!.progressMs,
      );
    }
    const cash = (p: WorldProjection) =>
      Object.values(p.agents).reduce((n, a) => n + a.balance, 0) +
      Object.values(p.enterprises).reduce((n, e) => n + e.balance, 0) +
      (p.treasury ?? 0) +
      estateCashBalance(p.residentExits?.cash) +
      engagementEscrowBalance(p.serviceEngagements);
    expect(cash(departed)).toBeCloseTo(cash(initial), 8);
    expect(departed.moneySupply).toBe(initial.moneySupply);
    expect(initial).toEqual(beforePreparation);
    expect(coordinated.events.reduce(applyWorldEvent, initial)).toEqual(departed);
    expect(
      prepareResidentEmploymentDeparture({ projection: departed, departure: death }).accepted,
    ).toBe(false);
  }
  const capture = prepareResidentExitCapture(initial, death);
  if (!capture.accepted) throw Error(capture.reason);
  const departure = { ...death, payload: { ...death.payload, exitPreservation: capture.capture } };
  const w = applyWorldEvent(initial, departure),
    before = structuredClone(w);
  const request = {
    projection: w,
    id,
    expectedRevision: claim.revision,
    requestId: `pay-${kind}`,
    simulationId: 'wage-exit',
    nextSequence: 10001,
  };
  const settle =
    kind === 'service' ? settleDepartedServiceWageEvent : settleDepartedProductiveWageEvent;
  const personal = kind === 'service' ? claimServiceWageEvent : claimProductiveWageEvent;
  expect(() => personal({ ...request, actorId })).toThrow();
  if (active) {
    expect(() => settle(request)).toThrow('ended-preserved-wage-required');
    const boundary = {
      projection: w,
      requestId: `stop-${kind}`,
      simulationId: 'wage-exit',
      nextSequence: 10002,
    };
    if (kind === 'service') {
      expect(() => advanceResidentServiceEngagements(boundary)).toThrow('service-worker-required');
    } else {
      const at = { ...w, clock: { ...w.clock, now: w.clock.now + 1 } };
      const d = settleResidentMaterialEvent({
        ...boundary,
        projection: at,
        actorId: 'system',
        productionId: 'job',
        authorization: {
          authorize: () => undefined,
          controlAvailable: () => false,
          hasExternalObligation: () => false,
          mayStoreAt: () => true,
        },
      });
      if (!d.accepted) throw Error(d.reason);
      expect(d.events.length).toBeGreaterThan(0);
      expect(() => d.events.reduce(applyWorldEvent, at)).toThrow('productive-worker-missing');
    }
    expect(w).toEqual(before);
    return;
  }
  const paid = settle(request);
  if (paid.type !== 'ResidentServiceWagePaid' && paid.type !== 'ResidentProductiveWagePaid')
    throw Error('unexpected-wage-type');
  const proof = paid.payload.estatePayment;
  if (!proof) throw Error('missing-estate-proof');
  expect(paid.payload.actorId).toBe('system');
  expect(() => settle({ ...request, expectedRevision: claim.revision - 1 })).toThrow(
    'earned-wage-revision-conflict',
  );
  expect(() =>
    applyWorldEvent(w, {
      ...paid,
      payload: { ...paid.payload, estatePayment: { ...proof, populationEventId: 'forged-exit' } },
    }),
  ).toThrow('earned-wage-estate-proof-mismatch');
  expect(() =>
    applyWorldEvent(w, {
      ...paid,
      payload: {
        ...paid.payload,
        compensation: { ...paid.payload.compensation, transactions: [] },
      },
    }),
  ).toThrow('labor-accounting-proof-mismatch');
  expect(() => applyWorldEvent(w, { ...paid, payload: { ...paid.payload, actorId } })).toThrow();
  const { estatePayment, ...legacy } = paid.payload;
  expect(estatePayment).toBeDefined();
  expect(() => applyWorldEvent(w, { ...paid, payload: { ...legacy, actorId } })).toThrow();
  const next = applyWorldEvent(w, paid);
  expect(w).toEqual(before);
  expect(next.agents[actorId]).toBeUndefined();
  expect(next.activityTimeByAgent[actorId]).toBeUndefined();
  const afterClaim = next.enterprises.firm!.earnedPayroll!.claims[id]!;
  expect(afterClaim.earnedMicros).toBe(claim.earnedMicros);
  expect(afterClaim.elapsedMs).toBe(claim.elapsedMs);
  expect(afterClaim.paidMicros).toBeGreaterThan(claim.paidMicros);
  const gross = (afterClaim.paidMicros - claim.paidMicros) / 1e6;
  const tax = next.treasury! - w.treasury!;
  expect(next.enterprises.firm!.balance).toBeCloseTo(w.enterprises.firm!.balance - gross, 8);
  expect(estateCashBalance(next.residentExits!.cash)).toBeCloseTo(
    estateCashBalance(w.residentExits!.cash) + gross - tax,
    8,
  );
  expect(next.moneySupply).toBe(initial.moneySupply);
  expect(next.materials).toEqual(w.materials);
  expect(next.serviceEngagements).toEqual(w.serviceEngagements);
  expect(() => applyWorldEvent(next, paid)).toThrow();
  expect([departure, paid].reduce(applyWorldEvent, initial)).toEqual(next);
}
