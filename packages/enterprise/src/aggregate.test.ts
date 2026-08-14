import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyEnterpriseDomainEvent,
  decideFoundEnterprise,
  decideJoinEnterprise,
  decideLayoffEmployee,
  decideLeaveEnterprise,
  decidePayWage,
  decideSetEnterpriseJobPosting,
} from './aggregate';
import { evaluateEnterpriseLifecycle } from './lifecycle';
import { normalizeEnterpriseState } from './model';
import type { EnterprisePolicy } from './policy';
import type { EnterpriseState } from './model';

const ownerId = asAgentId('owner');
const policy: EnterprisePolicy = {
  policyVersion: 'enterprise-v2',
  minimumInitialCapital: 100,
  maximumInitialCapital: 10_000,
  maximumEmployees: 10,
  solvency: {
    evaluationCadenceMs: 1_000,
    minimumCashBalance: 50,
    gracePeriodMs: 2_000,
  },
  dividend: {
    paymentCadenceMs: 1_000,
    minimumCashReserve: 100,
    payoutRatio: 0.5,
  },
};

describe('enterprise aggregate', () => {
  test('owns founding and membership invariants', () => {
    const founded = decideFoundEnterprise({
      existing: undefined,
      enterpriseId: 'firm',
      name: 'Firm',
      ownerAgentId: ownerId,
      occupationName: 'Maker',
      initialCapital: 200,
      maxEmployees: 2,
      occurredAt: 0,
      policy,
    });
    expect(founded.status).toBe('accepted');
    if (founded.status !== 'accepted') return;
    let state: EnterpriseState | undefined;
    for (const event of founded.events) {
      state = applyEnterpriseDomainEvent(state, event);
    }
    expect(state).toBeDefined();
    if (state === undefined) return;
    expect(state).toMatchObject({
      enterpriseId: 'firm',
      balance: 200,
      status: 'active',
      ownershipShares: { owner: 1 },
    });
    // Hiring requires a published job posting first.
    expect(decideJoinEnterprise({ enterprise: state, agentId: asAgentId('worker') }).status).toBe(
      'rejected',
    );
    const posted = decideSetEnterpriseJobPosting({
      enterprise: state,
      actorAgentId: ownerId,
      wageOffer: 50,
      openSlots: 2,
    });
    expect(posted.status).toBe('accepted');
    if (posted.status !== 'accepted') return;
    const withPosting = posted.events.reduce(applyEnterpriseDomainEvent, state);
    const joined = decideJoinEnterprise({ enterprise: withPosting, agentId: asAgentId('worker') });
    expect(joined.status).toBe('accepted');
    if (joined.status !== 'accepted') return;
    expect(joined.events[0]).toMatchObject({ type: 'EnterpriseMemberJoined', wageOffer: 50 });
  });

  test('moves through insolvent, recovered, and bankrupt states by policy', () => {
    const starting = enterprise({ balance: 40 });
    const first = evaluateEnterpriseLifecycle({ enterprise: starting, evaluatedAt: 1_000, policy });
    expect(first.events.map((event) => event.type)).toEqual(['EnterpriseInsolvencyStarted']);
    const insolvent = first.events.reduce(applyEnterpriseDomainEvent, starting);
    expect(insolvent).toMatchObject({ status: 'insolvent', insolvencyStartedAt: 1_000 });

    const recovered = evaluateEnterpriseLifecycle({
      enterprise: { ...insolvent, balance: 60 },
      evaluatedAt: 2_000,
      policy,
    });
    expect(recovered.events.map((event) => event.type)).toEqual(['EnterpriseSolvencyRestored']);

    const bankruptcy = evaluateEnterpriseLifecycle({
      enterprise: insolvent,
      evaluatedAt: 3_000,
      policy,
    });
    expect(bankruptcy.events.map((event) => event.type)).toEqual(['EnterpriseBankruptcyDeclared']);
  });

  test('pays dividends only from profit and cash above the reserve', () => {
    const state = enterprise({
      balance: 180,
      retainedEarnings: 200,
      ownershipShares: { owner: 0.75, investor: 0.25 },
    });
    const decision = evaluateEnterpriseLifecycle({ enterprise: state, evaluatedAt: 1_000, policy });
    expect(decision.events).toEqual([
      { type: 'EnterpriseDividendPaid', totalAmount: 80, paidAt: 1_000 },
    ]);
    expect(decision.dividendPayments).toEqual([
      { agentId: asAgentId('investor'), amount: 20 },
      { agentId: ownerId, amount: 60 },
    ]);
  });
});

