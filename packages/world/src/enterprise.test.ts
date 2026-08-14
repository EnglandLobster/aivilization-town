import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 100,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  enterprise: {
    policyVersion: 'enterprise-v1',
    minimumInitialCapital: 100,
    maximumInitialCapital: 10_000,
    maximumEmployees: 10,
  },
};

describe('agent enterprises', () => {
  test('closes the enterprise production, market, wage, and liquidation loop', () => {
    let projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('owner'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 1_000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('worker'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1_000 }],
      moneySupply: 1_000,
    });
    let sequence = 1;
    const dispatch = (input: {
      readonly id: string;
      readonly actorId?: string;
      readonly type:
        | 'AgentFoundEnterprise'
        | 'AgentSetEnterpriseJobPosting'
        | 'AgentJoinEnterprise'
        | 'AgentLeaveEnterprise'
        | 'AgentLayoffEnterpriseEmployee'
        | 'AgentProduce'
        | 'AgentTrade'
        | 'AgentWork'
        | 'AgentCloseEnterprise'
        | 'AdvanceSimulationTime';
      readonly payload: unknown;
    }) => {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id: input.id,
          simulationId: 'sim-enterprise',
          source: 'agent-runtime',
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          type: input.type,
          payload: input.payload,
          issuedAt: projection.clock.now,
        }),
        projection,
        policies,
        nextSequence: sequence,
      });
      sequence += events.length;
      projection = events.reduce(applyWorldEvent, projection);
      return events;
    };

    dispatch({
      id: 'found',
      actorId: 'owner',
      type: 'AgentFoundEnterprise',
      payload: {
        enterpriseId: 'orchard-co',
        name: 'Orchard Co',
        occupationName: 'Worker',
        initialCapital: 500,
        maxEmployees: 2,
      },
    });
    dispatch({
      id: 'posting',
      actorId: 'owner',
      type: 'AgentSetEnterpriseJobPosting',
      payload: { enterpriseId: 'orchard-co', wageOffer: 100, openSlots: 1 },
    });
    const joinEvents = dispatch({
      id: 'join',
      actorId: 'worker',
      type: 'AgentJoinEnterprise',
      payload: { enterpriseId: 'orchard-co' },
    });
    expect(joinEvents[0]).toMatchObject({
      type: 'EnterpriseMemberJoined',
      payload: { enterpriseId: 'orchard-co', agentId: 'worker', wageOffer: 100 },
    });
    expect(projection.enterprises['orchard-co']?.employeeWageOffers).toEqual({ worker: 100 });
    dispatch({
      id: 'produce',
      actorId: 'owner',
      type: 'AgentProduce',
      payload: {
        commodityName: 'Apple',
        quantity: 1,
        availableLaborSeconds: 1,
        enterpriseId: 'orchard-co',
      },
    });
    dispatch({ id: 'advance', type: 'AdvanceSimulationTime', payload: { deltaMs: 1_000 } });
    const tradeEvents = dispatch({
      id: 'sell',
      actorId: 'owner',
      type: 'AgentTrade',
      payload: {
        side: 'sell',
        commodityName: 'Apple',
        quantity: 1,
        enterpriseId: 'orchard-co',
      },
    });
    const supplyAfterSale = projection.moneySupply;
    const enterpriseAfterSale = projection.enterprises['orchard-co'];
    expect(tradeEvents[0]).toMatchObject({
      type: 'TradeExecuted',
      payload: { enterpriseId: 'orchard-co' },
    });
    expect(enterpriseAfterSale?.cumulativeSales).toBeGreaterThan(0);
    expect(enterpriseAfterSale?.inventory).toEqual({});

    const workEvents = dispatch({
      id: 'work',
      actorId: 'worker',
      type: 'AgentWork',
      payload: {
        occupationName: 'Worker',
        laborSeconds: 3_600,
        enterpriseId: 'orchard-co',
      },
    });
    expect(workEvents[0]).toMatchObject({
      type: 'WagePaid',
      payload: {
        fundingSource: 'employer',
        enterpriseId: 'orchard-co',
        amount: 100,
      },
    });
    expect(projection.agents.worker?.balance).toBe(100);
    expect(projection.enterprises['orchard-co']?.cumulativeWages).toBe(100);
    expect(projection.moneySupply).toBe(supplyAfterSale);

    dispatch({
      id: 'close',
      actorId: 'owner',
      type: 'AgentCloseEnterprise',
      payload: { enterpriseId: 'orchard-co' },
    });
    expect(projection.enterprises['orchard-co']).toMatchObject({
      status: 'closed',
      balance: 0,
      inventory: {},
    });
    expect(projection.agents.worker?.job).toBeNull();
    expect(totalPrivateMoney(projection)).toBeCloseTo(projection.moneySupply);
  });

  test('pays policy-bounded dividends as a balanced enterprise-to-owner transfer', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('owner'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 50,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      enterprises: [
        {
          enterpriseId: 'profitable-co',
          name: 'Profitable Co',
          ownerAgentId: asAgentId('owner'),
          occupationName: 'Maker',
          balance: 500,
          inventory: {},
          maxEmployees: 2,
          employeeAgentIds: [],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 200,
          cumulativePurchases: 0,
          cumulativeWages: 0,
          retainedEarnings: 200,
        },
      ],
      moneySupply: 550,
    });
    const dividendPolicies: WorldCommandPolicies = {
      ...policies,
      enterprise: {
        ...policies.enterprise!,
        dividend: {
          paymentCadenceMs: 1_000,
          minimumCashReserve: 100,
          payoutRatio: 0.5,
        },
      },
    };
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'advance-dividend',
        simulationId: 'sim-enterprise',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_000 },
        issuedAt: 0,
      }),
      projection,
      policies: dividendPolicies,
      nextSequence: 1,
    });
    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EnterpriseDividendPaid',
    ]);
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.enterprises['profitable-co']).toMatchObject({
      balance: 400,
      retainedEarnings: 100,
      cumulativeDividends: 100,
    });
    expect(updated.agents.owner?.balance).toBe(150);
    expect(updated.moneySupply).toBe(550);
  });

  test('marks persistent insolvency, declares bankruptcy, and liquidates atomically', () => {
    let projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('owner'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('worker'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: 'Maker',
          inventory: {},
        },
      ],
      enterprises: [
        {
          enterpriseId: 'failed-co',
          name: 'Failed Co',
          ownerAgentId: asAgentId('owner'),
          occupationName: 'Maker',
          balance: 0,
          inventory: { Apple: 2 },
          maxEmployees: 2,
          employeeAgentIds: [asAgentId('worker')],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 0,
          cumulativePurchases: 0,
          cumulativeWages: 0,
        },
      ],
      moneySupply: 0,
    });
    const insolvencyPolicies: WorldCommandPolicies = {
      ...policies,
      enterprise: {
        ...policies.enterprise!,
        solvency: {
          evaluationCadenceMs: 1_000,
          minimumCashBalance: 1,
          gracePeriodMs: 1_000,
        },
      },
    };
    const advance = (id: string) => {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id,
          simulationId: 'sim-enterprise',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs: 1_000 },
          issuedAt: projection.clock.now,
        }),
        projection,
        policies: insolvencyPolicies,
        nextSequence: 1,
      });
      projection = events.reduce(applyWorldEvent, projection);
      return events;
    };

    expect(advance('insolvency').map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EnterpriseInsolvencyStarted',
    ]);
    expect(projection.enterprises['failed-co']?.status).toBe('insolvent');
    expect(advance('bankruptcy').map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EnterpriseBankruptcyDeclared',
      'EnterpriseClosed',
    ]);
    expect(projection.enterprises['failed-co']?.status).toBe('closed');
    expect(projection.agents.worker?.job).toBeNull();
    expect(projection.agents.owner?.inventory).toEqual({ Apple: 2 });
  });

  test('runs the hiring loop: posting-gated join, arrears, repayment, leave and layoff', () => {
    let projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('owner'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 500,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('worker'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('second'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 500,
    });
    let sequence = 1;
    const dispatch = (input: {
      readonly id: string;
      readonly actorId?: string;
      readonly type:
        | 'AgentFoundEnterprise'
        | 'AgentSetEnterpriseJobPosting'
        | 'AgentJoinEnterprise'
        | 'AgentLeaveEnterprise'
        | 'AgentLayoffEnterpriseEmployee'
        | 'AgentFundEnterprise'
        | 'AgentWork'
        | 'AdvanceSimulationTime';
      readonly payload: unknown;
    }) => {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id: input.id,
          simulationId: 'sim-hiring',
          source: 'agent-runtime',
          ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
          type: input.type,
          payload: input.payload,
          issuedAt: projection.clock.now,
        }),
        projection,
        policies,
        nextSequence: sequence,
      });
      sequence += events.length;
      projection = events.reduce(applyWorldEvent, projection);
      return events;
    };

    // Joining before any posting is published is rejected.
    const earlyJoin = dispatch({
      id: 'early-join',
      actorId: 'worker',
      type: 'AgentJoinEnterprise',
      payload: { enterpriseId: 'missing-co' },
    });
    expect(earlyJoin[0]?.type).toBe('ActionRejected');

    dispatch({
      id: 'found',
      actorId: 'owner',
      type: 'AgentFoundEnterprise',
      payload: {
        enterpriseId: 'workshop',
        name: 'Workshop',
        occupationName: 'Worker',
        initialCapital: 100,
        maxEmployees: 2,
      },
    });
    const unpostedJoin = dispatch({
      id: 'unposted-join',
      actorId: 'worker',
      type: 'AgentJoinEnterprise',
      payload: { enterpriseId: 'workshop' },
    });
    expect(unpostedJoin[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { reason: 'enterprise has not published a job posting' },
    });

    const posting = dispatch({
      id: 'posting',
      actorId: 'owner',
      type: 'AgentSetEnterpriseJobPosting',
      payload: { enterpriseId: 'workshop', wageOffer: 100, openSlots: 2 },
    });
    expect(posting.map((event) => event.type)).toEqual([
      'EnterpriseJobPostingUpdated',
      'ShortTermMemoryRecorded',
    ]);

    dispatch({
      id: 'join',
      actorId: 'worker',
      type: 'AgentJoinEnterprise',
      payload: { enterpriseId: 'workshop' },
    });
    expect(projection.agents.worker?.job).toBe('Worker');

    // Payroll fully covered by cash: wage paid, no arrears memo.
    const shortWork = dispatch({
      id: 'work-short',
      actorId: 'worker',
      type: 'AgentWork',
      payload: { occupationName: 'Worker', laborSeconds: 1, enterpriseId: 'workshop' },
    });
    expect(shortWork.map((event) => event.type)).toEqual([
      'WagePaid',
      'PhysiologyChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(shortWork[0]).toMatchObject({
      payload: { fundingSource: 'employer', amount: 100, enterpriseId: 'workshop' },
    });
    expect(projection.enterprises['workshop']?.wageArrears).toBe(0);
    expect(projection.enterprises['workshop']?.balance).toBe(0);
    expect(projection.agents.worker?.balance).toBe(100);

    dispatch({ id: 'advance-1', type: 'AdvanceSimulationTime', payload: { deltaMs: 1_000 } });

    // The enterprise is out of cash: work still settles, arrears accrue.
    const missedWork = dispatch({
      id: 'work-missed',
      actorId: 'worker',
      type: 'AgentWork',
      payload: { occupationName: 'Worker', laborSeconds: 1, enterpriseId: 'workshop' },
    });
    expect(missedWork.map((event) => event.type)).toEqual([
      'EnterpriseWageArrearsUpdated',
      'PhysiologyChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
      'ShortTermMemoryRecorded',
    ]);
    expect(missedWork[0]).toMatchObject({
      payload: { wageAmount: 100, paidAmount: 0, previousArrears: 0, nextArrears: 100 },
    });
    expect(
      missedWork.some(
        (event) =>
          event.type === 'ShortTermMemoryRecorded' &&
          event.payload.record.tags.includes('wage-arrears'),
      ),
    ).toBe(true);
    expect(projection.enterprises['workshop']?.wageArrears).toBe(100);
    expect(projection.agents.worker?.balance).toBe(100);

    // Refunding the enterprise lets the next payroll repay arrears first.
    dispatch({
      id: 'refund',
      actorId: 'owner',
      type: 'AgentFundEnterprise',
      payload: { enterpriseId: 'workshop', amount: 200 },
    });
    dispatch({ id: 'advance-2', type: 'AdvanceSimulationTime', payload: { deltaMs: 1_000 } });
    const catchUpWork = dispatch({
      id: 'work-catch-up',
      actorId: 'worker',
      type: 'AgentWork',
      payload: { occupationName: 'Worker', laborSeconds: 1, enterpriseId: 'workshop' },
    });
    expect(catchUpWork[0]).toMatchObject({
      payload: { fundingSource: 'employer', amount: 200 },
    });
    expect(catchUpWork[1]).toMatchObject({
      payload: { previousArrears: 100, nextArrears: 0 },
    });
    expect(projection.enterprises['workshop']?.wageArrears).toBe(0);
    expect(projection.enterprises['workshop']?.balance).toBe(0);
    expect(projection.agents.worker?.balance).toBe(300);
    expect(projection.moneySupply).toBe(500);

    // Leave clears the job; re-joining is possible while a slot stays open.
    dispatch({ id: 'advance-3', type: 'AdvanceSimulationTime', payload: { deltaMs: 1_000 } });
    const leave = dispatch({
      id: 'leave',
      actorId: 'worker',
      type: 'AgentLeaveEnterprise',
      payload: { enterpriseId: 'workshop' },
    });
    expect(leave.map((event) => event.type)).toEqual([
      'EnterpriseEmployeeLeft',
      'ShortTermMemoryRecorded',
    ]);
    expect(projection.agents.worker?.job).toBeNull();
    expect(projection.enterprises['workshop']?.employeeWageOffers).toEqual({});

    // Layoff by a non-owner is rejected; by the owner it clears the employee job.
    dispatch({
      id: 'join-second',
      actorId: 'second',
      type: 'AgentJoinEnterprise',
      payload: { enterpriseId: 'workshop' },
    });
    const badLayoff = dispatch({
      id: 'layoff-by-employee',
      actorId: 'second',
      type: 'AgentLayoffEnterpriseEmployee',
      payload: { enterpriseId: 'workshop', employeeAgentId: 'second' },
    });
    expect(badLayoff[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { reason: 'only the enterprise owner may lay off employees' },
    });
    const layoff = dispatch({
      id: 'layoff',
      actorId: 'owner',
      type: 'AgentLayoffEnterpriseEmployee',
      payload: { enterpriseId: 'workshop', employeeAgentId: 'second' },
    });
    expect(layoff.map((event) => event.type)).toEqual([
      'EnterpriseEmployeeLaidOff',
      'ShortTermMemoryRecorded',
      'ShortTermMemoryRecorded',
    ]);
    expect(projection.agents.second?.job).toBeNull();
    expect(projection.enterprises['workshop']?.employeeAgentIds).toEqual([]);
    expect(totalPrivateMoney(projection)).toBeCloseTo(projection.moneySupply);
  });

  test('pays public wages from the treasury when present, discounted when short', () => {
    let projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('public-worker'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
      moneySupply: 1_150,
      treasury: 150,
    });
    let sequence = 1;
    const advance = (id: string) => {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id,
          simulationId: 'sim-fiscal',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs: 1_000 },
          issuedAt: projection.clock.now,
        }),
        projection,
        policies,
        nextSequence: sequence,
      });
      sequence += events.length;
      projection = events.reduce(applyWorldEvent, projection);
    };
    const work = (id: string) => {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id,
          simulationId: 'sim-fiscal',
          source: 'agent-runtime',
          actorId: 'public-worker',
          type: 'AgentWork',
          payload: { occupationName: 'Cleaner', laborSeconds: 1 },
          issuedAt: projection.clock.now,
        }),
        projection,
        policies,
        nextSequence: sequence,
      });
      sequence += events.length;
      projection = events.reduce(applyWorldEvent, projection);
      return events;
    };

    const full = work('work-full');
    expect(full[0]).toMatchObject({
      type: 'WagePaid',
      payload: { fundingSource: 'treasury', amount: 100 },
    });
    expect(projection.treasury).toBe(50);
    expect(projection.agents['public-worker']?.balance).toBe(100);
    // Treasury payroll is a transfer: the money supply does not move.
    expect(projection.moneySupply).toBe(1_150);

    advance('advance-1');
    const discounted = work('work-discounted');
    expect(discounted[0]).toMatchObject({
      type: 'WagePaid',
      payload: { fundingSource: 'treasury', amount: 50 },
    });
    expect(discounted.map((event) => event.type)).toContain('ShortTermMemoryRecorded');
    expect(
      discounted.some(
        (event) =>
          event.type === 'ShortTermMemoryRecorded' &&
          event.payload.record.tags.includes('treasury-wage-discount'),
      ),
    ).toBe(true);
    expect(projection.treasury).toBe(0);
    expect(projection.moneySupply).toBe(1_150);

    // An empty treasury pays nothing and emits no WagePaid; v1 records no public debt.
    advance('advance-2');
    const unpaid = work('work-unpaid');
    expect(unpaid.map((event) => event.type)).toEqual([
      'PhysiologyChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
      'ShortTermMemoryRecorded',
    ]);
    expect(projection.agents['public-worker']?.balance).toBe(150);
    expect(projection.moneySupply).toBe(1_150);
  });

  test('charges dividend tax into the treasury as a balanced transfer', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('owner'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 50,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      enterprises: [
        {
          enterpriseId: 'profitable-co',
          name: 'Profitable Co',
          ownerAgentId: asAgentId('owner'),
          occupationName: 'Maker',
          balance: 500,
          inventory: {},
          maxEmployees: 2,
          employeeAgentIds: [],
          status: 'active',
          foundedAt: 0,
          cumulativeSales: 200,
          cumulativePurchases: 0,
          cumulativeWages: 0,
          retainedEarnings: 200,
        },
      ],
      moneySupply: 550,
      treasury: 0,
    });
    const dividendTaxPolicies: WorldCommandPolicies = {
      ...policies,
      enterprise: {
        ...policies.enterprise!,
        dividend: { paymentCadenceMs: 1_000, minimumCashReserve: 100, payoutRatio: 0.5 },
      },
      tax: {
        policyVersion: 'tax-regime-test',
        neutralRate: 0.1,
        incomeTaxBrackets: [{ upToAmount: null, rate: 0 }],
        tradeTaxRate: 0,
        dividendTaxRate: 0.1,
        source: 'test',
      },
    };
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'advance-dividend-tax',
        simulationId: 'sim-enterprise',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1_000 },
        issuedAt: 0,
      }),
      projection,
      policies: dividendTaxPolicies,
      nextSequence: 1,
    });
    expect(events.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EnterpriseDividendPaid',
      'DividendTaxCharged',
    ]);
    expect(events[2]).toMatchObject({
      payload: {
        enterpriseId: 'profitable-co',
        dividendAmount: 100,
        amount: 10,
        previousTreasury: 0,
        nextTreasury: 10,
      },
    });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.enterprises['profitable-co']).toMatchObject({
      balance: 390,
      retainedEarnings: 90,
      cumulativeDividends: 100,
    });
    expect(updated.treasury).toBe(10);
    expect(updated.agents.owner?.balance).toBe(150);
    expect(updated.moneySupply).toBe(550);
  });

  test('skips the dividend tax when the enterprise cannot cover it or the policy has no rate', () => {
    const makeProjection = () =>
      createWorldProjection({
        agents: [
          {
            agentId: asAgentId('owner'),
            physiology: { energy: 100, satiety: 100, health: 100 },
            educationScore: 0,
            balance: 0,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
        ],
        enterprises: [
          {
            enterpriseId: 'tight-co',
            name: 'Tight Co',
            ownerAgentId: asAgentId('owner'),
            occupationName: 'Maker',
            balance: 100,
            inventory: {},
            maxEmployees: 2,
            employeeAgentIds: [],
            status: 'active',
            foundedAt: 0,
            cumulativeSales: 200,
            cumulativePurchases: 0,
            cumulativeWages: 0,
            retainedEarnings: 200,
          },
        ],
        moneySupply: 100,
        treasury: 0,
      });
    const advance = (
      projection: WorldProjection,
      tax: WorldCommandPolicies['tax'],
    ): [WorldEvent[], WorldProjection] => {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          id: 'advance-tight',
          simulationId: 'sim-enterprise',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs: 1_000 },
          issuedAt: 0,
        }),
        projection,
        policies: {
          ...policies,
          enterprise: {
            ...policies.enterprise!,
            dividend: { paymentCadenceMs: 1_000, minimumCashReserve: 0, payoutRatio: 0.5 },
          },
          ...(tax === undefined ? {} : { tax }),
        },
        nextSequence: 1,
      });
      return [events, events.reduce(applyWorldEvent, projection)];
    };

    // A 100% rate would tax the whole dividend; the post-dividend balance is 0,
    // so the tax is skipped (v1 records no tax debt).
    const [skippedEvents, skippedProjection] = advance(makeProjection(), {
      policyVersion: 'tax-regime-test',
      neutralRate: 0.1,
      incomeTaxBrackets: [{ upToAmount: null, rate: 0 }],
      tradeTaxRate: 0,
      dividendTaxRate: 1,
      source: 'test',
    });
    expect(skippedEvents.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EnterpriseDividendPaid',
    ]);
    expect(skippedProjection.treasury).toBe(0);
    expect(skippedProjection.enterprises['tight-co']?.balance).toBe(0);

    // A legacy tax policy without dividendTaxRate leaves dividends untaxed.
    const [legacyEvents, legacyProjection] = advance(makeProjection(), {
      policyVersion: 'tax-regime-legacy',
      neutralRate: 0.1,
      incomeTaxBrackets: [{ upToAmount: null, rate: 0 }],
      tradeTaxRate: 0,
      source: 'test',
    });
    expect(legacyEvents.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'EnterpriseDividendPaid',
    ]);
    expect(legacyProjection.treasury).toBe(0);
    expect(legacyProjection.enterprises['tight-co']?.balance).toBe(0);
    expect(legacyProjection.moneySupply).toBe(100);
  });
});

function totalPrivateMoney(projection: WorldProjection): number {
  return (
    Object.values(projection.agents).reduce((total, agent) => total + agent.balance, 0) +
    Object.values(projection.enterprises).reduce(
      (total, enterprise) => total + enterprise.balance,
      0,
    )
  );
}
