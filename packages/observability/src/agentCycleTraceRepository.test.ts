import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, gzipSync, inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileAgentCycleTraceRepository,
  InMemoryAgentCycleTraceRepository,
  agentCycleTraceCompressedStorageContainsUtf8,
  createAgentCycleTraceStoragePolicyManifest,
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

function readCompactBatchIndexes(path: string): Record<string, unknown>[] {
  const content = readFileSync(path);
  const batches: Record<string, unknown>[] = [];
  let position = 0;
  while (position < content.byteLength) {
    const compressedByteLength = content.readUInt32BE(position);
    position += 4;
    batches.push(
      JSON.parse(
        inflateRawSync(content.subarray(position, position + compressedByteLength)).toString(
          'utf8',
        ),
      ) as Record<string, unknown>,
    );
    position += compressedByteLength;
  }
  return batches;
}

function writeCompactBatchIndexes(path: string, batches: readonly Record<string, unknown>[]): void {
  writeFileSync(
    path,
    Buffer.concat(
      batches.flatMap((batch) => {
        const compressed = deflateRawSync(Buffer.from(JSON.stringify(batch), 'utf8'), { level: 6 });
        const header = Buffer.allocUnsafe(4);
        header.writeUInt32BE(compressed.byteLength, 0);
        return [header, compressed];
      }),
    ),
  );
}

function createWorldDecisionContextTrace(agentId: string) {
  return {
    agentId,
    hasLocationId: true,
    hasPhysiology: true,
    hasJob: true,
    hasBalance: true,
    hasEducationScore: true,
    hasResidentialTier: true,
    hasInventory: true,
    inventoryItemCount: 2,
    marketSpotPriceCount: 1,
    hasLatestPriceIndex: true,
  };
}

const shortTermMemoryContext = { recordCount: 1 };
const longTermProfileContext = { entryCount: 2 };
const observedStateSummary = 'energy=50 satiety=80 health=100 education=10 balance=100';

