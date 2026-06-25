import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileAgentCycleTraceRepository,
  InMemoryAgentCycleTraceRepository,
  createAgentCycleTrace,
  type AgentCycleTrace,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-agent-cycle-traces-'));
  tmpRoots.push(root);
  return root;
}

function createWorldDecisionContextTrace(agentId: string) {
  return {
    agentId,
    hasPhysiology: true,
    hasBalance: true,
    hasEducationScore: true,
    hasResidentialTier: true,
    inventoryItemCount: 2,
    marketSpotPriceCount: 1,
    hasLatestPriceIndex: true,
  };
}

const shortTermMemoryContext = { recordCount: 1 };
const longTermProfileContext = { entryCount: 2 };

function createTrace(input: {
  readonly traceId: string;
  readonly simulationId?: string;
  readonly agentId?: string;
  readonly cycleStartedAt?: number;
  readonly replanMaterialization?: boolean;
  readonly contextualPrioritization?: boolean;
  readonly actionSequenceGeneration?: boolean;
  readonly socialDialogueGeneration?: boolean;
  readonly globalSynthesis?: boolean;
  readonly actionRepair?: boolean;
  readonly replanningDecisionTrace?: boolean;
}): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: input.traceId,
    simulationId: input.simulationId ?? 'sim-1',
    agentId: input.agentId ?? 'agent-1',
    cycleStartedAt: input.cycleStartedAt ?? 100,
    observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
    selectedBranch: 'development',
    ...(input.contextualPrioritization === true
      ? {
          contextualPrioritization: {
            status: 'accepted',
            source: 'llm',
            requestId: `${input.traceId}:prioritize`,
            providerId: 'scripted-prioritizer',
            model: 'prioritizer-model',
            choices: [
              {
                branchId: 'development',
                subtaskId: 'study',
                priorityScore: 9,
                rationale: 'Study matches the long-term profile and current objective.',
              },
            ],
            attempts: [
              {
                attemptIndex: 1,
                status: 'succeeded',
                providerId: 'scripted-prioritizer',
                model: 'prioritizer-model',
                message: 'LLM structured response validated',
                usage: {
                  inputTokens: 10,
                  outputTokens: 5,
                  totalTokens: 15,
                  estimatedCostMicros: 25,
                },
              },
            ],
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              estimatedCostMicros: 25,
            },
            shortTermMemoryContext,
            longTermProfileContext,
            worldDecisionContext: createWorldDecisionContextTrace(input.agentId ?? 'agent-1'),
          },
        }
      : {}),
    ...(input.actionSequenceGeneration === true
      ? {
          actionSequenceGeneration: [
            {
              status: 'accepted',
              source: 'llm',
              selectedSubtask: {
                branchId: 'development',
                subtaskId: 'study',
              },
              requestId: `${input.traceId}:sequence:study`,
              providerId: 'scripted-action-sequence',
              model: 'sequence-model',
              actions: [
                {
                  id: `${input.traceId}:study-1`,
                  commandType: 'AgentStudy',
                  rationale: 'Study action matches the selected development subtask.',
                },
              ],
              attempts: [
                {
                  attemptIndex: 1,
                  status: 'succeeded',
                  providerId: 'scripted-action-sequence',
                  model: 'sequence-model',
                  message: 'LLM structured response validated',
                  usage: {
                    inputTokens: 20,
                    outputTokens: 8,
                    totalTokens: 28,
                    estimatedCostMicros: 44,
                  },
                },
              ],
              usage: {
                inputTokens: 20,
                outputTokens: 8,
                totalTokens: 28,
                estimatedCostMicros: 44,
              },
              shortTermMemoryContext,
              longTermProfileContext,
              worldDecisionContext: createWorldDecisionContextTrace(input.agentId ?? 'agent-1'),
            },
          ],
        }
      : {}),
    ...(input.socialDialogueGeneration === true
      ? {
          socialDialogueGeneration: [
            {
              status: 'accepted',
              source: 'llm',
              selectedSubtask: {
                branchId: 'social',
                subtaskId: 'check-in',
              },
              actionId: `${input.traceId}:social-1`,
              targetAgentId: 'agent-2',
              requestId: `${input.traceId}:social-dialogue`,
              providerId: 'scripted-social-dialogue',
              model: 'dialogue-model',
              turnCount: 2,
              rationale: 'Use current market context to coordinate with a neighbor.',
              attempts: [
                {
                  attemptIndex: 1,
                  status: 'succeeded',
                  providerId: 'scripted-social-dialogue',
                  model: 'dialogue-model',
                  message: 'LLM structured response validated',
                  usage: {
                    inputTokens: 18,
                    outputTokens: 9,
                    totalTokens: 27,
                    estimatedCostMicros: 45,
                  },
                },
              ],
              usage: {
                inputTokens: 18,
                outputTokens: 9,
                totalTokens: 27,
                estimatedCostMicros: 45,
              },
              shortTermMemoryContext,
              longTermProfileContext,
              worldDecisionContext: createWorldDecisionContextTrace(input.agentId ?? 'agent-1'),
            },
          ],
        }
      : {}),
    ...(input.globalSynthesis === true
      ? {
          globalSynthesis: {
            status: 'accepted',
            source: 'llm',
            requestId: `${input.traceId}:global-synthesis`,
            providerId: 'scripted-global-synthesis',
            model: 'global-synthesis-model',
            choices: [
              {
                actionId: `${input.traceId}:sleep-1`,
                priorityScore: 9,
                strategicAlignment: 4,
                branchUrgency: 8,
                rationale: 'Restore energy before the study action.',
              },
              {
                actionId: `${input.traceId}:study-1`,
                priorityScore: 6,
                strategicAlignment: 7,
                branchUrgency: 3,
                rationale: 'Study remains aligned after recovery.',
              },
            ],
            attempts: [
              {
                attemptIndex: 1,
                status: 'succeeded',
                providerId: 'scripted-global-synthesis',
                model: 'global-synthesis-model',
                message: 'LLM structured response validated',
                usage: {
                  inputTokens: 30,
                  outputTokens: 12,
                  totalTokens: 42,
                  estimatedCostMicros: 66,
                },
              },
            ],
            usage: {
              inputTokens: 30,
              outputTokens: 12,
              totalTokens: 42,
              estimatedCostMicros: 66,
            },
            shortTermMemoryContext,
            longTermProfileContext,
            worldDecisionContext: createWorldDecisionContextTrace(input.agentId ?? 'agent-1'),
          },
        }
      : {}),
    ...(input.actionRepair === true
      ? {
          actionRepair: [
            {
              actionId: `${input.traceId}:study-1`,
              rejectionReason: 'energy too low',
              selectedSubtask: {
                branchId: 'development',
                subtaskId: 'study',
              },
              localRepair: {
                status: 'rejected',
                attemptedAction: {
                  id: `${input.traceId}:study-shorter`,
                  description: 'study for less time',
                  commandType: 'AgentStudy',
                },
                rejectionReason: 'energy still too low',
              },
              reactiveCorrection: {
                status: 'accepted',
                source: 'llm',
                requestId: `${input.traceId}:reactive-correction`,
                providerId: 'scripted-reactive-corrector',
                model: 'repair-model',
                decision: {
                  kind: 'propose-action',
                  rationale: 'Sleep before studying based on recent failures.',
                  evidenceRecordIds: [`${input.traceId}:memory-energy`],
                  action: {
                    id: `${input.traceId}:sleep-1`,
                    description: 'sleep before studying',
                    commandType: 'AgentSleep',
                  },
                },
                simulatorResult: { status: 'accepted' },
                shortTermMemoryContext,
                longTermProfileContext,
                worldDecisionContext: createWorldDecisionContextTrace(input.agentId ?? 'agent-1'),
              },
              outcome: 'repaired',
            },
          ],
      }
      : {}),
    ...(input.replanningDecisionTrace === true
      ? {
          replanningDecisionTrace: {
            status: 'accepted',
            source: 'llm',
            requestId: `${input.traceId}:replanning-decision`,
            providerId: 'scripted-replanning',
            model: 'replanning-model',
            decision: {
              kind: 'memory-guided-correction',
              trigger: 'simulator-rejection',
              reason: 'Use memory evidence before full replan.',
              failedActionIds: [`${input.traceId}:work-hungry`],
              evidenceRecordIds: [`${input.traceId}:memory-work-hungry`],
            },
            attempts: [
              {
                attemptIndex: 1,
                status: 'succeeded',
                providerId: 'scripted-replanning',
                model: 'replanning-model',
                message: 'LLM structured response validated',
                usage: {
                  inputTokens: 16,
                  outputTokens: 7,
                  totalTokens: 23,
                  estimatedCostMicros: 37,
                },
              },
            ],
            usage: {
              inputTokens: 16,
              outputTokens: 7,
              totalTokens: 23,
              estimatedCostMicros: 37,
            },
            shortTermMemoryContext,
            longTermProfileContext,
            worldDecisionContext: {
              ...createWorldDecisionContextTrace(input.agentId ?? 'agent-1'),
              inventoryItemCount: 1,
              marketSpotPriceCount: 1,
              hasLatestPriceIndex: false,
            },
          },
        }
      : {}),
    subtaskCandidates: [
      {
        branchId: 'development',
        subtaskId: 'study',
        description: 'self study',
        score: 5,
        scoreBreakdown: {
          basePriorityScore: 5,
          signalInfluenceScore: 0,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 0,
          profileInfluenceScore: 0,
        },
      },
    ],
    actionSynthesis: {
      acceptedActions: [
        {
          id: `${input.traceId}:study-1`,
          description: 'study for one minute',
          commandType: 'AgentStudy',
          priority: 2,
          synthesisContext: {
            branchId: 'development',
            subtaskId: 'study',
            subtaskScore: 5,
          },
          resourceEstimate: {
            actionSeconds: 60,
            inventoryCosts: { Book: 1 },
          },
        },
      ],
      rejectedActions: [
        {
          action: {
            id: `${input.traceId}:sleep-1`,
            description: 'sleep instead',
            commandType: 'AgentSleep',
            priority: 1,
            synthesisContext: {
              branchId: 'recovery',
              subtaskId: 'sleep',
              branchUrgency: 2,
            },
            resourceEstimate: { actionSeconds: 60 },
          },
          reason: 'maxActions exhausted',
        },
      ],
    },
    candidateActions: ['study for one minute'],
    simulatorResult: { status: 'accepted' },
    simulatorEvents: [
      {
        actionId: `${input.traceId}:study-1`,
        attempt: 'original',
        status: 'accepted',
        events: [
          {
            type: 'EducationChanged',
            sequence: 10,
            summary: 'education increased',
            counterfactualStep: 1,
            projectionEventCountBefore: 0,
            projectionEventCountAfter: 2,
          },
          {
            type: 'ShortTermMemoryRecorded',
            sequence: 11,
            summary: 'Studied for one minute.',
            counterfactualStep: 1,
            projectionEventCountBefore: 0,
            projectionEventCountAfter: 2,
          },
        ],
      },
    ],
    selectionEvidence: {
      selectedSubtaskId: 'study',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
      memoryEvidenceRecordIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    },
    replanningDecision: { kind: 'none' },
    ...(input.replanMaterialization === true
      ? {
          replanMaterialization: {
            status: 'replanned',
            objectiveId: 'objective-study',
            planId: 'objective-study',
            progressReset: true,
            trigger: 'repeated-failure',
            failedActionIds: [`${input.traceId}:study-1`],
            evidenceRecordIds: [`${input.traceId}:memory-energy`],
            matchingFailureCount: 2,
          },
        }
      : {}),
    subtaskReplanningDecisions: [
      {
        branchId: 'development',
        subtaskId: 'study',
        decision: { kind: 'none' },
      },
      {
        branchId: 'recovery',
        subtaskId: 'sleep',
        decision: {
          kind: 'memory-guided-correction',
          trigger: 'simulator-rejection',
          reason: 'energy too low',
          failedActionIds: [`${input.traceId}:sleep-1`],
          evidenceRecordIds: [`${input.traceId}:memory-energy`],
        },
      },
    ],
    emittedCommandIds: [`${input.traceId}:command-1`],
    memoryContextIds: [],
    memoryWriteIds: [`${input.traceId}:memory-1`],
  });
}