describe('enterprise hiring decisions', () => {
  test('only the owner can publish a posting, within capacity and operational status', () => {
    const state = enterprise();
    expect(
      decideSetEnterpriseJobPosting({
        enterprise: state,
        actorAgentId: asAgentId('intruder'),
        wageOffer: 50,
        openSlots: 1,
      }),
    ).toEqual({ status: 'rejected', reason: 'only the enterprise owner may set the job posting' });
    expect(
      decideSetEnterpriseJobPosting({
        enterprise: state,
        actorAgentId: ownerId,
        wageOffer: 0,
        openSlots: 1,
      }).status,
    ).toBe('rejected');
    expect(
      decideSetEnterpriseJobPosting({
        enterprise: state,
        actorAgentId: ownerId,
        wageOffer: 50,
        openSlots: 6,
      }).status,
    ).toBe('rejected');
    expect(
      decideSetEnterpriseJobPosting({
        enterprise: enterprise({ status: 'closed' }),
        actorAgentId: ownerId,
        wageOffer: 50,
        openSlots: 1,
      }),
    ).toEqual({ status: 'rejected', reason: 'enterprise is bankrupt or closed' });

    const acceptedDecision = decideSetEnterpriseJobPosting({
      enterprise: state,
      actorAgentId: ownerId,
      wageOffer: 50,
      openSlots: 2,
    });
    expect(acceptedDecision.status).toBe('accepted');
    if (acceptedDecision.status !== 'accepted') return;
    const replayed = acceptedDecision.events.reduce(applyEnterpriseDomainEvent, state);
    expect(replayed.jobPosting).toEqual({ wageOffer: 50, openSlots: 2 });
  });

  test('joining requires an open posted slot and records the contracted wage', () => {
    const posted = enterprise({ jobPosting: { wageOffer: 50, openSlots: 1 } });
    const firstJoin = decideJoinEnterprise({ enterprise: posted, agentId: asAgentId('worker') });
    expect(firstJoin.status).toBe('accepted');
    if (firstJoin.status !== 'accepted') return;
    const afterJoin = firstJoin.events.reduce(applyEnterpriseDomainEvent, posted);
    expect(afterJoin.employeeAgentIds).toEqual(['worker']);
    expect(afterJoin.employeeWageOffers).toEqual({ worker: 50 });

    // The single posted slot is now filled.
    expect(decideJoinEnterprise({ enterprise: afterJoin, agentId: asAgentId('second') })).toEqual({
      status: 'rejected',
      reason: 'enterprise job posting has no open slots',
    });
    // Legacy members without a recorded offer keep working under the wage regime.
    const legacyMember = normalizeEnterpriseState(
      enterprise({ employeeAgentIds: [asAgentId('legacy')] }),
    );
    expect(legacyMember.employeeWageOffers).toEqual({});
    expect(legacyMember.wageArrears).toBe(0);
  });

  test('leaving and layoffs remove membership and the contracted wage', () => {
    const workerId = asAgentId('worker');
    const state = enterprise({
      employeeAgentIds: [workerId],
      employeeWageOffers: { worker: 50 },
      jobPosting: { wageOffer: 50, openSlots: 2 },
    });

    expect(decideLeaveEnterprise({ enterprise: state, agentId: asAgentId('stranger') })).toEqual({
      status: 'rejected',
      reason: 'agent is not an enterprise employee',
    });
    expect(
      decideLayoffEmployee({
        enterprise: state,
        actorAgentId: asAgentId('stranger'),
        employeeAgentId: workerId,
      }),
    ).toEqual({ status: 'rejected', reason: 'only the enterprise owner may lay off employees' });
    expect(
      decideLayoffEmployee({
        enterprise: enterprise({ status: 'closed' }),
        actorAgentId: ownerId,
        employeeAgentId: workerId,
      }),
    ).toEqual({ status: 'rejected', reason: 'enterprise is closed' });

    const left = decideLeaveEnterprise({ enterprise: state, agentId: workerId });
    expect(left.status).toBe('accepted');
    if (left.status !== 'accepted') return;
    const afterLeave = left.events.reduce(applyEnterpriseDomainEvent, state);
    expect(afterLeave.employeeAgentIds).toEqual([]);
    expect(afterLeave.employeeWageOffers).toEqual({});

    const laidOff = decideLayoffEmployee({
      enterprise: state,
      actorAgentId: ownerId,
      employeeAgentId: workerId,
    });
    expect(laidOff.status).toBe('accepted');
    if (laidOff.status !== 'accepted') return;
    expect(laidOff.events[0]).toEqual({ type: 'EnterpriseEmployeeLaidOff', agentId: workerId });
    const afterLayoff = laidOff.events.reduce(applyEnterpriseDomainEvent, state);
    expect(afterLayoff.employeeAgentIds).toEqual([]);
    expect(afterLayoff.employeeWageOffers).toEqual({});
  });
});

