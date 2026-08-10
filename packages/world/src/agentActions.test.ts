import { createAmmPool } from '@aivilization/economy';
import {
  asAgentId,
  asLocationId,
  createCommandEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import type { ResidentialPhysiologyCapPolicy } from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  handleAgentEatCommand,
  handleAgentApplyJobCommand,
  handleAgentMoveToCommand,
  handleAgentObserveLocationCommand,
  handleAgentStartConversationCommand,
  handleAgentProduceCommand,
  handleAgentSeeDoctorCommand,
  handleAgentUpgradeResidentialTierCommand,
  handleAgentSleepCommand,
  handleAgentSocializeCommand,
  handleAgentStudyCommand,
  handleAgentTradeCommand,
  handleAgentGiveResourceCommand,
  handleAgentWorkCommand,
  handleAdvanceSimulationTimeCommand,
  handleRegisterAgentCommand,
} from './index';

const residentialPhysiologyCaps: ResidentialPhysiologyCapPolicy = {
  caps: [
    { residentialTier: 1, maxEnergy: 80, maxSatiety: 70, maxHealth: 90 },
    { residentialTier: 2, maxEnergy: 120, maxSatiety: 90, maxHealth: 110 },
  ],
};

describe('agent action command handlers', () => {
  test('RegisterAgent creates a replayable attributed agent and updates money supply once', () => {
    const projection = createWorldProjection({ agents: [], moneySupply: 500 });
    const command = createCommandEnvelope({
      id: 'register-agent-ada',
      simulationId: 'sim-1',
      actorId: 'agent-ada',
      source: 'human',
      type: 'RegisterAgent',
      payload: {
        agentId: 'agent-ada',
        creatorId: 'participant-7',
        displayName: 'Ada',
      },
      issuedAt: 90,
    });

    const events = handleRegisterAgentCommand({ command, projection, nextSequence: 1 });
    expect(events).toMatchObject([
      {
        id: 'register-agent-ada:event:0',
        commandId: 'register-agent-ada',
        type: 'AgentRegistered',
        payload: {
          registrationId: 'register-agent-ada',
          policyVersion: 'runtime-agent-registration-v3',
          creatorId: 'participant-7',
          source: 'human',
          displayName: 'Ada',
          agentId: 'agent-ada',
          initialState: {
            locationId: null,
            physiology: { energy: 100, satiety: 100, health: 100 },
            educationScore: 0,
            balance: 100,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
          moneySupplyDelta: 100,
        },
      },
    ]);

    const replayed = events.reduce(applyWorldEvent, projection);
    expect(replayed.moneySupply).toBe(600);
    expect(replayed.agents['agent-ada']).toMatchObject({
      agentId: 'agent-ada',
      balance: 100,
      registration: {
        registrationId: 'register-agent-ada',
        creatorId: 'participant-7',
        displayName: 'Ada',
        registeredAt: 90,
        provenance: 'post-bootstrap-command',
      },
    });

    const duplicate = handleRegisterAgentCommand({
      command,
      projection: replayed,
      nextSequence: 2,
    });
    expect(duplicate[0]).toMatchObject({
      type: 'AgentRegistrationRejected',
      payload: { agentId: 'agent-ada', reason: 'agent-id-already-exists' },
    });
  });

  test('RegisterAgent enforces the configured creator quota in authoritative world state', () => {
    const initial = createWorldProjection({ agents: [] });
    const firstCommand = createCommandEnvelope({
      id: 'register-agent-first',
      simulationId: 'sim-1',
      actorId: 'agent-first',
      source: 'human',
      type: 'RegisterAgent',
      payload: {
        agentId: 'agent-first',
        creatorId: 'participant-7',
        displayName: 'First',
      },
      issuedAt: 90,
    });
    const projection = handleRegisterAgentCommand({
      command: firstCommand,
      projection: initial,
      maxAgentsPerCreator: 1,
      nextSequence: 1,
    }).reduce(applyWorldEvent, initial);

    const rejected = handleRegisterAgentCommand({
      command: createCommandEnvelope({
        id: 'register-agent-second',
        simulationId: 'sim-1',
        actorId: 'agent-second',
        source: 'human',
        type: 'RegisterAgent',
        payload: {
          agentId: 'agent-second',
          creatorId: 'participant-7',
          displayName: 'Second',
        },
        issuedAt: 100,
      }),
      projection,
      maxAgentsPerCreator: 1,
      nextSequence: 2,
    });
    expect(rejected[0]).toMatchObject({
      type: 'AgentRegistrationRejected',
      payload: {
        policyVersion: 'runtime-agent-registration-v3',
        creatorId: 'participant-7',
        reason: 'creator-agent-quota-reached',
      },
    });

    const otherCreator = handleRegisterAgentCommand({
      command: createCommandEnvelope({
        id: 'register-agent-other',
        simulationId: 'sim-1',
        actorId: 'agent-other',
        source: 'human',
        type: 'RegisterAgent',
        payload: {
          agentId: 'agent-other',
          creatorId: 'participant-8',
          displayName: 'Other',
        },
        issuedAt: 100,
      }),
      projection,
      maxAgentsPerCreator: 1,
      nextSequence: 2,
    });
    expect(otherCreator[0]?.type).toBe('AgentRegistered');
  });

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

  test('AgentEat caps satiety recovery by residential tier when configured', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 60, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 2,
          job: 'Cleaner',
          inventory: { Bread: 3 },
        },
      ],
    });

    const events = handleAgentEatCommand({
      command: createCommandEnvelope({
        id: 'command-eat-tier-cap',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 3 },
        issuedAt: 10,
      }),
      projection,
      satietyRecoveryByCommodity: { Bread: 15 },
      maxSatiety: 500,
      residentialPhysiologyCaps,
      nextSequence: 1,
    });

    expect(events[1]?.payload).toMatchObject({
      agentId: 'agent-1',
      next: { energy: 100, satiety: 90, health: 100 },
      reason: 'eat',
    });
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
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previousEducationScore: 10,
      nextEducationScore: 70,
    });
  });

  test('AgentStudy records STM with source event ids for summarized execution events', () => {
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
        id: 'command-study-provenance',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
        issuedAt: 20,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events[2]).toMatchObject({
      type: 'ShortTermMemoryRecorded',
      payload: {
        record: {
          source: {
            commandId: 'command-study-provenance',
            eventIds: ['command-study-provenance:event:0', 'command-study-provenance:event:1'],
          },
        },
      },
    });
  });

  test('AgentStudy consumes configured education investment before increasing education', () => {
    const projection = createWorldProjection({
      moneySupply: 1_000,
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Books: 3 },
        },
      ],
    });

    const events = handleAgentStudyCommand({
      command: createCommandEnvelope({
        id: 'command-study-investment',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 1800, educationRatePerSecond: 0.5 },
        issuedAt: 20,
      }),
      projection,
      educationInvestment: {
        currencyCostPerHour: 20,
        inventoryCostsPerHour: { Books: 2 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'EducationInvestmentPaid',
      'EducationChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      durationSeconds: 1800,
      currencyCost: 10,
      previousBalance: 100,
      nextBalance: 90,
      consumedInventory: { Books: 1 },
    });
    expect(events[3]).toMatchObject({
      payload: {
        record: {
          source: {
            eventIds: [
              'command-study-investment:event:0',
              'command-study-investment:event:1',
              'command-study-investment:event:2',
            ],
          },
        },
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']).toMatchObject({
      balance: 90,
      inventory: { Books: 2 },
      educationScore: 910,
    });
    expect(updated.moneySupply).toBe(990);
  });

  test('AgentStudy rejects unaffordable investment without changing resources or education', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 10,
          balance: 5,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Books: 3 },
        },
      ],
    });

    const events = handleAgentStudyCommand({
      command: createCommandEnvelope({
        id: 'command-study-unaffordable',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 1800, educationRatePerSecond: 0.5 },
        issuedAt: 20,
      }),
      projection,
      educationInvestment: {
        currencyCostPerHour: 20,
        inventoryCostsPerHour: { Books: 2 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentStudy',
      reason: 'balance requires 10, available 5',
    });
    expect(events.reduce(applyWorldEvent, projection).agents['agent-1']).toEqual(
      projection.agents['agent-1'],
    );
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
      'AgentActivityTimeCommitted',
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

  test('AgentSleep caps energy recovery by residential tier when configured', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 90 },
          educationScore: 10,
          balance: 50,
          residentialTier: 2,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSleepCommand({
      command: createCommandEnvelope({
        id: 'command-sleep-tier-cap',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSleep',
        payload: { durationSeconds: 1800 },
        issuedAt: 25,
      }),
      projection,
      energyRecoveryPerSecond: 0.1,
      maxEnergy: 500,
      residentialPhysiologyCaps,
      nextSequence: 1,
    });

    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previous: { energy: 40, satiety: 70, health: 90 },
      next: { energy: 120, satiety: 70, health: 90 },
      reason: 'sleep',
    });
  });

  test('AgentSleep rejects missing residential physiology caps as observable failed actions', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 90 },
          educationScore: 10,
          balance: 50,
          residentialTier: 2,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSleepCommand({
      command: createCommandEnvelope({
        id: 'command-sleep-missing-tier-cap',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSleep',
        payload: { durationSeconds: 1800 },
        issuedAt: 25,
      }),
      projection,
      energyRecoveryPerSecond: 0.1,
      maxEnergy: 500,
      residentialPhysiologyCaps: {
        caps: [{ residentialTier: 1, maxEnergy: 80, maxSatiety: 70, maxHealth: 90 }],
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      payload: {
        agentId: 'agent-1',
        commandType: 'AgentSleep',
        reason: 'missing physiology cap for residential tier 2',
      },
    });
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
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
  });
});

