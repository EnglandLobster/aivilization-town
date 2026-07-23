import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentStateInput,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createEducationInvestmentObservations,
  createGuidanceObservations,
  createWorkerPaperAgentTrajectoryArtifact,
} from './paperAgentTrajectoryAnalysis';
import type { PaperAgentTrajectoryRun, SteeringTrace } from '@aivilization/observability';

describe('worker paper agent trajectory analysis', () => {
  test('maps canonical steering traces, world events, and boundary projections into a paper artifact', () => {
    const run = createRun();
    const events = createEvents();
    const artifact = createWorkerPaperAgentTrajectoryArtifact({
      run,
      initialProjection: createProjection(0, [
        agent('guided', 0, 100, 1, null),
        agent('unguided', 0, 100, 1, null),
      ]),
      finalProjection: createProjection(100, [
        agent('guided', 100, 1_000, 2, 'Doctor'),
        agent('unguided', 0, 200, 1, 'Cleaner'),
      ]),
      events,
      steeringTraces: [
        steeringTrace({
          traceId: 'trace-guided',
          commandId: 'guidance-guided',
          agentId: 'guided',
          issuedAt: 10,
          statement: 'Do not work yet; study until education exceeds 100.',
          affinityTags: ['study', 'education'],
        }),
        steeringTrace({
          traceId: 'trace-unguided-late',
          commandId: 'guidance-unguided-late',
          agentId: 'unguided',
          issuedAt: 50,
          statement: 'Study after establishing a career.',
          affinityTags: ['education'],
        }),
      ],
      occupationTiers: [
        { occupationId: 'Cleaner', occupationTier: 1 },
        { occupationId: 'Doctor', occupationTier: 5 },
      ],
    });

    expect(artifact.sourceRecordCounts).toEqual({
      agentCount: 2,
      guidanceCount: 2,
      educationInvestmentCount: 1,
      occupationTransitionCount: 2,
      residentialTransitionCount: 1,
    });
    expect(artifact.trajectories.find((row) => row.agentId === 'guided')).toMatchObject({
      guidedEarly: true,
      earlyEducationGuidanceTraceIds: ['trace-guided'],
      education: {
        investmentCount: 1,
        sourceEventIds: ['event-paid', 'event-education'],
      },
      mobility: {
        upwardOccupationMobility: true,
        highStatusOccupation: true,
        occupationTransitionEventIds: ['event-job-guided'],
        residentialTransitionEventIds: ['event-home-guided'],
      },
      wealth: { initialNetWorth: 100, finalNetWorth: 1_000, netWorthDelta: 900 },
    });
    expect(artifact.trajectories.find((row) => row.agentId === 'unguided')).toMatchObject({
      guidedEarly: false,
      laterEducationGuidanceCount: 1,
      mobility: { highStatusOccupation: false },
    });
  });

  test('requires objective content in long-horizon traces instead of guessing from trace IDs', () => {
    const { objectiveStatement: omitted, ...legacyTrace } = steeringTrace({
      traceId: 'legacy-trace',
      commandId: 'legacy-command',
      agentId: 'guided',
      issuedAt: 10,
      statement: 'Study.',
      affinityTags: ['study'],
    });
    expect(omitted).toBe('Study.');
    expect(() =>
      createGuidanceObservations([legacyTrace], createRun()),
    ).toThrow('lacks objective content required for trajectory analysis');
  });

  test('requires paired payment and education-change event provenance', () => {
    expect(() =>
      createEducationInvestmentObservations([
        createEventEnvelope({
          id: 'unmatched-payment',
          simulationId: 'simulation-1',
          commandId: 'study-unmatched',
          type: 'EducationInvestmentPaid',
          payload: {
            agentId: 'guided',
            durationSeconds: 3_600,
            currencyCost: 20,
            previousBalance: 100,
            nextBalance: 80,
            consumedInventory: {},
            reason: 'study',
          },
          occurredAt: 20,
          sequence: 1,
        }) as WorldEvent,
      ]),
    ).toThrow('lacks EducationChanged outcome evidence');
  });
});