describe('agent cycle trace repositories', () => {
  test('records and queries in-memory traces idempotently', async () => {
    const repository = new InMemoryAgentCycleTraceRepository();
    const older = createTrace({ traceId: 'trace-100', cycleStartedAt: 100 });
    const newer = createTrace({
      traceId: 'trace-200',
      cycleStartedAt: 200,
      replanMaterialization: true,
      contextualPrioritization: true,
      actionSequenceGeneration: true,
      socialDialogueGeneration: true,
      globalSynthesis: true,
      actionRepair: true,
      replanningDecisionTrace: true,
    });
    const otherAgent = createTrace({
      traceId: 'trace-150-agent-2',
      agentId: 'agent-2',
      cycleStartedAt: 150,
    });
    const otherSimulation = createTrace({
      traceId: 'trace-other-simulation',
      simulationId: 'sim-2',
      cycleStartedAt: 300,
    });

    await repository.record(older);
    await repository.record(newer);
    await repository.record(otherAgent);
    await repository.record(otherSimulation);
    await repository.record({ ...newer, selectedBranch: 'duplicate-ignored' });

    await expect(repository.query({ simulationId: 'sim-1', agentId: 'agent-1' })).resolves.toEqual([
      newer,
      older,
    ]);
    await expect(repository.query({ simulationId: 'sim-1', limit: 1 })).resolves.toEqual([newer]);
    await expect(
      repository.query({
        simulationId: 'sim-1',
        fromCycleStartedAt: 120,
        toCycleStartedAt: 170,
      }),
    ).resolves.toEqual([otherAgent]);
    await expect(repository.get('missing')).resolves.toBeUndefined();

    const read = await repository.get('trace-200');
    (read!.memoryWriteIds as string[]).push('mutated');
    (
      read!.subtaskCandidates[0]!.scoreBreakdown as { memoryInfluenceScore: number }
    ).memoryInfluenceScore = 999;
    (
      read!.actionSynthesis.acceptedActions[0]!.resourceEstimate!.inventoryCosts as Record<
        string,
        number
      >
    ).Book = 999;
    (read!.actionSynthesis.rejectedActions[0]!.action as { description: string }).description =
      'mutated';
    (read!.actionSynthesis.acceptedActions[0]!.synthesisContext as { branchId: string }).branchId =
      'mutated';
    (
      read!.actionSynthesis.rejectedActions[0]!.action.synthesisContext as { branchUrgency: number }
    ).branchUrgency = 999;
    (
      read!.subtaskReplanningDecisions[1]!.decision as unknown as {
        failedActionIds: string[];
      }
    ).failedActionIds.push('mutated');
    (
      read!.contextualPrioritization!.choices as unknown as {
        rationale: string;
      }[]
    )[0]!.rationale = 'mutated';
    (
      read!.contextualPrioritization!.shortTermMemoryContext as unknown as {
        recordCount: number;
      }
    ).recordCount = 999;
    (
      read!.actionSequenceGeneration![0]!.actions as unknown as {
        rationale: string;
      }[]
    )[0]!.rationale = 'mutated';
    (
      read!.actionSequenceGeneration![0]!.longTermProfileContext as unknown as {
        entryCount: number;
      }
    ).entryCount = 999;
    (
      read!.actionSequenceGeneration![0]!.worldDecisionContext as unknown as {
        inventoryItemCount: number;
      }
    ).inventoryItemCount = 999;
    (read!.socialDialogueGeneration![0] as unknown as { rationale: string }).rationale =
      'mutated';
    (
      read!.socialDialogueGeneration![0]!.worldDecisionContext as unknown as {
        marketSpotPriceCount: number;
      }
    ).marketSpotPriceCount = 999;
    (
      read!.globalSynthesis!.choices as unknown as {
        rationale: string;
      }[]
    )[0]!.rationale = 'mutated';
    (
      read!.globalSynthesis!.worldDecisionContext as unknown as {
        hasBalance: boolean;
      }
    ).hasBalance = false;
    (
      read!.globalSynthesis!.shortTermMemoryContext as unknown as {
        recordCount: number;
      }
    ).recordCount = 999;
    (
      read!.actionRepair![0]!.reactiveCorrection!.decision.evidenceRecordIds as unknown as string[]
    ).push('mutated');
    (
      read!.actionRepair![0]!.reactiveCorrection!.decision as unknown as {
        rationale: string;
      }
    ).rationale = 'mutated';
    (
      read!.actionRepair![0]!.reactiveCorrection!.worldDecisionContext as unknown as {
        hasLatestPriceIndex: boolean;
      }
    ).hasLatestPriceIndex = false;
    (
      read!.actionRepair![0]!.reactiveCorrection!.longTermProfileContext as unknown as {
        entryCount: number;
      }
    ).entryCount = 999;
    (
      read!.replanningDecisionTrace!.decision as unknown as {
        evidenceRecordIds: string[];
      }
    ).evidenceRecordIds.push('mutated');
    (
      read!.replanningDecisionTrace!.worldDecisionContext as unknown as {
        marketSpotPriceCount: number;
      }
    ).marketSpotPriceCount = 999;
    (
      read!.replanningDecisionTrace!.shortTermMemoryContext as unknown as {
        recordCount: number;
      }
    ).recordCount = 999;
    (
      read!.contextualPrioritization!.worldDecisionContext as unknown as {
        hasPhysiology: boolean;
      }
    ).hasPhysiology = false;
    (
      read!.replanMaterialization as unknown as {
        failedActionIds: string[];
      }
    ).failedActionIds.push('mutated');
    (
      read!.simulatorEvents[0]!.events as {
        type: string;
        sequence?: number;
        summary?: string;
      }[]
    ).push({ type: 'mutated' });
    await expect(repository.get('trace-200')).resolves.toEqual(newer);
    expect((await repository.get('trace-200'))?.contextualPrioritization).toEqual(
      newer.contextualPrioritization,
    );
    expect((await repository.get('trace-200'))?.actionSequenceGeneration).toEqual(
      newer.actionSequenceGeneration,
    );
    expect((await repository.get('trace-200'))?.socialDialogueGeneration).toEqual(
      newer.socialDialogueGeneration,
    );
    expect((await repository.get('trace-200'))?.globalSynthesis).toEqual(newer.globalSynthesis);
    expect((await repository.get('trace-200'))?.actionRepair).toEqual(newer.actionRepair);
    expect((await repository.get('trace-200'))?.replanningDecisionTrace).toEqual(
      newer.replanningDecisionTrace,
    );
  });

  test('preserves replanning decision trace in memory and file-backed repositories', async () => {
    const trace = createTrace({
      traceId: 'trace-replanning-decision',
      replanningDecisionTrace: true,
    });
    const inMemory = new InMemoryAgentCycleTraceRepository();
    const rootDir = createRootDir();
    const fileBacked = new FileAgentCycleTraceRepository({ rootDir });

    await inMemory.record(trace);
    await fileBacked.record(trace);

    await expect(inMemory.get('trace-replanning-decision')).resolves.toMatchObject({
      replanningDecisionTrace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'trace-replanning-decision:replanning-decision',
        providerId: 'scripted-replanning',
        model: 'replanning-model',
        shortTermMemoryContext,
        longTermProfileContext,
        decision: {
          kind: 'memory-guided-correction',
          trigger: 'simulator-rejection',
          failedActionIds: ['trace-replanning-decision:work-hungry'],
          evidenceRecordIds: ['trace-replanning-decision:memory-work-hungry'],
        },
        worldDecisionContext: {
          agentId: 'agent-1',
          hasPhysiology: true,
          hasBalance: true,
          hasEducationScore: true,
          hasResidentialTier: true,
          inventoryItemCount: 1,
          marketSpotPriceCount: 1,
          hasLatestPriceIndex: false,
        },
      },
    });
    await expect(fileBacked.get('trace-replanning-decision')).resolves.toEqual(trace);
  });

  test('persists file-backed traces across repository instances', async () => {
    const rootDir = createRootDir();
    const first = new FileAgentCycleTraceRepository({ rootDir });
    const trace = createTrace({
      traceId: 'trace-1',
      cycleStartedAt: 100,
      replanMaterialization: true,
    });

    await first.record(trace);
    await first.record({ ...trace, selectedBranch: 'duplicate-ignored' });

    const restarted = new FileAgentCycleTraceRepository({ rootDir });

    await expect(restarted.get('trace-1')).resolves.toEqual(trace);
    await expect(restarted.query({ simulationId: 'sim-1' })).resolves.toEqual([trace]);
    await expect(restarted.query({ simulationId: 'sim-1', limit: 0 })).rejects.toThrow(
      'limit must be positive',
    );
  });

  test('normalizes legacy file traces without subtask replanning decisions', async () => {
    const rootDir = createRootDir();
    const trace = createTrace({ traceId: 'legacy-trace', cycleStartedAt: 100 });
    const legacyTrace: Record<string, unknown> = { ...trace };
    delete legacyTrace.subtaskReplanningDecisions;
    delete legacyTrace.simulatorEvents;
    writeFileSync(join(rootDir, 'agent-cycle-traces.jsonl'), `${JSON.stringify(legacyTrace)}\n`);

    const repository = new FileAgentCycleTraceRepository({ rootDir });

    await expect(repository.get('legacy-trace')).resolves.toEqual({
      ...trace,
      subtaskReplanningDecisions: [],
      simulatorEvents: [],
    });
  });
});
