import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperAgentTrajectoryArtifactRepository,
  createPaperAgentTrajectoryArtifact,
  createPaperAgentTrajectoryPolicyManifest,
  type PaperAgentTrajectoryArtifactInput,
} from './paperAgentTrajectories';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('paper agent trajectory analysis', () => {
  test('links early educational guidance to longitudinal investment, mobility, and wealth evidence without causal overclaim', () => {
    const artifact = createPaperAgentTrajectoryArtifact(createInput());

    expect(artifact.schemaVersion).toBe('paper-agent-trajectory-analysis-v1');
    expect(artifact.earlyWindow).toEqual({
      startedAt: 0,
      endedAtExclusive: 25,
      fraction: 0.25,
    });
    expect(artifact.cohorts.earlyEducationGuided).toMatchObject({
      agentCount: 2,
      educationInvestorCount: 2,
      educationInvestmentRate: 1,
      upwardOccupationMobilityRate: 1,
      highStatusOccupationRate: 1,
      medianFinalNetWorth: 1_500,
    });
    expect(artifact.cohorts.notEarlyEducationGuided).toMatchObject({
      agentCount: 2,
      educationInvestorCount: 0,
      educationInvestmentRate: 0,
      upwardOccupationMobilityRate: 0.5,
      highStatusOccupationRate: 0,
      medianFinalNetWorth: 275,
    });
    expect(artifact.descriptiveAssociations).toEqual({
      educationInvestmentRateDifference: 1,
      medianEducationScoreDeltaDifference: 145,
      medianFinalNetWorthDifference: 1_225,
      medianNetWorthDeltaDifference: 1_225,
      upwardOccupationMobilityRateDifference: 0.5,
      highStatusOccupationRateDifference: 1,
      interpretation: 'observational-correlation-only',
      causalClaimPermitted: false,
    });

    const firstGuided = artifact.trajectories.find((row) => row.agentId === 'guided-1');
    expect(firstGuided).toMatchObject({
      guidedEarly: true,
      earlyEducationGuidanceTraceIds: ['trace-guided-1'],
      education: {
        investmentCount: 1,
        investmentCountAfterEarlyGuidance: 1,
        totalCurrencyCost: 20,
        scoreDelta: 100,
        sourceEventIds: ['paid-guided-1', 'education-guided-1'],
      },
      mobility: {
        upwardOccupationMobility: true,
        highStatusOccupation: true,
        occupationTransitionEventIds: ['job-guided-1'],
        residentialTransitionEventIds: ['home-guided-1'],
      },
    });
    expect(
      artifact.trajectories.find((row) => row.agentId === 'unguided-1'),
    ).toMatchObject({ guidedEarly: false, laterEducationGuidanceCount: 1 });
    expect(artifact.report.markdown).toContain('Observational correlation only');
    expect(artifact.report.markdown).toContain('not causal treatment effects');
    expect(artifact.run).toMatchObject({
      runManifestId: 'resolved-run-manifest:sha256:test',
      sourceRevision: { commit: '0123456789abcdef', dirty: true },
      seed: 'trajectory-seed',
    });
  });

  test('uses an exclusive early-window cutoff and only human educational objectives as the planning-horizon proxy', () => {
    const input = createInput();
    const artifact = createPaperAgentTrajectoryArtifact({
      ...input,
      guidance: [
        createGuidance({
          traceId: 'early-human',
          commandId: 'early-human-command',
          objectiveId: 'early-human-objective',
          agentId: 'guided-1',
          source: 'human',
          issuedAt: 24.999,
          statement: 'Study for a later career.',
          affinityTags: [],
        }),
        createGuidance({
          traceId: 'cutoff-human',
          commandId: 'cutoff-human-command',
          objectiveId: 'cutoff-human-objective',
          agentId: 'unguided-1',
          source: 'human',
          issuedAt: 25,
          statement: 'Unrelated goal.',
          affinityTags: ['education'],
        }),
        createGuidance({
          traceId: 'early-agent',
          commandId: 'early-agent-command',
          objectiveId: 'early-agent-objective',
          agentId: 'unguided-2',
          source: 'agent',
          issuedAt: 1,
          statement: 'Study now.',
          affinityTags: ['study'],
        }),
      ],
    });

    expect(artifact.trajectories.find((row) => row.agentId === 'guided-1')).toMatchObject({
      guidedEarly: true,
    });
    expect(artifact.trajectories.find((row) => row.agentId === 'unguided-1')).toMatchObject({
      guidedEarly: false,
      laterEducationGuidanceCount: 1,
    });
    expect(artifact.trajectories.find((row) => row.agentId === 'unguided-2')).toMatchObject({
      guidedEarly: false,
      laterEducationGuidanceCount: 0,
    });
    expect(createPaperAgentTrajectoryPolicyManifest()).toMatchObject({
      earlyWindowFraction: 0.25,
      earlyWindowBoundary: 'experiment-start-inclusive-cutoff-exclusive',
      highStatusMinimumOccupationTier: 5,
      causalInterpretation: 'observational-correlation-only',
      causalClaimPermitted: false,
      controlledExperimentRequirement: 'required-for-causal-claims',
    });
  });

  test('rejects incomplete cohort and provenance contracts instead of manufacturing an association', () => {
    const input = createInput();
    expect(() =>
      createPaperAgentTrajectoryArtifact({
        ...input,
        finalSnapshot: input.finalSnapshot.slice(1),
      }),
    ).toThrow('initialSnapshot and finalSnapshot must contain the same agent IDs');

    expect(() =>
      createPaperAgentTrajectoryArtifact({
        ...input,
        guidance: input.initialSnapshot.map((snapshot, index) =>
          createGuidance({
            traceId: `all-guided-${index}`,
            commandId: `all-guided-command-${index}`,
            objectiveId: `all-guided-objective-${index}`,
            agentId: snapshot.agentId,
            source: 'human',
            issuedAt: 1,
            statement: 'Study now.',
            affinityTags: ['education'],
          }),
        ),
      }),
    ).toThrow('requires both early-education-guided and unguided cohorts');

    expect(() =>
      createPaperAgentTrajectoryArtifact({
        ...input,
        educationInvestments: [
          {
            ...input.educationInvestments[0]!,
            eventIds: ['only-one-event'],
          },
        ],
      }),
    ).toThrow('requires payment and education-change event IDs');
  });

  test('persists immutable JSON and Markdown artifacts and verifies them after restart', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-agent-trajectories-'));
    roots.push(rootDir);
    const artifact = createPaperAgentTrajectoryArtifact(createInput());
    const repository = new FilePaperAgentTrajectoryArtifactRepository({ rootDir });

    await expect(repository.save(artifact)).resolves.toEqual(artifact);
    const restarted = new FilePaperAgentTrajectoryArtifactRepository({ rootDir });
    await expect(restarted.get(artifact.run.runId)).resolves.toEqual(artifact);
    await expect(restarted.save(artifact)).resolves.toEqual(artifact);
    await expect(
      restarted.save({
        ...artifact,
        limitations: [...artifact.limitations, 'changed'],
      }),
    ).rejects.toThrow('is immutable');
  });
});