function createRun(): PaperAgentTrajectoryRun {
  return {
    runId: 'trajectory-run',
    simulationId: 'simulation-1',
    runManifestId: 'resolved-run-manifest:sha256:test',
    sourceRevision: { commit: '0123456789abcdef', dirty: false },
    seed: 'trajectory-seed',
    experimentStartedAt: 0,
    experimentEndedAt: 100,
    generatedAt: 101,
  };
}

function createProjection(
  now: number,
  agents: Parameters<typeof createWorldProjection>[0]['agents'],
): WorldProjection {
  return createWorldProjection({
    clock: { now, tickDurationMs: 1_000 },
    agents,
  });
}

function agent(
  agentId: string,
  educationScore: number,
  balance: number,
  residentialTier: number,
  job: string | null,
): WorldAgentStateInput {
  return {
    agentId: asAgentId(agentId),
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore,
    balance,
    residentialTier,
    job,
    inventory: {},
  };
}

function steeringTrace(input: {
  readonly traceId: string;
  readonly commandId: string;
  readonly agentId: string;
  readonly issuedAt: number;
  readonly statement: string;
  readonly affinityTags: readonly string[];
}): SteeringTrace {
  return {
    traceId: input.traceId,
    simulationId: 'simulation-1',
    partitionKey: 'world-main',
    commandId: input.commandId,
    commandType: 'SetLongHorizonObjective',
    source: 'human',
    agentId: input.agentId,
    resultKind: 'long-horizon-objective-set',
    objectiveId: `${input.commandId}:objective`,
    objectiveStatement: input.statement,
    objectiveAffinityTags: [...input.affinityTags],
    planId: `${input.commandId}:objective`,
    candidateActionCount: 0,
    commandDraftCount: 0,
    shortTermMemoryRecordIds: [`${input.commandId}:memory`],
    issuedAt: input.issuedAt,
    recordedAt: input.issuedAt,
  };
}

function createEvents(): WorldEvent[] {
  return [
    createEventEnvelope({
      id: 'event-paid',
      simulationId: 'simulation-1',
      commandId: 'study-guided',
      type: 'EducationInvestmentPaid',
      payload: {
        agentId: 'guided',
        durationSeconds: 3_600,
        currencyCost: 20,
        previousBalance: 100,
        nextBalance: 80,
        consumedInventory: {},
        reason: 'study',
      },
      occurredAt: 30,
      sequence: 1,
    }) as WorldEvent,
    createEventEnvelope({
      id: 'event-education',
      simulationId: 'simulation-1',
      commandId: 'study-guided',
      type: 'EducationChanged',
      payload: {
        agentId: 'guided',
        previousEducationScore: 0,
        nextEducationScore: 100,
        reason: 'study',
      },
      occurredAt: 30,
      sequence: 2,
    }) as WorldEvent,
    createEventEnvelope({
      id: 'event-home-guided',
      simulationId: 'simulation-1',
      commandId: 'home-guided',
      type: 'ResidentialTierUpgraded',
      payload: {
        agentId: 'guided',
        previousResidentialTier: 1,
        nextResidentialTier: 2,
        currencyCost: 200,
        consumedInventory: {},
      },
      occurredAt: 50,
      sequence: 3,
    }) as WorldEvent,
    createEventEnvelope({
      id: 'event-job-guided',
      simulationId: 'simulation-1',
      commandId: 'job-guided',
      type: 'JobAssigned',
      payload: {
        agentId: 'guided',
        occupationName: 'Doctor',
        previousJob: null,
      },
      occurredAt: 70,
      sequence: 4,
    }) as WorldEvent,
    createEventEnvelope({
      id: 'event-job-unguided',
      simulationId: 'simulation-1',
      commandId: 'job-unguided',
      type: 'JobAssigned',
      payload: {
        agentId: 'unguided',
        occupationName: 'Cleaner',
        previousJob: null,
      },
      occurredAt: 20,
      sequence: 5,
    }) as WorldEvent,
  ];
}