describe('decidePayWage', () => {
  test('pays in full when cash covers the wage', () => {
    expect(decidePayWage({ wage: 100, balance: 250, arrears: 0 })).toEqual({
      paid: 100,
      nextArrears: 0,
    });
  });

  test('accrues arrears on partial pay and on a fully missed payroll', () => {
    expect(decidePayWage({ wage: 100, balance: 40, arrears: 0 })).toEqual({
      paid: 40,
      nextArrears: 60,
    });
    expect(decidePayWage({ wage: 100, balance: 0, arrears: 60 })).toEqual({
      paid: 0,
      nextArrears: 160,
    });
  });

  test('repays arrears from the surplus above the wage before anything else', () => {
    expect(decidePayWage({ wage: 100, balance: 300, arrears: 160 })).toEqual({
      paid: 260,
      nextArrears: 0,
    });
    expect(decidePayWage({ wage: 100, balance: 180, arrears: 160 })).toEqual({
      paid: 180,
      nextArrears: 80,
    });
  });

  test('pins paid + nextArrears === wage + arrears with non-negative arrears', () => {
    const cases = [
      { wage: 100, balance: 0, arrears: 0 },
      { wage: 100, balance: 99.5, arrears: 10 },
      { wage: 100, balance: 100, arrears: 5 },
      { wage: 100, balance: 10_000, arrears: 3 },
      { wage: 0, balance: 50, arrears: 20 },
    ];
    for (const input of cases) {
      const { paid, nextArrears } = decidePayWage(input);
      expect(paid).toBeGreaterThanOrEqual(0);
      expect(paid).toBeLessThanOrEqual(input.balance);
      expect(nextArrears).toBeGreaterThanOrEqual(0);
      expect(paid + nextArrears).toBeCloseTo(input.wage + input.arrears);
    }
  });

  test('rejects non-finite or negative inputs', () => {
    expect(() => decidePayWage({ wage: -1, balance: 0, arrears: 0 })).toThrow();
    expect(() => decidePayWage({ wage: 1, balance: Number.NaN, arrears: 0 })).toThrow();
    expect(() => decidePayWage({ wage: 1, balance: 0, arrears: -5 })).toThrow();
  });

  test('replays the arrears memo through the aggregate', () => {
    const state = enterprise({ balance: 40 });
    const updated = applyEnterpriseDomainEvent(state, {
      type: 'EnterpriseWageArrearsUpdated',
      nextArrears: 60,
    });
    expect(updated.wageArrears).toBe(60);
    expect(updated.balance).toBe(40);
    expect(() =>
      applyEnterpriseDomainEvent(state, { type: 'EnterpriseWageArrearsUpdated', nextArrears: -1 }),
    ).toThrow();
  });
});

function enterprise(overrides: Partial<EnterpriseState> = {}): EnterpriseState {
  return {
    enterpriseId: 'firm',
    name: 'Firm',
    ownerAgentId: ownerId,
    occupationName: 'Maker',
    balance: 200,
    inventory: {},
    maxEmployees: 5,
    employeeAgentIds: [],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 200,
    cumulativePurchases: 0,
    cumulativeWages: 0,
    ...overrides,
  };
}
