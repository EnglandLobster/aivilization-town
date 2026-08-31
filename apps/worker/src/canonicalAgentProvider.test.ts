import {
  compileStrategicObjectiveToBranchPlan,
  createBranchPlanProgress,
  markSubtaskCompleted,
} from '@aivilization/agent-runtime';
import type { LongHorizonObjective } from '@aivilization/memory';
import {
  asAgentId,
  createEventEnvelope,
  type PartitionKey,
  type SimulationId,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  createWorldProjection,
  type AgentActivityTimeCommittedPayload,
  type WorldAgentState,
} from '@aivilization/world';
import { afterAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAivilizationWorldCommandPoliciesSnapshot,
  createCanonicalLocalRuntimeAgentProvider,
  createLocalWorldRuntimeStorage,
  type LocalSimulationSocietyDirectory,
} from './index';

const roots: string[] = [];
const agentId = asAgentId('career-progression-agent');

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('canonical local runtime agent provider', () => {
  test('finalizes a completed production plan before renewing into a higher-tier occupation', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRoot(),
      simulationId: 'sim-career-progression',
      partitionKey: 'world-main',
    });
    const objective = createProductionObjective();
    await storage.intentionRepository.setObjective(agentId, objective);
    await storage.planRepository.save({
      planId: objective.id,
      agentId,
      plan: compileStrategicObjectiveToBranchPlan({ objective, issuedAt: 100 }),
      createdAt: 100,
      updatedAt: 100,
    });
    await storage.planProgressRepository.save(
      markSubtaskCompleted(
        createBranchPlanProgress({ planId: objective.id, agentId, createdAt: 100 }),
        { subtaskId: 'produce-target', completedAt: 200 },
      ),
    );

    const baseProjection = createWorldProjection({
      clock: { now: 1_000, tickDurationMs: 1_000 },
      agents: [createCareerReadyAgent()],
    });
    const busyProjection = applyWorldEvent(
      baseProjection,
      createEventEnvelope({
        id: 'event-production-time',
        simulationId: 'sim-career-progression',
        commandId: 'command-produce-beef',
        type: 'AgentActivityTimeCommitted',
        payload: {
          agentId,
          activity: 'production',
          commandType: 'AgentProduce',
          policyVersion: 'exclusive-agent-activity-time-v2',
          settlementTiming: 'effects-at-completion',
          startedAt: 1_000,
          durationSeconds: 2,
          availableAt: 3_000,
        } satisfies AgentActivityTimeCommittedPayload,
        occurredAt: 200,
        sequence: 1,
      }),
    );
    const policies = createAivilizationWorldCommandPoliciesSnapshot(
      [400],
      'career-progression-test',
    );
    const provider = createCanonicalLocalRuntimeAgentProvider({ policies });

    await expect(
      provider({
        storage,
        simulationId: storage.partition.simulationId,
        issuedAt: 300,
        projection: busyProjection,
      }),
    ).resolves.toEqual([]);
    await expect(storage.intentionRepository.getOrCreate(agentId)).resolves.toMatchObject({
      activeObjective: { id: objective.id },
      completedObjectives: [],
    });
    await expect(
      storage.planProgressRepository.get({ planId: objective.id, agentId }),
    ).resolves.toMatchObject({ completedSubtaskIds: ['produce-target'] });

    const availableProjection = applyWorldEvent(
      busyProjection,
      createEventEnvelope({
        id: 'event-production-time-advanced',
        simulationId: 'sim-career-progression',
        commandId: 'command-time-advanced',
        type: 'SimulationTimeAdvanced',
        payload: {
          previous: { now: 1_000, tickDurationMs: 1_000 },
          next: { now: 3_000, tickDurationMs: 1_000 },
          deltaMs: 2_000,
        },
        occurredAt: 400,
        sequence: 2,
      }),
    );
    const agents = await provider({
      storage,
      simulationId: storage.partition.simulationId,
      issuedAt: 400,
      projection: availableProjection,
      societyDirectory: createSocietyDirectory(
        storage.partition.simulationId,
        storage.partition.partitionKey,
      ),
    });

    const intentionState = await storage.intentionRepository.getOrCreate(agentId);
    expect(intentionState.completedObjectives).toMatchObject([
      { objective, completedAt: 400, reason: 'plan-completed', planId: objective.id },
    ]);
    expect(intentionState.activeObjective?.statement).toMatch(/^Apply for .+ to advance/);
    expect(intentionState.activeObjective?.affinityTags).toContain('job');
    expect(agents).toHaveLength(1);
    expect(agents[0]?.worldDecisionContext?.society).toMatchObject({
      directoryId: 'canonical-provider-directory',
      agents: [{ agentId, ownerPartitionKey: storage.partition.partitionKey }],
    });
    const refreshed = await agents[0]?.refresh?.({
      projection: {
        ...availableProjection,
        agents: {
          ...availableProjection.agents,
          [agentId]: { ...availableProjection.agents[agentId]!, balance: 999 },
        },
      },
    });
    expect(refreshed?.worldDecisionContext?.agent.balance).toBe(999);
    expect(refreshed?.observedStateSummary).toContain('balance=999');
    const renewalTraces = await storage.objectiveRenewalTraceRepository.query({
      simulationId: 'sim-career-progression',
      partitionKey: 'world-main',
      agentId,
    });
    expect(renewalTraces).toHaveLength(1);
    expect(renewalTraces[0]?.selectedCandidateId).toMatch(/^occupation-application:/);
  });

  test('supersedes pre-recruitment production with employment income after a job assignment', async () => {
    const storage = createLocalWorldRuntimeStorage({
      rootDir: createRoot(),
      simulationId: 'sim-employment-feedback',
      partitionKey: 'world-main',
    });
    const objective = createProductionObjective();
    await storage.intentionRepository.setObjective(agentId, objective);
    await storage.planRepository.save({
      planId: objective.id,
      agentId,
      plan: compileStrategicObjectiveToBranchPlan({ objective, issuedAt: 100 }),
      strategicContext: {
        policyVersion: 'strategic-plan-renewal-v3',
        capturedAt: 100,
        physiologyRegimes: ['stable'],
        job: null,
        residentialTier: 2,
        eligibleOccupationNames: [],
        educationInvestmentRegime: 'affordable',
        strategicProfileEntryVersions: [],
        overallPriceIndex: null,
      },
      createdAt: 100,
      updatedAt: 100,
    });
    const hiredAgent = { ...createCareerReadyAgent(), job: 'Cleaner', balance: 0 };
    const projection = createWorldProjection({
      clock: { now: 10_000, tickDurationMs: 1_000 },
      agents: [hiredAgent],
    });
    const provider = createCanonicalLocalRuntimeAgentProvider({
      policies: createAivilizationWorldCommandPoliciesSnapshot([400], 'employment-feedback-test'),
    });

    const agents = await provider({
      storage,
      simulationId: storage.partition.simulationId,
      issuedAt: 500,
      projection,
    });

    const intentionState = await storage.intentionRepository.getOrCreate(agentId);
    expect(intentionState.completedObjectives).toMatchObject([
      {
        objective,
        completedAt: 500,
        reason: 'superseded-by-major-context-shift',
        planId: objective.id,
      },
    ]);
    expect(intentionState.activeObjective).toMatchObject({
      statement: "Apply for Receptionist to advance through the town's occupation ladder.",
      planningDomains: ['work'],
    });
    expect(agents).toHaveLength(1);
    const renewalTraces = await storage.objectiveRenewalTraceRepository.query({
      simulationId: 'sim-employment-feedback',
      partitionKey: 'world-main',
      agentId,
    });
    expect(renewalTraces.at(-1)?.selectedCandidateId).toBe('occupation-application:Receptionist');

    const applicationObjective = intentionState.activeObjective!;
    await storage.planProgressRepository.save(
      markSubtaskCompleted(
        createBranchPlanProgress({
          planId: applicationObjective.id,
          agentId,
          createdAt: 500,
        }),
        { subtaskId: 'apply-for-work', completedAt: 550 },
      ),
    );
    const projectionWithPendingApplication = createWorldProjection({
      clock: { now: 11_000, tickDurationMs: 1_000 },
      agents: [hiredAgent],
      jobApplications: [
        {
          applicationId: 'pending-receptionist-application',
          cycleNumber: 1,
          agentId,
          occupationName: 'Receptionist',
          residentialTier: 2,
          educationScore: 400,
          submittedAt: 10_500,
          status: 'pending',
        },
      ],
    });
    await provider({
      storage,
      simulationId: storage.partition.simulationId,
      issuedAt: 600,
      projection: projectionWithPendingApplication,
    });
    const incomeState = await storage.intentionRepository.getOrCreate(agentId);
    expect(incomeState.activeObjective).toMatchObject({
      statement: 'Work as Cleaner to fund the next education and residential milestone.',
      planningDomains: ['work'],
    });
    const finalRenewalTraces = await storage.objectiveRenewalTraceRepository.query({
      simulationId: 'sim-employment-feedback',
      partitionKey: 'world-main',
      agentId,
    });
    expect(
      finalRenewalTraces.some((trace) => trace.selectedCandidateId === 'employment-income:Cleaner'),
    ).toBe(true);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-canonical-agent-provider-'));
  roots.push(root);
  return root;
}

function createProductionObjective(): LongHorizonObjective {
  return {
    id: 'produce-beef-objective',
    agentId,
    statement: "Produce Beef to supply the town's tier 2 progression economy.",
    priority: 2,
    source: 'agent',
    affinityTags: ['production', 'produce', 'Beef'],
    planningDomains: ['production'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createCareerReadyAgent(): WorldAgentState {
  return {
    agentId,
    locationId: null,
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: 400,
    balance: 200,
    residentialTier: 2,
    job: null,
    inventory: { Beef: 1 },
  };
}

function createSocietyDirectory(
  simulationId: SimulationId,
  partitionKey: PartitionKey,
): LocalSimulationSocietyDirectory {
  return {
    schemaVersion: 'local-simulation-society-directory-v1',
    directoryId: 'canonical-provider-directory',
    manifestId: 'canonical-provider-manifest',
    simulationId,
    partitionBoundaries: [
      { partitionKey, lastAppliedSequence: 0, snapshotSequence: 0, simulationTime: 3_000 },
    ],
    agents: [
      {
        agentId,
        ownerPartitionKey: partitionKey,
        ownerLastAppliedSequence: 0,
        publicState: {
          locationId: null,
          job: null,
          residentialTier: 2,
          educationScore: 400,
        },
      },
    ],
  };
}
