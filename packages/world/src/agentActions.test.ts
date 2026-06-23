import { createAmmPool } from '@aivilization/economy';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  handleAgentEatCommand,
  handleAgentApplyJobCommand,
  handleAgentProduceCommand,
  handleAgentSleepCommand,
  handleAgentSocializeCommand,
  handleAgentStudyCommand,
  handleAgentTradeCommand,
  handleAgentWorkCommand,
} from './index';

describe('agent action command handlers', () => {
  test('AgentEat consumes inventory, restores satiety, and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
    });

    const events = handleAgentEatCommand({
      command: createCommandEnvelope({
        id: 'command-eat',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 10,
      }),
      projection,
      satietyRecoveryByCommodity: { Bread: 15 },
      maxSatiety: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'InventoryChanged',
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[1]?.payload).toMatchObject({
      agentId: 'agent-1',
      next: { energy: 100, satiety: 55, health: 100 },
      reason: 'eat',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Bread: 1 });
    expect(updated.memoryRecords[0]?.status).toBe('succeeded');
  });

  test('AgentStudy increases education and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentStudyCommand({
      command: createCommandEnvelope({
        id: 'command-study',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
        issuedAt: 20,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previousEducationScore: 10,
      nextEducationScore: 70,
    });
  });

  test('invalid AgentEat emits rejection and failed STM without mutating inventory', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentEatCommand({
      command: createCommandEnvelope({
        id: 'command-eat',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 10,
      }),
      projection,
      satietyRecoveryByCommodity: { Bread: 15 },
      maxSatiety: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      commandType: 'AgentEat',
      reason: 'insufficient Bread: required 1, available 0',
    });
    expect(events[1]).toMatchObject({
      type: 'ShortTermMemoryRecorded',
      payload: { record: { status: 'failed' } },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({});
    expect(updated.rejectedActions).toHaveLength(1);
  });
});

describe('agent sleep command handling', () => {
  test('AgentSleep restores energy, keeps other physiology stable, and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 90 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSleepCommand({
      command: createCommandEnvelope({
        id: 'command-sleep',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSleep',
        payload: { durationSeconds: 1800 },
        issuedAt: 25,
      }),
      projection,
      energyRecoveryPerSecond: 0.05,
      maxEnergy: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previous: { energy: 40, satiety: 70, health: 90 },
      next: { energy: 100, satiety: 70, health: 90 },
      reason: 'sleep',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.physiology.energy).toBe(100);
    expect(updated.memoryRecords[0]?.status).toBe('succeeded');
  });

  test('AgentSleep rejects invalid payloads without changing physiology', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 90 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSleepCommand({
      command: createCommandEnvelope({
        id: 'command-sleep',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSleep',
        payload: { durationSeconds: -1 },
        issuedAt: 25,
      }),
      projection,
      energyRecoveryPerSecond: 0.05,
      maxEnergy: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentSleep',
      reason: 'AgentSleep durationSeconds must be non-negative',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.physiology.energy).toBe(40);
  });

  test('AgentSleep rejects invalid recovery policy as an observable failed action', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 90 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSleepCommand({
      command: createCommandEnvelope({
        id: 'command-sleep',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSleep',
        payload: { durationSeconds: 10 },
        issuedAt: 25,
      }),
      projection,
      energyRecoveryPerSecond: -1,
      maxEnergy: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentSleep',
      reason: 'energyRecoveryPerSecond must be non-negative',
    });
  });

  test('dispatchWorldCommand routes AgentSleep through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 90 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-sleep',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSleep',
        payload: { durationSeconds: 10 },
        issuedAt: 25,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
        sleep: {
          energyRecoveryPerSecond: 1,
          maxEnergy: 100,
        },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
  });
});