function createInput(): PaperAgentTrajectoryArtifactInput {
  return {
    run: {
      runId: 'trajectory-run',
      simulationId: 'simulation-1',
      runManifestId: 'resolved-run-manifest:sha256:test',
      sourceRevision: { commit: '0123456789abcdef', dirty: true },
      seed: 'trajectory-seed',
      experimentStartedAt: 0,
      experimentEndedAt: 100,
      generatedAt: 101,
    },
    initialSnapshot: [
      snapshot('guided-1', 0, 100, 1, undefined, 0, 0),
      snapshot('guided-2', 10, 200, 1, 'Cleaner', 1, 0),
      snapshot('unguided-1', 0, 100, 1, undefined, 0, 0),
      snapshot('unguided-2', 20, 200, 1, 'Cleaner', 1, 0),
    ],
    finalSnapshot: [
      snapshot('guided-1', 100, 1_000, 3, 'Doctor', 5, 100),
      snapshot('guided-2', 200, 2_000, 4, 'CEO', 6, 100),
      snapshot('unguided-1', 0, 300, 1, 'Cleaner', 1, 100),
      snapshot('unguided-2', 20, 250, 1, 'Cleaner', 1, 100),
    ],
    guidance: [
      createGuidance({
        traceId: 'trace-guided-1',
        commandId: 'guidance-command-1',
        objectiveId: 'education-objective-1',
        agentId: 'guided-1',
        source: 'human',
        issuedAt: 10,
        statement: 'Study until education exceeds 100.',
        affinityTags: ['study', 'education'],
      }),
      createGuidance({
        traceId: 'trace-guided-2',
        commandId: 'guidance-command-2',
        objectiveId: 'education-objective-2',
        agentId: 'guided-2',
        source: 'human',
        issuedAt: 20,
        statement: 'Learn before working.',
        affinityTags: [],
      }),
      createGuidance({
        traceId: 'trace-late-unguided-1',
        commandId: 'guidance-command-3',
        objectiveId: 'education-objective-3',
        agentId: 'unguided-1',
        source: 'human',
        issuedAt: 80,
        statement: 'Study later.',
        affinityTags: ['education'],
      }),
    ],
    educationInvestments: [
      {
        agentId: 'guided-1',
        commandId: 'study-guided-1',
        eventIds: ['paid-guided-1', 'education-guided-1'],
        occurredAt: 30,
        durationSeconds: 3_600,
        currencyCost: 20,
        previousEducationScore: 0,
        nextEducationScore: 100,
      },
      {
        agentId: 'guided-2',
        commandId: 'study-guided-2',
        eventIds: ['paid-guided-2', 'education-guided-2'],
        occurredAt: 40,
        durationSeconds: 3_600,
        currencyCost: 20,
        previousEducationScore: 10,
        nextEducationScore: 200,
      },
    ],
    occupationTransitions: [
      occupationTransition('guided-1', undefined, 0, 'Doctor', 5, 70),
      occupationTransition('guided-2', 'Cleaner', 1, 'CEO', 6, 75),
      occupationTransition('unguided-1', undefined, 0, 'Cleaner', 1, 10),
    ],
    residentialTransitions: [
      {
        agentId: 'guided-1',
        eventId: 'home-guided-1',
        occurredAt: 60,
        previousResidentialTier: 1,
        nextResidentialTier: 3,
      },
      {
        agentId: 'guided-2',
        eventId: 'home-guided-2',
        occurredAt: 65,
        previousResidentialTier: 1,
        nextResidentialTier: 4,
      },
    ],
  };
}

function snapshot(
  agentId: string,
  educationScore: number,
  netWorth: number,
  residentialTier: number,
  occupationId: string | undefined,
  occupationTier: number,
  observedAt: number,
) {
  return {
    agentId,
    observedAt,
    educationScore,
    netWorth,
    residentialTier,
    ...(occupationId === undefined ? {} : { occupationId }),
    occupationTier,
  };
}

function createGuidance(
  input: Omit<
    PaperAgentTrajectoryArtifactInput['guidance'][number],
    'planId'
  >,
) {
  return { ...input, planId: input.objectiveId };
}

function occupationTransition(
  agentId: string,
  previousOccupationId: string | undefined,
  previousOccupationTier: number,
  nextOccupationId: string,
  nextOccupationTier: number,
  occurredAt: number,
) {
  return {
    agentId,
    eventId: `job-${agentId}`,
    occurredAt,
    ...(previousOccupationId === undefined ? {} : { previousOccupationId }),
    previousOccupationTier,
    nextOccupationId,
    nextOccupationTier,
  };
}
