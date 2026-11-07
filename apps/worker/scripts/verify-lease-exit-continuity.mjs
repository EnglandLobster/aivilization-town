// Directed compiled settlement verification; not natural population or resident adoption evidence.
import assert from 'node:assert/strict';
import {
  createWorldProjection,
  applyWorldEvent,
  residentCommerceEvent,
  enableResidentCommerceEvent,
  advanceResidentLeases,
  prepareResidentExitCapture,
  RESIDENT_EXIT_PRESERVATION_POLICY,
} from '@aivilization/world';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import { applyEstateCashEvent, ESTATE_CASH_POLICY } from '@aivilization/economy';
import { applyEstateMaterialEvent, ESTATE_MATERIAL_CUSTODY_POLICY } from '@aivilization/materials';
import { applySuccessionEvent, RESIDENT_SUCCESSION_POLICY } from '@aivilization/society';
import { COMMERCE_POLICY } from '@aivilization/commerce';
function run(departed) {
  let w = createWorldProjection({
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
  const death = createEventEnvelope({
    id: `death-${departed}`,
    simulationId: 'audit',
    sequence: 3,
    occurredAt: 0,
    type: 'AgentDied',
    payload: {
      agentId: asAgentId(departed),
      cause: 'starvation',
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
  assert.equal(capture.accepted, true);
  w = applyWorldEvent(w, {
    ...death,
    payload: { ...death.payload, exitPreservation: capture.capture },
  });
  w = { ...w, clock: { ...w.clock, now: 100 } };
  const before = structuredClone(w);
  const events = advanceResidentLeases({
    projection: w,
    simulationId: 'audit',
    requestId: 'expiry',
    nextSequence: 4,
    policies: {},
  });
  const after = events.reduce(applyWorldEvent, w);
  assert.equal(events.length, 1);
  assert.equal(after.residentLeases.leases.audit.status, 'ended');
  assert.equal(after.residentCommerce.deposits['lease-deposit-audit'].held, 0);
  assert.equal(
    after.agents.tenant?.balance ??
      Object.values(after.residentExits.cash.accounts).find((a) => a.ownerId === 'tenant').balance,
    20,
  );
  assert.equal(after.moneySupply, 40);
  assert.deepEqual(events.reduce(applyWorldEvent, structuredClone(before)), after);
  assert.deepEqual(w, before);
  return {
    departed,
    replayEqual: true,
    leaseStatus: after.residentLeases.leases.audit.status,
    depositHeld: after.residentCommerce.deposits['lease-deposit-audit'].held,
    moneySupply: w.moneySupply,
    preservedEstateCash: Object.values(after.residentExits.cash.accounts).map((r) => r.balance),
  };
}
console.log(
  JSON.stringify(
    {
      version: 'lease-exit-continuity-verification-v1',
      acceptance: true,
      cases: ['host', 'tenant'].map(run),
    },
    null,
    2,
  ),
);