describe('agent work command handling', () => {
  test('AgentWork pays wages, depletes physiology, and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentWorkCommand({
      command: createCommandEnvelope({
        id: 'command-work',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentWork',
        payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
        issuedAt: 30,
      }),
      projection,
      wageCalculator: () => 300,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 20 },
      criticalThresholds: { energy: 1, health: 1 },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'WagePaid',
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({ agentId: 'agent-1', amount: 300 });
    expect(events[1]?.payload).toMatchObject({
      next: { energy: 90, satiety: 60, health: 100 },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.balance).toBe(350);
    expect(updated.memoryRecords[0]?.status).toBe('succeeded');
  });

  test('dispatchWorldCommand routes AgentStudy commands through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-study',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 10, educationRatePerSecond: 1 },
        issuedAt: 40,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
  });

  test('incapacitated agents cannot work and receive rejection plus failed STM only', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 0, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentWorkCommand({
      command: createCommandEnvelope({
        id: 'command-work',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentWork',
        payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
        issuedAt: 30,
      }),
      projection,
      wageCalculator: () => 300,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 20 },
      criticalThresholds: { energy: 1, health: 1 },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentWork',
      reason: 'agent is incapacitated',
    });
    expect(events[1]).toMatchObject({
      type: 'ShortTermMemoryRecorded',
      payload: { record: { status: 'failed' } },
    });
  });
});

describe('agent produce command handling', () => {
  test('AgentProduce uses production rules and records produced commodities', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentProduceCommand({
      command: createCommandEnvelope({
        id: 'command-produce',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Apple', quantity: 2, availableLaborSeconds: 1 },
        issuedAt: 50,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'CommodityProduced',
      'ShortTermMemoryRecorded',
    ]);

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Apple: 2 });
    expect(updated.agents['agent-1']?.physiology.energy).toBe(96);
  });

  test('AgentProduce rejects missing inputs without changing projection state', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentProduceCommand({
      command: createCommandEnvelope({
        id: 'command-produce',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Bread', quantity: 1, availableLaborSeconds: 10 },
        issuedAt: 50,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({ commandType: 'AgentProduce' });
    expect(events[1]).toMatchObject({ payload: { record: { status: 'failed' } } });
  });
});

describe('agent trade command handling', () => {
  test('AgentTrade buy updates balance, inventory, AMM pool, money supply, and STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = handleAgentTradeCommand({
      command: createCommandEnvelope({
        id: 'command-trade',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Apple', quantity: 10 },
        issuedAt: 60,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual(['TradeExecuted', 'ShortTermMemoryRecorded']);

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Apple: 10 });
    expect(updated.agents['agent-1']?.balance).toBeCloseTo(888.8888888889);
    expect(updated.marketPools['Apple']?.commodityReserve).toBe(90);
  });

  test('dispatchWorldCommand routes AgentTrade commands through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-trade',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Apple', quantity: 1 },
        issuedAt: 60,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual(['TradeExecuted', 'ShortTermMemoryRecorded']);
  });

  test('AgentTrade rejects insufficient balance on buy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = handleAgentTradeCommand({
      command: createCommandEnvelope({
        id: 'command-trade',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Apple', quantity: 10 },
        issuedAt: 60,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({ commandType: 'AgentTrade' });
  });

  test('AgentTrade rejects insufficient inventory on sell', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = handleAgentTradeCommand({
      command: createCommandEnvelope({
        id: 'command-trade',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'sell', commodityName: 'Apple', quantity: 1 },
        issuedAt: 60,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentTrade',
      reason: 'insufficient Apple: required 1, available 0',
    });
  });
});

describe('agent job application command handling', () => {
  test('AgentApplyJob checks society rules, assigns the job, and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentApplyJobCommand({
      command: createCommandEnvelope({
        id: 'command-apply',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentApplyJob',
        payload: { occupationName: 'Cleaner' },
        issuedAt: 70,
      }),
      projection,
      populationEducationScores: [0, 10, 20],
      quotaByResidentialTier: [1, 1, 2],
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'JobApplicationSubmitted',
      'JobAssigned',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      occupationName: 'Cleaner',
      residentialTier: 1,
      educationScore: 0,
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.jobApplications).toEqual([
      { agentId: 'agent-1', occupationName: 'Cleaner', submittedAt: 70 },
    ]);
    expect(updated.agents['agent-1']?.job).toBe('Cleaner');
    expect(updated.memoryRecords[0]?.status).toBe('succeeded');
  });

  test('AgentApplyJob rejects agents that are not eligible for the occupation', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentApplyJobCommand({
      command: createCommandEnvelope({
        id: 'command-apply',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentApplyJob',
        payload: { occupationName: 'Doctor' },
        issuedAt: 70,
      }),
      projection,
      populationEducationScores: [0, 100, 300],
      quotaByResidentialTier: [1],
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      commandType: 'AgentApplyJob',
      reason: 'agent is not eligible for Doctor',
    });
  });

  test('AgentApplyJob rejects applications after the residential-tier quota is exhausted', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      jobApplications: [
        {
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          submittedAt: 60,
        },
      ],
    });

    const events = handleAgentApplyJobCommand({
      command: createCommandEnvelope({
        id: 'command-apply',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentApplyJob',
        payload: { occupationName: 'Cleaner' },
        issuedAt: 70,
      }),
      projection,
      populationEducationScores: [0, 10, 20],
      quotaByResidentialTier: [1],
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentApplyJob',
      reason: 'application quota exceeded: allowed 1, used 1',
    });
  });

  test('dispatchWorldCommand routes AgentApplyJob through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-apply',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentApplyJob',
        payload: { occupationName: 'Cleaner' },
        issuedAt: 70,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
        jobApplication: {
          populationEducationScores: [0, 10, 20],
          quotaByResidentialTier: [1],
        },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'JobApplicationSubmitted',
      'JobAssigned',
      'ShortTermMemoryRecorded',
    ]);
  });
});