describe('agent see doctor command handling', () => {
  test('AgentSeeDoctor restores health, keeps energy and satiety stable, and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSeeDoctorCommand({
      command: createCommandEnvelope({
        id: 'command-see-doctor',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
        payload: { durationSeconds: 1800 },
        issuedAt: 25,
      }),
      projection,
      healthRecoveryPerSecond: 0.05,
      maxHealth: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'PhysiologyChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previous: { energy: 40, satiety: 70, health: 30 },
      next: { energy: 40, satiety: 70, health: 100 },
      reason: 'see-doctor',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.physiology).toEqual({
      energy: 40,
      satiety: 70,
      health: 100,
    });
    expect(updated.memoryRecords[0]?.status).toBe('succeeded');
  });

  test('AgentSeeDoctor charges medical treatment before restoring health', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
      moneySupply: 1000,
    });

    const events = handleAgentSeeDoctorCommand({
      command: createCommandEnvelope({
        id: 'command-see-doctor-paid',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
        payload: { durationSeconds: 1800 },
        issuedAt: 25,
      }),
      projection,
      healthRecoveryPerSecond: 0.05,
      maxHealth: 100,
      treatmentCost: { currencyCostPerSecond: 0.02 },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'MedicalTreatmentCharged',
      'PhysiologyChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      type: 'MedicalTreatmentCharged',
      payload: {
        agentId: 'agent-1',
        amount: 36,
        previousBalance: 100,
        nextBalance: 64,
        reason: 'medical-treatment',
      },
    });
    expect(events[1]).toMatchObject({
      type: 'PhysiologyChanged',
      payload: {
        previous: { energy: 40, satiety: 70, health: 30 },
        next: { energy: 40, satiety: 70, health: 100 },
        reason: 'see-doctor',
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.balance).toBe(64);
    expect(updated.agents['agent-1']?.physiology.health).toBe(100);
    expect(updated.moneySupply).toBe(964);
  });

  test('AgentSeeDoctor rejects unaffordable medical treatment without restoring health', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
          educationScore: 10,
          balance: 10,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
      moneySupply: 1000,
    });

    const events = handleAgentSeeDoctorCommand({
      command: createCommandEnvelope({
        id: 'command-see-doctor-unaffordable',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
        payload: { durationSeconds: 1800 },
        issuedAt: 25,
      }),
      projection,
      healthRecoveryPerSecond: 0.05,
      maxHealth: 100,
      treatmentCost: { currencyCostPerSecond: 0.02 },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      payload: {
        commandType: 'AgentSeeDoctor',
        reason: 'balance requires 36, available 10',
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.balance).toBe(10);
    expect(updated.agents['agent-1']?.physiology.health).toBe(30);
    expect(updated.moneySupply).toBe(1000);
  });

  test('AgentSeeDoctor caps health recovery by residential tier when configured', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
          educationScore: 10,
          balance: 50,
          residentialTier: 2,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSeeDoctorCommand({
      command: createCommandEnvelope({
        id: 'command-see-doctor-tier-cap',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
        payload: { durationSeconds: 1800 },
        issuedAt: 25,
      }),
      projection,
      healthRecoveryPerSecond: 0.1,
      maxHealth: 500,
      residentialPhysiologyCaps,
      nextSequence: 1,
    });

    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previous: { energy: 40, satiety: 70, health: 30 },
      next: { energy: 40, satiety: 70, health: 110 },
      reason: 'see-doctor',
    });
  });

  test('AgentSeeDoctor rejects invalid payloads without changing physiology', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSeeDoctorCommand({
      command: createCommandEnvelope({
        id: 'command-see-doctor',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
        payload: { durationSeconds: -1 },
        issuedAt: 25,
      }),
      projection,
      healthRecoveryPerSecond: 0.05,
      maxHealth: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentSeeDoctor',
      reason: 'AgentSeeDoctor durationSeconds must be non-negative',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.physiology.health).toBe(30);
  });

  test('AgentSeeDoctor rejects invalid recovery policy as an observable failed action', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentSeeDoctorCommand({
      command: createCommandEnvelope({
        id: 'command-see-doctor',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
        payload: { durationSeconds: 10 },
        issuedAt: 25,
      }),
      projection,
      healthRecoveryPerSecond: -1,
      maxHealth: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentSeeDoctor',
      reason: 'healthRecoveryPerSecond must be non-negative',
    });
  });

  test('dispatchWorldCommand rejects AgentSeeDoctor when policy is missing', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
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
        id: 'command-see-doctor',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
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
      },
      nextSequence: 1,
    });

    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentSeeDoctor',
      reason: 'missing see doctor policy',
    });
  });

  test('dispatchWorldCommand routes AgentSeeDoctor through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
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
        id: 'command-see-doctor',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
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
        seeDoctor: {
          healthRecoveryPerSecond: 1,
          maxHealth: 100,
        },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'PhysiologyChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      next: { energy: 40, satiety: 70, health: 40 },
      reason: 'see-doctor',
    });
  });

  test('dispatchWorldCommand routes AgentSeeDoctor treatment costs through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 40, satiety: 70, health: 30 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
      moneySupply: 1000,
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-see-doctor-paid-dispatch',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentSeeDoctor',
        payload: { durationSeconds: 1800 },
        issuedAt: 25,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
        seeDoctor: {
          healthRecoveryPerSecond: 0.05,
          maxHealth: 100,
          treatmentCost: { currencyCostPerSecond: 0.02 },
        },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'MedicalTreatmentCharged',
      'PhysiologyChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.balance).toBe(64);
    expect(updated.moneySupply).toBe(964);
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
      'AgentActivityTimeCommitted',
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
      'AgentActivityTimeCommitted',
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
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Apple: 2 });
    expect(updated.agents['agent-1']?.physiology.energy).toBe(96);
  });

  test('AgentProduce applies education-driven production efficiency policy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: { Wood: 1 },
        },
      ],
    });

    const events = handleAgentProduceCommand({
      command: createCommandEnvelope({
        id: 'command-produce-efficiently',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 3.2 },
        issuedAt: 50,
      }),
      projection,
      nextSequence: 1,
      productionEfficiency: {
        minEfficiency: 0.5,
        educationScoreForMaxEfficiency: 500,
      },
    });

    expect(events[0]).toMatchObject({
      type: 'CommodityProduced',
      payload: {
        agentId: 'agent-1',
        produced: { Book: 1 },
        consumedInputs: { Wood: 1 },
        energyCost: 64,
        satietyCost: 16,
        laborSeconds: 3.2,
        productionEfficiency: 0.5,
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Book: 1 });
    expect(updated.agents['agent-1']?.physiology).toMatchObject({
      energy: 36,
      satiety: 84,
    });
  });

  test('AgentProduce passes physiology and residential state into full production efficiency policy', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 50, satiety: 100, health: 100 },
          educationScore: 500,
          balance: 0,
          residentialTier: 5,
          job: null,
          inventory: { Wood: 1 },
        },
      ],
    });

    const events = handleAgentProduceCommand({
      command: createCommandEnvelope({
        id: 'command-produce-full-efficiency',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 2 },
        issuedAt: 50,
      }),
      projection,
      nextSequence: 1,
      productionEfficiency: {
        minEfficiency: 0.5,
        educationScoreForMaxEfficiency: 500,
        physiologyCaps: {
          caps: [{ residentialTier: 5, maxEnergy: 100, maxSatiety: 100, maxHealth: 100 }],
        },
        residentialTierForMaxEfficiency: 5,
      },
    });

    expect(events[0]?.type).toBe('CommodityProduced');
    if (events[0]?.type !== 'CommodityProduced') {
      throw new Error('expected first event to be CommodityProduced');
    }
    expect(events[0].payload.productionEfficiency).toBeCloseTo(0.95);
    expect(events[0].payload.energyCost).toBeCloseTo(32 / 0.95);
    expect(events[0].payload.satietyCost).toBeCloseTo(8 / 0.95);
    expect(events[0].payload.laborSeconds).toBeCloseTo(1.6 / 0.95);
  });

  test('AgentProduce applies deterministic special rewards through world command handling', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 25, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 5,
          job: null,
          inventory: { Transistor: 1, 'Circuit Board': 1 },
        },
      ],
    });

    const events = handleAgentProduceCommand({
      command: createCommandEnvelope({
        id: 'command-produce-reward',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Chip', quantity: 1, availableLaborSeconds: 5 },
        issuedAt: 50,
      }),
      projection,
      nextSequence: 1,
      recipeOverrides: [{ output: 'Chip', rewardProbabilityPercent: 100 }],
    });

    expect(events[0]).toMatchObject({
      type: 'CommodityProduced',
      payload: {
        agentId: 'agent-1',
        produced: { Chip: 1, 'Gold Apple': 1 },
        consumedInputs: { Transistor: 1, 'Circuit Board': 1 },
      },
    });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Chip: 1, 'Gold Apple': 1 });
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

  test('AgentProduce rejects incapacitated agents before production planning', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 0 },
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
        id: 'command-produce-incapacitated',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Apple', quantity: 1, availableLaborSeconds: 1 },
        issuedAt: 50,
      }),
      projection,
      criticalThresholds: { energy: 1, health: 1 },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentProduce',
      reason: 'agent is incapacitated',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({});
    expect(updated.agents['agent-1']?.physiology).toEqual({
      energy: 100,
      satiety: 80,
      health: 0,
    });
  });

  test('dispatchWorldCommand routes AgentProduce critical thresholds through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 0 },
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
        id: 'command-produce-dispatch-incapacitated',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Apple', quantity: 1, availableLaborSeconds: 1 },
        issuedAt: 50,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 10,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentProduce',
      reason: 'agent is incapacitated',
    });
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
    expect(events[0]?.type).toBe('TradeExecuted');
    if (events[0]?.type !== 'TradeExecuted') {
      throw new Error('expected first event to be TradeExecuted');
    }
    expect(events[0].payload.effectivePrice).toBeCloseTo(11.1111111111);
    expect(events[0].payload.spotPriceBefore).toBeCloseTo(10);
    expect(events[0].payload.spotPriceAfter).toBeCloseTo(12.3456790123);
    expect(events[0].payload.slippageRatio).toBeCloseTo(0.1111111111);
    expect(events[0].payload.invariantBefore).toBeCloseTo(100000);
    expect(events[0].payload.invariantAfter).toBeCloseTo(100000);

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

  test('canonical trade activity commits exclusive simulation time before recording STM', () => {
    const projection = createWorldProjection({
      clock: { now: 7_000, tickDurationMs: 1_000 },
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
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-timed-trade',
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
        tradeActivity: { durationSeconds: 300 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'TradeExecuted',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[1]).toMatchObject({
      id: 'command-timed-trade:event:1',
      type: 'AgentActivityTimeCommitted',
      payload: {
        activity: 'trade',
        commandType: 'AgentTrade',
        policyVersion: 'exclusive-agent-activity-time-v2',
        startedAt: 7_000,
        durationSeconds: 300,
        availableAt: 307_000,
      },
    });
    expect(events[2]).toMatchObject({ id: 'command-timed-trade:event:2' });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.activityTimeByAgent['agent-1']).toMatchObject({
      activity: 'trade',
      availableAt: 307_000,
    });
  });

  test('AgentTrade sell records effective price, spot movement, slippage, and invariant metadata', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: { Apple: 10 },
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = handleAgentTradeCommand({
      command: createCommandEnvelope({
        id: 'command-trade-sell',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'sell', commodityName: 'Apple', quantity: 10 },
        issuedAt: 60,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual(['TradeExecuted', 'ShortTermMemoryRecorded']);
    expect(events[0]?.type).toBe('TradeExecuted');
    if (events[0]?.type !== 'TradeExecuted') {
      throw new Error('expected first event to be TradeExecuted');
    }
    expect(events[0].payload.currencyQuantity).toBeCloseTo(90.9090909091);
    expect(events[0].payload.effectivePrice).toBeCloseTo(9.0909090909);
    expect(events[0].payload.spotPriceBefore).toBeCloseTo(10);
    expect(events[0].payload.spotPriceAfter).toBeCloseTo(8.2644628099);
    expect(events[0].payload.slippageRatio).toBeCloseTo(-0.0909090909);
    expect(events[0].payload.invariantBefore).toBeCloseTo(100000);
    expect(events[0].payload.invariantAfter).toBeCloseTo(100000);

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({});
    expect(updated.agents['agent-1']?.balance).toBeCloseTo(190.9090909091);
    expect(updated.marketPools['Apple']?.commodityReserve).toBe(110);
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

  test('regional markets disabled by default: trade ignores region and uses global pool', () => {
    const projection = createWorldProjection({
      locations: [
        {
          locationId: asLocationId('downtown-market'),
          name: 'Downtown Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: 10,
          regionId: 'downtown',
        },
        {
          locationId: asLocationId('harbor-market'),
          name: 'Harbor Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: 10,
          regionId: 'harbor',
        },
      ],
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('downtown-market'),
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

    // regionalMarketsEnabled omitted -> legacy behavior, regionId in payload ignored
    const events = handleAgentTradeCommand({
      command: createCommandEnvelope({
        id: 'command-trade-default',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Apple', quantity: 1, regionId: 'harbor' },
        issuedAt: 60,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'TradeExecuted',
      'ShortTermMemoryRecorded',
    ]);
    if (events[0]?.type !== 'TradeExecuted') {
      throw new Error('expected trade to succeed under legacy global pool');
    }
    // regionId must NOT appear on the event when regional markets are off
    expect(events[0].payload.regionId).toBeUndefined();
    const updated = events.reduce(applyWorldEvent, projection);
    // settled against the single global pool keyed by bare commodity
    expect(updated.marketPools['Apple']?.commodityReserve).toBe(99);
  });

  test('regional markets enabled: agent trades against its current region pool', () => {
    const projection = createWorldProjection({
      locations: [
        {
          locationId: asLocationId('downtown-market'),
          name: 'Downtown Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: 10,
          regionId: 'downtown',
        },
        {
          locationId: asLocationId('harbor-market'),
          name: 'Harbor Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: 10,
          regionId: 'harbor',
        },
      ],
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('downtown-market'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      // downtown pool has spot 10 (1000/100), harbor pool has spot 4 (200/50)
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000, regionId: 'downtown' }),
        createAmmPool({ commodity: 'Apple', commodityReserve: 50, currencyReserve: 200, regionId: 'harbor' }),
      ],
      moneySupply: 1200,
    });

    const events = handleAgentTradeCommand({
      command: createCommandEnvelope({
        id: 'command-trade-regional',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        // no explicit regionId -> resolves to agent's current region (downtown)
        payload: { side: 'buy', commodityName: 'Apple', quantity: 1 },
        issuedAt: 60,
      }),
      projection,
      regionalMarketsEnabled: true,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'TradeExecuted',
      'ShortTermMemoryRecorded',
    ]);
    if (events[0]?.type !== 'TradeExecuted') {
      throw new Error('expected regional trade to succeed');
    }
    expect(events[0].payload.regionId).toBe('downtown');
    // settled against downtown pool (spot ~10), not harbor pool (spot 4)
    expect(events[0].payload.spotPriceBefore).toBeCloseTo(10);
    const updated = events.reduce(applyWorldEvent, projection);
    // downtown composite-key pool mutated, harbor pool untouched
    expect(updated.marketPools['downtown::Apple']?.commodityReserve).toBe(99);
    expect(updated.marketPools['harbor::Apple']?.commodityReserve).toBe(50);
  });

  test('regional markets enabled: co-location gate rejects cross-region trade', () => {
    const projection = createWorldProjection({
      locations: [
        {
          locationId: asLocationId('downtown-market'),
          name: 'Downtown Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: 10,
          regionId: 'downtown',
        },
        {
          locationId: asLocationId('harbor-market'),
          name: 'Harbor Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: 10,
          regionId: 'harbor',
        },
      ],
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('downtown-market'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 50, currencyReserve: 200, regionId: 'harbor' }),
      ],
      moneySupply: 200,
    });

    // agent is in downtown but explicitly requests the (cheaper) harbor pool
    const events = handleAgentTradeCommand({
      command: createCommandEnvelope({
        id: 'command-trade-cross-region',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Apple', quantity: 1, regionId: 'harbor' },
        issuedAt: 60,
      }),
      projection,
      regionalMarketsEnabled: true,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({ commandType: 'AgentTrade' });
    if (events[0]?.type !== 'ActionRejected') {
      throw new Error('expected ActionRejected for cross-region trade');
    }
    expect(String(events[0].payload.reason)).toContain('trade-requires-regional-co-location');
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
      {
        applicationId: 'command-apply:application',
        cycleNumber: 0,
        agentId: 'agent-1',
        occupationName: 'Cleaner',
        residentialTier: 1,
        educationScore: 0,
        submittedAt: 70,
        status: 'accepted',
        resolvedAt: 70,
        resolutionReason: 'legacy-immediate-assignment',
      },
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
      reason: 'residential-tier-too-low: residentialTier requires 5, available 1',
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
          applicationId: 'existing-application',
          cycleNumber: 0,
          agentId: asAgentId('agent-1'),
          occupationName: 'Cleaner',
          residentialTier: 1,
          educationScore: 0,
          submittedAt: 60,
          status: 'pending',
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

  test('AgentApplyJob consumes job-tier prerequisite commodities before assignment', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 20,
          balance: 0,
          residentialTier: 2,
          job: null,
          inventory: { Beef: 1 },
        },
      ],
    });

    const events = handleAgentApplyJobCommand({
      command: createCommandEnvelope({
        id: 'command-apply',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentApplyJob',
        payload: { occupationName: 'Stock Clerk' },
        issuedAt: 70,
      }),
      projection,
      populationEducationScores: [0, 10, 20],
      quotaByResidentialTier: [1, 1],
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'InventoryChanged',
      'JobApplicationSubmitted',
      'JobAssigned',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toEqual({
      agentId: 'agent-1',
      itemName: 'Beef',
      delta: -1,
      reason: 'job-application-prerequisite',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']).toMatchObject({
      job: 'Stock Clerk',
      inventory: {},
    });
  });

  test('AgentApplyJob rejects missing job-tier prerequisite commodities without assigning job', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 20,
          balance: 0,
          residentialTier: 2,
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
        payload: { occupationName: 'Stock Clerk' },
        issuedAt: 70,
      }),
      projection,
      populationEducationScores: [0, 10, 20],
      quotaByResidentialTier: [1, 1],
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      commandType: 'AgentApplyJob',
      reason: 'missing-prerequisite: Beef requires 1, available 0',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']).toMatchObject({
      job: null,
      inventory: {},
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

describe('agent residential tier upgrade command handling', () => {
  const upgradePolicy = {
    maxResidentialTier: 4,
    costs: [
      {
        targetResidentialTier: 2,
        currencyCost: 100,
        inventoryCosts: { Wood: 2 },
        minEducationScore: 20,
      },
    ],
  };

  test('AgentUpgradeResidentialTier consumes policy costs, upgrades tier, and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 25,
          balance: 150,
          residentialTier: 1,
          job: null,
          inventory: { Wood: 3 },
        },
      ],
    });

    const events = handleAgentUpgradeResidentialTierCommand({
      command: createCommandEnvelope({
        id: 'command-upgrade-residential',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentUpgradeResidentialTier',
        payload: { targetResidentialTier: 2 },
        issuedAt: 75,
      }),
      projection,
      policy: upgradePolicy,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ResidentialTierUpgraded',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toEqual({
      agentId: 'agent-1',
      previousResidentialTier: 1,
      nextResidentialTier: 2,
      currencyCost: 100,
      consumedInventory: { Wood: 2 },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']).toMatchObject({
      balance: 50,
      residentialTier: 2,
      inventory: { Wood: 1 },
    });
    expect(updated.memoryRecords[0]).toMatchObject({
      status: 'succeeded',
      tags: ['upgrade-residential-tier', '2'],
    });
  });

  test('AgentUpgradeResidentialTier rejects unpaid policy costs without mutating projection', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 25,
          balance: 150,
          residentialTier: 1,
          job: null,
          inventory: { Wood: 1 },
        },
      ],
    });

    const events = handleAgentUpgradeResidentialTierCommand({
      command: createCommandEnvelope({
        id: 'command-upgrade-residential',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentUpgradeResidentialTier',
        payload: { targetResidentialTier: 2 },
        issuedAt: 75,
      }),
      projection,
      policy: upgradePolicy,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      commandType: 'AgentUpgradeResidentialTier',
      reason: 'insufficient-inventory: Wood requires 2, available 1',
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']).toMatchObject({
      balance: 150,
      residentialTier: 1,
      inventory: { Wood: 1 },
    });
  });

  test('dispatchWorldCommand routes AgentUpgradeResidentialTier through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 25,
          balance: 150,
          residentialTier: 1,
          job: null,
          inventory: { Wood: 3 },
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-upgrade-residential',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentUpgradeResidentialTier',
        payload: { targetResidentialTier: 2 },
        issuedAt: 75,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
        residentialTierUpgrade: upgradePolicy,
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ResidentialTierUpgraded',
      'ShortTermMemoryRecorded',
    ]);
  });
});