function createTrace(input: {
  readonly traceId: string;
  readonly simulationId?: string;
  readonly agentId?: string;
  readonly cycleStartedAt?: number;
  readonly replanMaterialization?: boolean;
  readonly contextualPrioritization?: boolean;
  readonly actionSequenceGeneration?: boolean;
  readonly socialDialogueGeneration?: boolean;
  readonly socialSignalExtraction?: boolean;
  readonly globalSynthesis?: boolean;
  readonly actionRepair?: boolean;
  readonly replanningDecisionTrace?: boolean;
}): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: input.traceId,
    simulationId: input.simulationId ?? 'sim-1',
    agentId: input.agentId ?? 'agent-1',
    cycleStartedAt: input.cycleStartedAt ?? 100,
    observedStateSummary,
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
            observedStateSummary,
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
              observedStateSummary,
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
              observedStateSummary,
              worldDecisionContext: createWorldDecisionContextTrace(input.agentId ?? 'agent-1'),
            },
          ],
        }
      : {}),
    ...(input.socialSignalExtraction === true
      ? {
          socialSignalExtraction: [
            {
              status: 'accepted' as const,
              source: 'llm' as const,
              policyVersion: 'llm-social-signal-extraction-v2',
              agentId: input.agentId ?? 'agent-1',
              targetAgentId: 'agent-2',
              topic: 'market prices',
              turnCount: 2,
              extractedSignalCount: 1,
              requestId: `${input.traceId}:social-signals`,
              providerId: 'scripted-social-signals',
              model: 'signal-model',
              attempts: [
                {
                  attemptIndex: 1,
                  status: 'succeeded',
                  providerId: 'scripted-social-signals',
                  model: 'signal-model',
                  message: 'LLM structured response validated',
                  usage: {
                    inputTokens: 12,
                    outputTokens: 4,
                    totalTokens: 16,
                    estimatedCostMicros: 28,
                  },
                },
              ],
              usage: {
                inputTokens: 12,
                outputTokens: 4,
                totalTokens: 16,
                estimatedCostMicros: 28,
              },
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
            observedStateSummary,
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
                observedStateSummary,
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
            observedStateSummary,
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
      socialSignalExtraction: true,
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
    (read!.socialDialogueGeneration![0] as unknown as { rationale: string }).rationale = 'mutated';
    (
      read!.socialDialogueGeneration![0]!.worldDecisionContext as unknown as {
        marketSpotPriceCount: number;
      }
    ).marketSpotPriceCount = 999;
    (
      read!.socialSignalExtraction![0] as unknown as { extractedSignalCount: number }
    ).extractedSignalCount = 999;
    (
      read!.socialSignalExtraction![0]!.usage as unknown as { totalTokens: number }
    ).totalTokens = 999;
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
    expect((await repository.get('trace-200'))?.socialSignalExtraction).toEqual(
      newer.socialSignalExtraction,
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
        observedStateSummary,
        decision: {
          kind: 'memory-guided-correction',
          trigger: 'simulator-rejection',
          failedActionIds: ['trace-replanning-decision:work-hungry'],
          evidenceRecordIds: ['trace-replanning-decision:memory-work-hungry'],
        },
        worldDecisionContext: {
          agentId: 'agent-1',
          hasLocationId: true,
          hasPhysiology: true,
          hasJob: true,
          hasBalance: true,
          hasEducationScore: true,
          hasResidentialTier: true,
          hasInventory: true,
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

  test('stores complete trace batches as framed Brotli JSONL and reads them after restart', async () => {
    const rootDir = createRootDir();
    const repository = new FileAgentCycleTraceRepository({ rootDir });
    const traces = Array.from({ length: 40 }, (_, index) =>
      createTrace({
        traceId: `batch-trace-${index.toString().padStart(2, '0')}`,
        agentId: `agent-${index.toString().padStart(2, '0')}`,
        cycleStartedAt: 100 + index,
        contextualPrioritization: true,
        actionSequenceGeneration: true,
        globalSynthesis: true,
        replanningDecisionTrace: true,
      }),
    );
    const uncompressedBytes = Buffer.byteLength(
      `${traces.map((trace) => JSON.stringify(trace)).join('\n')}\n`,
      'utf8',
    );

    await repository.recordMany([...traces, traces[0]!]);

    const compressedPath = join(rootDir, 'agent-cycle-traces.jsonl.gz');
    const batchIndexPath = join(rootDir, 'agent-cycle-trace-batches.deflate');
    expect(existsSync(compressedPath)).toBe(true);
    expect(readFileSync(join(rootDir, 'agent-cycle-traces.jsonl'), 'utf8')).toBe('');
    expect(readFileSync(compressedPath).byteLength).toBeLessThan(uncompressedBytes / 2);
    expect(readFileSync(join(rootDir, 'agent-cycle-trace-batches.jsonl'), 'utf8')).toBe('');
    const batchIndexes = readCompactBatchIndexes(batchIndexPath);
    expect(batchIndexes).toHaveLength(1);
    expect(readFileSync(batchIndexPath).byteLength).toBeLessThan(
      Buffer.byteLength(JSON.stringify(batchIndexes[0]), 'utf8') / 2,
    );
    const batchIndex = batchIndexes[0] as unknown as {
      readonly indexSha256: string;
    };
    expect(batchIndex).toMatchObject({
      schemaVersion: 'agent-cycle-trace-batch-index-v2',
      compression: 'brotli-quality-6-length-prefixed-v1',
      compressedOffset: 0,
      traceCount: 40,
      minimumCycleStartedAt: 100,
      maximumCycleStartedAt: 139,
    });
    expect(batchIndex.indexSha256).toMatch(/^[a-f0-9]{64}$/u);
    const restarted = new FileAgentCycleTraceRepository({ rootDir });
    await expect(restarted.query({ simulationId: 'sim-1' })).resolves.toEqual(
      [...traces].sort((left, right) => right.cycleStartedAt - left.cycleStartedAt),
    );
    expect(createAgentCycleTraceStoragePolicyManifest()).toMatchObject({
      policyVersion: 'agent-cycle-trace-storage-v5',
      payload: 'lossless-full-agent-cycle-traces',
      writerFormat: 'legacy-gzip-prefix-plus-length-prefixed-brotli-jsonl-batches',
      repositoryBatchBoundary: 'one-brotli-frame-per-record-many-call',
      compressionQuality: 6,
      sampling: 'none',
      legacyReadPath: 'agent-cycle-traces.jsonl',
      compressedWritePath: 'agent-cycle-traces.jsonl.gz',
      mixedCodecCompatibility: 'v1-v4-gzip-index-rows-plus-v5-brotli-index-rows',
      legacyBatchIndexPath: 'agent-cycle-trace-batches.jsonl',
      compactBatchIndexPath: 'agent-cycle-trace-batches.deflate',
      compactBatchIndexFormat: 'uint32be-length-prefixed-deflate-raw-json-v1',
      indexCompatibilityRule:
        'union-read-legacy-jsonl-and-compact-deflate-with-covered-range-deduplication',
      recentBatchLimit: 1024,
      deduplicationBloomBitCount: 1 << 24,
      deduplicationBloomHashCount: 7,
      runtimeIndexRule: 'bounded-recent-batches-plus-fixed-bloom-with-exact-cold-scan',
      queryRule: 'serve-provably-complete-latest-window-else-filter-complete-index',
      incompleteIndexRecovery: 'hash-and-index-complete-gzip-or-framed-brotli-tail-or-fail-closed',
    });
  });

  test('union-reads the legacy JSONL batch index and compact append tail after upgrade', async () => {
    const rootDir = createRootDir();
    const first = createTrace({ traceId: 'legacy-index-trace', cycleStartedAt: 100 });
    const second = createTrace({ traceId: 'compact-index-trace', cycleStartedAt: 200 });
    const initial = new FileAgentCycleTraceRepository({ rootDir });
    await initial.record(first);

    const compactPath = join(rootDir, 'agent-cycle-trace-batches.deflate');
    const [firstIndex] = readCompactBatchIndexes(compactPath);
    expect(firstIndex).toBeDefined();
    writeFileSync(
      join(rootDir, 'agent-cycle-trace-batches.jsonl'),
      `${JSON.stringify(firstIndex)}\n`,
    );
    writeFileSync(compactPath, '');

    const upgraded = new FileAgentCycleTraceRepository({ rootDir });
    await upgraded.record(second);

    const restarted = new FileAgentCycleTraceRepository({ rootDir });
    await expect(restarted.query({ simulationId: 'sim-1' })).resolves.toEqual([second, first]);
    expect(readCompactBatchIndexes(compactPath)).toHaveLength(1);
  });

  test('bounds the runtime batch index while preserving exact cold get and deduplication', async () => {
    const rootDir = createRootDir();
    const repository = new FileAgentCycleTraceRepository({
      rootDir,
      recentBatchLimit: 2,
      deduplicationBloomBitCount: 8,
    });
    const traces = Array.from({ length: 5 }, (_, index) =>
      createTrace({ traceId: `bounded-trace-${index + 1}`, cycleStartedAt: (index + 1) * 100 }),
    );
    for (const trace of traces) {
      await repository.record(trace);
    }

    expect(repository.getStorageDiagnostics()).toEqual({
      indexedBatchCount: 5,
      recentBatchCount: 2,
      recentTraceIdCount: 2,
      recentBatchLimit: 2,
      deduplicationBloomBitCount: 8,
      deduplicationBloomByteLength: 1,
      maximumEvictedCycleStartedAt: 300,
    });
    await expect(repository.get('bounded-trace-1')).resolves.toEqual(traces[0]);
    await expect(repository.query({ simulationId: 'sim-1', limit: 2 })).resolves.toEqual([
      traces[4],
      traces[3],
    ]);

    await repository.record({ ...traces[0]!, selectedBranch: 'duplicate-must-not-replace' });
    expect(
      readCompactBatchIndexes(join(rootDir, 'agent-cycle-trace-batches.deflate')),
    ).toHaveLength(5);

    const restarted = new FileAgentCycleTraceRepository({
      rootDir,
      recentBatchLimit: 2,
      deduplicationBloomBitCount: 8,
    });
    expect(restarted.getStorageDiagnostics()).toMatchObject({
      indexedBatchCount: 5,
      recentBatchCount: 2,
      recentTraceIdCount: 2,
      maximumEvictedCycleStartedAt: 300,
    });
    await expect(restarted.query({ simulationId: 'sim-1' })).resolves.toEqual(
      [...traces].reverse(),
    );
  });

  test('recovers and hashes a complete compressed tail left without an index row', async () => {
    const rootDir = createRootDir();
    const repository = new FileAgentCycleTraceRepository({ rootDir });
    await repository.record(createTrace({ traceId: 'indexed-trace', cycleStartedAt: 100 }));
    const orphanTrace = createTrace({ traceId: 'orphan-trace', cycleStartedAt: 200 });
    appendFileSync(
      join(rootDir, 'agent-cycle-traces.jsonl.gz'),
      gzipSync(Buffer.from(`${JSON.stringify(orphanTrace)}\n`, 'utf8')),
    );

    const restarted = new FileAgentCycleTraceRepository({ rootDir });

    await expect(restarted.get('orphan-trace')).resolves.toEqual(orphanTrace);
    const postRecoveryTrace = createTrace({
      traceId: 'post-gzip-recovery-brotli-trace',
      cycleStartedAt: 300,
    });
    await restarted.record(postRecoveryTrace);
    await expect(restarted.query({ simulationId: 'sim-1' })).resolves.toEqual([
      postRecoveryTrace,
      orphanTrace,
      expect.objectContaining({ traceId: 'indexed-trace' }),
    ]);
    const indexRows = readCompactBatchIndexes(
      join(rootDir, 'agent-cycle-trace-batches.deflate'),
    ) as { traceIds: string[]; compressedOffset: number }[];
    expect(indexRows).toHaveLength(3);
    expect(indexRows[1]).toMatchObject({ traceIds: ['orphan-trace'] });
    expect(indexRows[1]!.compressedOffset).toBeGreaterThan(0);
  });

  test('recovers a complete framed Brotli tail and exposes integrity-aware identity scanning', async () => {
    const rootDir = createRootDir();
    const trace = createTrace({
      traceId: 'orphan-brotli-trace',
      agentId: 'participant-7',
      cycleStartedAt: 100,
    });
    await new FileAgentCycleTraceRepository({ rootDir }).record(trace);
    writeFileSync(join(rootDir, 'agent-cycle-trace-batches.deflate'), '');

    const recovered = new FileAgentCycleTraceRepository({ rootDir });
    await expect(recovered.get(trace.traceId)).resolves.toEqual(trace);
    expect(agentCycleTraceCompressedStorageContainsUtf8({ rootDir, target: 'participant-7' })).toBe(
      true,
    );
    expect(agentCycleTraceCompressedStorageContainsUtf8({ rootDir, target: 'not-present' })).toBe(
      false,
    );
  });

  test('uses batch metadata for limited, agent-scoped, and time-scoped queries', async () => {
    const rootDir = createRootDir();
    const repository = new FileAgentCycleTraceRepository({ rootDir });
    const oldAgentOne = createTrace({
      traceId: 'old-agent-one',
      agentId: 'agent-1',
      cycleStartedAt: 100,
    });
    const oldAgentTwo = createTrace({
      traceId: 'old-agent-two',
      agentId: 'agent-2',
      cycleStartedAt: 100,
    });
    const newAgentOne = createTrace({
      traceId: 'new-agent-one',
      agentId: 'agent-1',
      cycleStartedAt: 200,
    });
    await repository.recordMany([oldAgentOne, oldAgentTwo]);
    await repository.recordMany([newAgentOne]);
    await repository.record(
      createTrace({
        traceId: 'other-simulation',
        simulationId: 'sim-2',
        cycleStartedAt: 300,
      }),
    );

    const restarted = new FileAgentCycleTraceRepository({ rootDir });
    await expect(restarted.query({ simulationId: 'sim-1', limit: 1 })).resolves.toEqual([
      newAgentOne,
    ]);
    await expect(restarted.query({ simulationId: 'sim-1', agentId: 'agent-2' })).resolves.toEqual([
      oldAgentTwo,
    ]);
    await expect(
      restarted.query({ simulationId: 'sim-1', fromCycleStartedAt: 150 }),
    ).resolves.toEqual([newAgentOne]);
  });

  test('fails closed when hashed compressed-batch metadata is tampered', async () => {
    const rootDir = createRootDir();
    const repository = new FileAgentCycleTraceRepository({ rootDir });
    await repository.record(createTrace({ traceId: 'trace-before-index-corruption' }));
    const batchIndexPath = join(rootDir, 'agent-cycle-trace-batches.deflate');
    const [batchIndex] = readCompactBatchIndexes(batchIndexPath);
    writeCompactBatchIndexes(batchIndexPath, [
      { ...batchIndex, simulationIds: ['tampered-simulation'] },
    ]);

    const restarted = new FileAgentCycleTraceRepository({ rootDir });
    await expect(restarted.query({ simulationId: 'sim-1' })).rejects.toThrow(
      'compressed agent cycle trace index is invalid',
    );
  });

  test('fails closed on an incomplete compact index frame', async () => {
    const rootDir = createRootDir();
    const repository = new FileAgentCycleTraceRepository({ rootDir });
    await repository.record(createTrace({ traceId: 'trace-before-frame-truncation' }));
    appendFileSync(join(rootDir, 'agent-cycle-trace-batches.deflate'), Buffer.from([0, 1]));

    const restarted = new FileAgentCycleTraceRepository({ rootDir });
    await expect(restarted.query({ simulationId: 'sim-1' })).rejects.toThrow(
      'compact agent cycle trace index has an incomplete frame header',
    );
  });

  test('deduplicates across legacy and compressed stores while detecting external appends', async () => {
    const rootDir = createRootDir();
    const repository = new FileAgentCycleTraceRepository({ rootDir });
    const first = createTrace({ traceId: 'first', cycleStartedAt: 100 });
    const legacy = createTrace({ traceId: 'legacy', cycleStartedAt: 200 });
    const external = createTrace({ traceId: 'external', cycleStartedAt: 300 });

    await repository.record(first);
    writeFileSync(
      join(rootDir, 'agent-cycle-traces.jsonl'),
      `${JSON.stringify(legacy)}\n${JSON.stringify(external)}\n`,
    );
    await repository.recordMany([
      { ...legacy, selectedBranch: 'duplicate-must-not-replace-legacy' },
      createTrace({ traceId: 'second', cycleStartedAt: 400 }),
    ]);

    await expect(repository.query({ simulationId: 'sim-1' })).resolves.toMatchObject([
      { traceId: 'second' },
      { traceId: 'external' },
      { traceId: 'legacy', selectedBranch: 'development' },
      { traceId: 'first' },
    ]);
  });

  test('fails closed when the compressed trace store is corrupt', async () => {
    const rootDir = createRootDir();
    const repository = new FileAgentCycleTraceRepository({ rootDir });
    await repository.record(createTrace({ traceId: 'trace-before-corruption' }));
    writeFileSync(join(rootDir, 'agent-cycle-traces.jsonl.gz'), 'not-a-gzip-member');

    await expect(repository.query({ simulationId: 'sim-1' })).rejects.toThrow(
      'compressed agent cycle trace',
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