describe('agent social command handling', () => {
  test('AgentSocialize updates directed relation state and records social STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentSocializeCommand({
      command: createCommandEnvelope({
        id: 'command-social',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSocialize',
        payload: {
          targetAgentId: 'agent-2',
          summary: 'Shared food after work.',
          relationDelta: 0.25,
          attitudeDelta: 0.5,
        },
        issuedAt: 80,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'SocialInteractionCompleted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      sourceAgentId: 'agent-1',
      targetAgentId: 'agent-2',
      summary: 'Shared food after work.',
      relationDelta: 0.25,
      attitudeDelta: 0.5,
      nextRelation: {
        relationScore: 0.25,
        attitudeScore: 0.5,
        relationLabel: 'acquaintance',
        interactionCount: 1,
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.socialRelations['agent-1->agent-2']).toMatchObject({
      sourceAgentId: 'agent-1',
      targetAgentId: 'agent-2',
      relationScore: 0.25,
      attitudeScore: 0.5,
      relationLabel: 'acquaintance',
      interactionCount: 1,
      lastInteractionSummary: 'Shared food after work.',
    });
    expect(updated.memoryRecords[0]).toMatchObject({
      kind: 'social-interaction',
      status: 'succeeded',
      consolidationHint: {
        kind: 'social',
        targetAgentId: 'agent-2',
        relationDelta: 0.25,
        attitudeDelta: 0.5,
        summary: 'Shared food after work.',
      },
    });
  });

  test('AgentSocialize rejects unknown target agents', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentSocializeCommand({
      command: createCommandEnvelope({
        id: 'command-social',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSocialize',
        payload: {
          targetAgentId: 'agent-2',
          summary: 'Looked for a missing friend.',
          relationDelta: 0.1,
          attitudeDelta: 0,
        },
        issuedAt: 80,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentSocialize',
      reason: 'unknown target agent agent-2',
    });
  });

  test('AgentSocialize rejects self-targeted interactions', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentSocializeCommand({
      command: createCommandEnvelope({
        id: 'command-social',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSocialize',
        payload: {
          targetAgentId: 'agent-1',
          summary: 'Tried to socialize with self.',
          relationDelta: 0.1,
          attitudeDelta: 0,
        },
        issuedAt: 80,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentSocialize',
      reason: 'social relation target must differ from source',
    });
  });

  test('AgentSocialize rejects invalid social deltas', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentSocializeCommand({
      command: createCommandEnvelope({
        id: 'command-social',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSocialize',
        payload: {
          targetAgentId: 'agent-2',
          summary: 'Oversized relation update.',
          relationDelta: 2,
          attitudeDelta: 0,
        },
        issuedAt: 80,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentSocialize',
      reason: 'relationDelta must be within [-1, 1]',
    });
  });

  test('dispatchWorldCommand routes AgentSocialize through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-social',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSocialize',
        payload: {
          targetAgentId: 'agent-2',
          summary: 'Talked about market prices.',
          relationDelta: 0.1,
          attitudeDelta: 0.2,
        },
        issuedAt: 80,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'SocialInteractionCompleted',
      'ShortTermMemoryRecorded',
    ]);
  });
});