describe('agent movement command handling', () => {
  test('AgentMoveTo follows the shortest route and commits congestion-adjusted travel time', () => {
    const projection = createWorldProjection({
      clock: { now: 10_000, tickDurationMs: 1_000 },
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('home'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('work'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('home'),
          name: 'Home',
          kind: 'residence',
          activityAffinities: ['sleep'],
          capacity: 10,
          connections: [
            { targetLocationId: asLocationId('square'), travelDurationSeconds: 100 },
            { targetLocationId: asLocationId('work'), travelDurationSeconds: 400 },
          ],
        },
        {
          locationId: asLocationId('square'),
          name: 'Square',
          kind: 'social',
          activityAffinities: ['socialize'],
          capacity: 10,
          connections: [
            { targetLocationId: asLocationId('home'), travelDurationSeconds: 100 },
            { targetLocationId: asLocationId('work'), travelDurationSeconds: 100 },
          ],
        },
        {
          locationId: asLocationId('work'),
          name: 'Work',
          kind: 'production',
          activityAffinities: ['work'],
          capacity: 2,
          connections: [
            { targetLocationId: asLocationId('home'), travelDurationSeconds: 400 },
            { targetLocationId: asLocationId('square'), travelDurationSeconds: 100 },
          ],
        },
      ],
    });

    const events = handleAgentMoveToCommand({
      command: createCommandEnvelope({
        id: 'command-route',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentMoveTo',
        payload: { targetLocationId: 'work', reason: 'shift' },
        issuedAt: 10_000,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'AgentTravelStarted',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      routeLocationIds: ['home', 'square', 'work'],
      baseTravelDurationSeconds: 200,
      congestionMultiplier: 1.25,
      travelDurationSeconds: 250,
      spatialPolicyVersion: 'town-spatial-graph-v1',
    });
    expect(events[1]?.payload).toMatchObject({
      activity: 'travel',
      commandType: 'AgentMoveTo',
      durationSeconds: 250,
      availableAt: 260_000,
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.locationId).toBe(asLocationId('home'));
    expect(updated.transitByAgent?.['agent-1']).toMatchObject({
      fromLocationId: 'home',
      toLocationId: 'work',
      arrivesAt: 260_000,
    });
    expect(updated.activityTimeByAgent['agent-1']).toMatchObject({
      activity: 'travel',
      availableAt: 260_000,
      settlementTiming: 'effects-at-completion',
    });

    const arrivalEvents = handleAdvanceSimulationTimeCommand({
      command: createCommandEnvelope({
        id: 'command-route-arrival',
        simulationId: 'sim-1',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 250_000 },
        issuedAt: 10_000,
      }),
      projection: updated,
      nextSequence: 4,
    });
    expect(arrivalEvents.map((event) => event.type)).toEqual([
      'SimulationTimeAdvanced',
      'AgentLocationChanged',
    ]);
    const arrived = arrivalEvents.reduce(applyWorldEvent, updated);
    expect(arrived.agents['agent-1']?.locationId).toBe(asLocationId('work'));
    expect(arrived.transitByAgent?.['agent-1']).toBeUndefined();
  });

  test('AgentMoveTo rejects full or unreachable destinations', () => {
    const createProjection = (connected: boolean) =>
      createWorldProjection({
        agents: [
          {
            agentId: asAgentId('agent-1'),
            locationId: asLocationId('home'),
            physiology: { energy: 100, satiety: 80, health: 100 },
            educationScore: 0,
            balance: 0,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
          {
            agentId: asAgentId('agent-2'),
            locationId: asLocationId('target'),
            physiology: { energy: 100, satiety: 80, health: 100 },
            educationScore: 0,
            balance: 0,
            residentialTier: 1,
            job: null,
            inventory: {},
          },
        ],
        locations: [
          {
            locationId: asLocationId('home'),
            name: 'Home',
            kind: 'residence',
            activityAffinities: ['sleep'],
            capacity: 10,
            connections: connected
              ? [{ targetLocationId: asLocationId('target'), travelDurationSeconds: 60 }]
              : [],
          },
          {
            locationId: asLocationId('target'),
            name: 'Target',
            kind: 'social',
            activityAffinities: ['socialize'],
            capacity: connected ? 1 : 2,
            connections: connected
              ? [{ targetLocationId: asLocationId('home'), travelDurationSeconds: 60 }]
              : [],
          },
        ],
      });
    const move = (projection: ReturnType<typeof createProjection>) =>
      handleAgentMoveToCommand({
        command: createCommandEnvelope({
          id: 'command-constrained-move',
          simulationId: 'sim-1',
          actorId: 'agent-1',
          type: 'AgentMoveTo',
          payload: { targetLocationId: 'target' },
          issuedAt: 80,
        }),
        projection,
        nextSequence: 1,
      });

    expect(move(createProjection(true))[0]?.payload).toMatchObject({
      reason: 'target location target is at capacity 1',
    });
    expect(move(createProjection(false))[0]?.payload).toMatchObject({
      reason: 'no route from home to target',
    });
  });

  test('AgentMoveTo updates agent location and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('residential-block'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('residential-block'),
          name: 'Residential Block',
          kind: 'residence',
          activityAffinities: ['sleep', 'socialize'],
          capacity: null,
        },
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = handleAgentMoveToCommand({
      command: createCommandEnvelope({
        id: 'command-move',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentMoveTo',
        payload: { targetLocationId: 'school', reason: 'study' },
        issuedAt: 80,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'AgentLocationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previousLocationId: 'residential-block',
      nextLocationId: 'school',
      reason: 'study',
    });
    expect(events[1]).toMatchObject({
      type: 'ShortTermMemoryRecorded',
      payload: {
        record: {
          summary: 'Moved to School.',
          status: 'succeeded',
          tags: ['move', 'school', 'education'],
        },
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.locationId).toBe(asLocationId('school'));
  });

  test('AgentMoveTo rejects unknown target locations', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('residential-block'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('residential-block'),
          name: 'Residential Block',
          kind: 'residence',
          activityAffinities: ['sleep', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = handleAgentMoveToCommand({
      command: createCommandEnvelope({
        id: 'command-move',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentMoveTo',
        payload: { targetLocationId: 'missing-location' },
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
      commandType: 'AgentMoveTo',
      reason: 'unknown target location missing-location',
    });
  });

  test('dispatchWorldCommand routes AgentMoveTo through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('market'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('market'),
          name: 'Market',
          kind: 'market',
          activityAffinities: ['trade', 'socialize'],
          capacity: null,
        },
        {
          locationId: asLocationId('restaurant'),
          name: 'Restaurant',
          kind: 'food',
          activityAffinities: ['eat', 'socialize', 'trade'],
          capacity: null,
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-move',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentMoveTo',
        payload: { targetLocationId: 'restaurant', reason: 'eat' },
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
      'AgentLocationChanged',
      'ShortTermMemoryRecorded',
    ]);
  });
});

describe('agent location observation command handling', () => {
  test('AgentObserveLocation records co-located agents and location affordances in events and STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-3'),
          locationId: asLocationId('market'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
        {
          locationId: asLocationId('market'),
          name: 'Market',
          kind: 'market',
          activityAffinities: ['trade', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = handleAgentObserveLocationCommand({
      command: createCommandEnvelope({
        id: 'command-observe',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentObserveLocation',
        payload: { focus: 'classmates' },
        issuedAt: 80,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'LocationObserved',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      locationId: 'school',
      locationName: 'School',
      observedAgentIds: ['agent-2'],
      activityAffinities: ['study', 'socialize'],
      focus: 'classmates',
    });
    expect(events[1]).toMatchObject({
      type: 'ShortTermMemoryRecorded',
      payload: {
        record: {
          kind: 'observation',
          status: 'observed',
          summary: 'Observed School with agent-2 nearby. Focus: classmates.',
          tags: ['observe', 'school', 'education', 'study', 'socialize', 'agent-2'],
        },
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.locationObservations).toEqual([
      {
        agentId: 'agent-1',
        locationId: 'school',
        locationName: 'School',
        observedAgentIds: ['agent-2'],
        activityAffinities: ['study', 'socialize'],
        focus: 'classmates',
        observedAt: 80,
      },
    ]);
    expect(updated.memoryRecords[0]?.kind).toBe('observation');
  });

  test('AgentObserveLocation rejects agents without known locations', () => {
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

    const events = handleAgentObserveLocationCommand({
      command: createCommandEnvelope({
        id: 'command-observe',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentObserveLocation',
        payload: {},
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
      commandType: 'AgentObserveLocation',
      reason: 'agent location is unknown',
    });
  });

  test('dispatchWorldCommand routes AgentObserveLocation through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('market'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('market'),
          name: 'Market',
          kind: 'market',
          activityAffinities: ['trade', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-observe',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentObserveLocation',
        payload: {},
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
      'LocationObserved',
      'ShortTermMemoryRecorded',
    ]);
  });
});

describe('agent conversation command handling', () => {
  test('AgentStartConversation records transcript, bidirectional social impact, and participant STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 20,
          balance: 50,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('school'),
          physiology: { energy: 90, satiety: 70, health: 100 },
          educationScore: 30,
          balance: 80,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = handleAgentStartConversationCommand({
      command: createCommandEnvelope({
        id: 'command-conversation',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStartConversation',
        payload: {
          targetAgentId: 'agent-2',
          topic: 'homework',
          relationDelta: 0.2,
          attitudeDelta: 0.1,
          turns: [
            {
              speakerAgentId: 'agent-1',
              utterance: 'Do you want to study together?',
              intent: 'invite-study',
            },
            {
              speakerAgentId: 'agent-2',
              utterance: 'Yes, let us review after class.',
              intent: 'share-information',
            },
          ],
        },
        issuedAt: 90,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ConversationRecorded',
      'SocialInteractionCompleted',
      'SocialInteractionCompleted',
      'ShortTermMemoryRecorded',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      type: 'ConversationRecorded',
      payload: {
        conversationId: 'conversation-command-conversation',
        initiatorAgentId: 'agent-1',
        participantAgentIds: ['agent-1', 'agent-2'],
        locationId: 'school',
        topic: 'homework',
        turns: [
          {
            turnIndex: 0,
            speakerAgentId: 'agent-1',
            utterance: 'Do you want to study together?',
            intent: 'invite-study',
          },
          {
            turnIndex: 1,
            speakerAgentId: 'agent-2',
            utterance: 'Yes, let us review after class.',
            intent: 'share-information',
          },
        ],
      },
    });
    expect(events[1]).toMatchObject({
      type: 'SocialInteractionCompleted',
      payload: {
        sourceAgentId: 'agent-1',
        targetAgentId: 'agent-2',
        summary:
          'Conversation about homework: Do you want to study together? / Yes, let us review after class.',
        relationDelta: 0,
        attitudeDelta: 0,
        outcomePolicyVersion: 'conversation-outcome-v1',
        outcomeSignals: [],
        nextRelation: {
          relationScore: 0,
          attitudeScore: 0,
          relationLabel: 'acquaintance',
          interactionCount: 1,
        },
      },
    });
    expect(events[2]).toMatchObject({
      type: 'SocialInteractionCompleted',
      payload: {
        sourceAgentId: 'agent-2',
        targetAgentId: 'agent-1',
        relationDelta: 0.06,
        attitudeDelta: 0.06,
        outcomePolicyVersion: 'conversation-outcome-v1',
        outcomeSignals: ['cooperation'],
      },
    });
    expect(events[3]).toMatchObject({
      payload: {
        record: {
          agentId: 'agent-1',
          kind: 'social-interaction',
          status: 'succeeded',
          source: {
            eventIds: [
              'command-conversation:event:0',
              'command-conversation:event:1',
              'command-conversation:event:2',
            ],
          },
          tags: ['conversation', 'homework', 'agent-2', 'school'],
          consolidationHint: {
            relationDelta: 0,
            attitudeDelta: 0,
            outcomePolicyVersion: 'conversation-outcome-v1',
            outcomeSignals: [],
            knowledgeClaims: [
              {
                sourceAgentId: 'agent-2',
                topic: 'homework',
                statement: 'Yes, let us review after class.',
                status: 'asserted',
              },
            ],
          },
        },
      },
    });
    expect(events[4]).toMatchObject({
      payload: {
        record: {
          agentId: 'agent-2',
          kind: 'social-interaction',
          status: 'succeeded',
          source: {
            eventIds: [
              'command-conversation:event:0',
              'command-conversation:event:1',
              'command-conversation:event:2',
            ],
          },
          tags: ['conversation', 'homework', 'agent-1', 'school', 'cooperation'],
          consolidationHint: {
            relationDelta: 0.06,
            attitudeDelta: 0.06,
            outcomePolicyVersion: 'conversation-outcome-v1',
            outcomeSignals: ['cooperation'],
            knowledgeClaims: [],
          },
        },
      },
    });

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.conversationRecords).toHaveLength(1);
    expect(updated.conversationRecords[0]).toMatchObject({
      conversationId: 'conversation-command-conversation',
      participantAgentIds: ['agent-1', 'agent-2'],
      locationId: 'school',
      topic: 'homework',
      recordedAt: 90,
    });
    expect(updated.socialRelations['agent-1->agent-2']).toMatchObject({
      relationScore: 0,
      attitudeScore: 0,
      interactionCount: 1,
    });
    expect(updated.socialRelations['agent-2->agent-1']).toMatchObject({
      relationScore: 0.06,
      attitudeScore: 0.06,
      interactionCount: 1,
    });
    expect(updated.memoryRecords.map((record) => record.agentId)).toEqual(['agent-1', 'agent-2']);
  });

  test('credits follow-through only when the transcript history contains an open commitment', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const locationId = asLocationId('town-square');
    const initial = createWorldProjection({
      agents: [
        {
          agentId: agent1,
          locationId,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: agent2,
          locationId,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId,
          name: 'Town Square',
          kind: 'social',
          activityAffinities: ['socialize'],
          capacity: null,
        },
      ],
    });
    const ungroundedEvents = handleAgentStartConversationCommand({
      command: createCommandEnvelope({
        id: 'command-unverified-follow-through',
        simulationId: 'sim-1',
        actorId: agent1,
        type: 'AgentStartConversation',
        payload: {
          targetAgentId: agent2,
          topic: 'market errand',
          relationDelta: 1,
          attitudeDelta: 1,
          turns: [
            {
              speakerAgentId: agent1,
              utterance: 'I followed through on the errand.',
              intent: 'fulfill-commitment',
            },
            { speakerAgentId: agent2, utterance: 'I heard you.' },
          ],
        },
        issuedAt: 1,
      }),
      projection: initial,
      nextSequence: 1,
    });
    expect(ungroundedEvents[2]).toMatchObject({
      payload: { relationDelta: 0, attitudeDelta: 0, outcomeSignals: [] },
    });

    const promiseEvents = handleAgentStartConversationCommand({
      command: createCommandEnvelope({
        id: 'command-make-commitment',
        simulationId: 'sim-1',
        actorId: agent1,
        type: 'AgentStartConversation',
        payload: {
          targetAgentId: agent2,
          topic: 'market errand',
          relationDelta: 1,
          attitudeDelta: 1,
          turns: [
            {
              speakerAgentId: agent1,
              utterance: 'I promise to bring the market prices tomorrow.',
              intent: 'make-commitment',
            },
            { speakerAgentId: agent2, utterance: 'I will wait for the report.' },
          ],
        },
        issuedAt: 2,
      }),
      projection: initial,
      nextSequence: 10,
    });
    const afterPromise = promiseEvents.reduce(applyWorldEvent, initial);
    expect(afterPromise.socialCommitments).toEqual({
      'conversation-command-make-commitment:0': {
        commitmentId: 'conversation-command-make-commitment:0',
        promisorAgentId: agent1,
        beneficiaryAgentId: agent2,
        topic: 'market errand',
        statement: 'I promise to bring the market prices tomorrow.',
        status: 'open',
        createdAt: 2,
      },
    });
    const fulfilledEvents = handleAgentStartConversationCommand({
      command: createCommandEnvelope({
        id: 'command-verified-follow-through',
        simulationId: 'sim-1',
        actorId: agent1,
        type: 'AgentStartConversation',
        payload: {
          targetAgentId: agent2,
          topic: 'market errand',
          relationDelta: 0,
          attitudeDelta: 0,
          turns: [
            {
              speakerAgentId: agent1,
              utterance: 'I returned with the promised market prices.',
              intent: 'fulfill-commitment',
            },
            { speakerAgentId: agent2, utterance: 'Thank you for following through.' },
          ],
        },
        issuedAt: 3,
      }),
      projection: afterPromise,
      nextSequence: 20,
    });
    expect(fulfilledEvents[2]).toMatchObject({
      payload: {
        sourceAgentId: agent2,
        targetAgentId: agent1,
        relationDelta: 0.12,
        attitudeDelta: 0.1,
        outcomeSignals: ['fulfilled-commitment'],
      },
    });
    const afterFulfillment = fulfilledEvents.reduce(applyWorldEvent, afterPromise);
    expect(
      afterFulfillment.socialCommitments['conversation-command-make-commitment:0'],
    ).toMatchObject({
      status: 'fulfilled',
      resolvedAt: 3,
      resolutionConversationId: 'conversation-command-verified-follow-through',
    });
  });

  test('AgentStartConversation rejects turns spoken by non-participants', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 20,
          balance: 50,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('school'),
          physiology: { energy: 90, satiety: 70, health: 100 },
          educationScore: 30,
          balance: 80,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = handleAgentStartConversationCommand({
      command: createCommandEnvelope({
        id: 'command-conversation',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStartConversation',
        payload: {
          targetAgentId: 'agent-2',
          topic: 'homework',
          relationDelta: 0.2,
          attitudeDelta: 0.1,
          turns: [
            {
              speakerAgentId: 'agent-3',
              utterance: 'I should not be in this transcript.',
            },
          ],
        },
        issuedAt: 90,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      payload: {
        commandType: 'AgentStartConversation',
        reason: 'conversation turn speaker agent-3 is not a participant',
      },
    });
  });

  test('dispatchWorldCommand routes AgentStartConversation through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 20,
          balance: 50,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('school'),
          physiology: { energy: 90, satiety: 70, health: 100 },
          educationScore: 30,
          balance: 80,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-conversation',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStartConversation',
        payload: {
          targetAgentId: 'agent-2',
          topic: 'homework',
          relationDelta: 0.2,
          attitudeDelta: 0.1,
          turns: [
            {
              speakerAgentId: 'agent-1',
              utterance: 'Do you want to study together?',
            },
            {
              speakerAgentId: 'agent-2',
              utterance: 'Yes.',
            },
          ],
        },
        issuedAt: 90,
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
      'ConversationRecorded',
      'SocialInteractionCompleted',
      'SocialInteractionCompleted',
      'ShortTermMemoryRecorded',
      'ShortTermMemoryRecorded',
    ]);
  });
});

describe('peer resource transfer command handling', () => {
  test('atomically transfers inventory and grounds recipient trust in the replayed transfer', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const locationId = asLocationId('town-square');
    const projection = createWorldProjection({
      agents: [
        {
          agentId: agent1,
          locationId,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: { Apple: 5 },
        },
        {
          agentId: agent2,
          locationId,
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId,
          name: 'Town Square',
          kind: 'social',
          activityAffinities: ['socialize'],
          capacity: null,
        },
      ],
    });
    const events = handleAgentGiveResourceCommand({
      command: createCommandEnvelope({
        id: 'command-give-resource',
        simulationId: 'sim-1',
        actorId: agent1,
        type: 'AgentGiveResource',
        payload: {
          targetAgentId: agent2,
          commodityName: 'Apple',
          quantity: 3,
          note: 'For dinner.',
        },
        issuedAt: 10,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ResourceTransferred',
      'SocialInteractionCompleted',
      'ShortTermMemoryRecorded',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[1]).toMatchObject({
      payload: {
        sourceAgentId: agent2,
        targetAgentId: agent1,
        relationDelta: 0.07,
        attitudeDelta: 0.09,
        outcomePolicyVersion: 'resource-transfer-social-outcome-v1',
        outcomeSignals: ['resource-help-received'],
      },
    });
    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents[agent1]?.inventory).toEqual({ Apple: 2 });
    expect(updated.agents[agent2]?.inventory).toEqual({ Apple: 3 });
    expect(updated.socialRelations['agent-2->agent-1']).toMatchObject({
      relationScore: 0.07,
      attitudeScore: 0.09,
    });
    expect(updated.socialRelations['agent-1->agent-2']).toBeUndefined();
    expect(updated.memoryRecords.map((record) => record.agentId)).toEqual([agent1, agent2]);
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

  test('AgentSocialize rejects known agents that are not co-located', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          locationId: asLocationId('school'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
        {
          agentId: asAgentId('agent-2'),
          locationId: asLocationId('market'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      locations: [
        {
          locationId: asLocationId('school'),
          name: 'School',
          kind: 'education',
          activityAffinities: ['study', 'socialize'],
          capacity: null,
        },
        {
          locationId: asLocationId('market'),
          name: 'Market',
          kind: 'market',
          activityAffinities: ['trade', 'socialize'],
          capacity: null,
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
          summary: 'Tried to talk across town.',
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
      reason: 'target agent agent-2 is at market, not co-located with agent-1 at school',
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

describe('exclusive agent activity time allocation', () => {
  test('blocks all competing actions until the committed simulation-time boundary', () => {
    const policies = {
      satietyRecoveryByCommodity: { Bread: 15 },
      maxSatiety: 100,
      wageCalculator: () => 300,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
      criticalThresholds: { energy: 1, health: 1 },
      sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
      seeDoctor: { healthRecoveryPerSecond: 1, maxHealth: 100 },
    } as const;
    let projection = createWorldProjection({
      clock: { now: 1_000, tickDurationMs: 1_000 },
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 80, satiety: 80, health: 80 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 1 },
        },
        {
          agentId: asAgentId('agent-2'),
          physiology: { energy: 80, satiety: 80, health: 80 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 1 },
        },
      ],
    });

    const studyEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-commit-study-time',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 2, educationRatePerSecond: 1 },
        issuedAt: 10,
      }),
      projection,
      policies,
      nextSequence: 1,
    });
    projection = studyEvents.reduce(applyWorldEvent, projection);

    expect(projection.activityTimeByAgent['agent-1']).toMatchObject({
      activity: 'education',
      commandType: 'AgentStudy',
      policyVersion: 'exclusive-agent-activity-time-v2',
      settlementTiming: 'effects-at-commit',
      startedAt: 1_000,
      durationSeconds: 2,
      availableAt: 3_000,
      committedAt: 10,
    });

    const competingCommands: readonly {
      readonly id: string;
      readonly type: CoreCommandType;
      readonly payload: unknown;
    }[] = [
      {
        id: 'command-busy-work',
        type: 'AgentWork' as const,
        payload: { occupationName: 'Cleaner', laborSeconds: 1 },
      },
      {
        id: 'command-busy-produce',
        type: 'AgentProduce' as const,
        payload: { commodityName: 'Apple', quantity: 1, availableLaborSeconds: 1 },
      },
      {
        id: 'command-busy-eat',
        type: 'AgentEat' as const,
        payload: { commodityName: 'Bread', quantity: 1 },
      },
      {
        id: 'command-busy-sleep',
        type: 'AgentSleep' as const,
        payload: { durationSeconds: 1 },
      },
      {
        id: 'command-busy-doctor',
        type: 'AgentSeeDoctor' as const,
        payload: { durationSeconds: 1 },
      },
    ];
    for (const command of competingCommands) {
      const events = dispatchWorldCommand({
        command: createCommandEnvelope({
          ...command,
          simulationId: 'sim-1',
          actorId: 'agent-1',
          issuedAt: 11,
        }),
        projection,
        policies,
        nextSequence: 10,
      });
      expect(events[0]).toMatchObject({
        type: 'ActionRejected',
        payload: {
          commandType: command.type,
          reason: 'agent is busy with education until simulation time 3000 (now 1000)',
        },
      });
    }

    const otherAgentEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-other-agent-eat',
        simulationId: 'sim-1',
        actorId: 'agent-2',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 11,
      }),
      projection,
      policies,
      nextSequence: 20,
    });
    expect(otherAgentEvents[0]?.type).toBe('InventoryChanged');

    const advanceEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-reach-activity-boundary',
        simulationId: 'sim-1',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 2_000 },
        issuedAt: 12,
      }),
      projection,
      policies,
      nextSequence: 30,
    });
    projection = advanceEvents.reduce(applyWorldEvent, projection);
    expect(projection.clock.now).toBe(3_000);

    const workEvents = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-work-at-boundary',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentWork',
        payload: { occupationName: 'Cleaner', laborSeconds: 1 },
        issuedAt: 13,
      }),
      projection,
      policies,
      nextSequence: 40,
    });
    expect(workEvents.map((event) => event.type)).toEqual([
      'WagePaid',
      'PhysiologyChanged',
      'AgentActivityTimeCommitted',
      'ShortTermMemoryRecorded',
    ]);
  });
});
