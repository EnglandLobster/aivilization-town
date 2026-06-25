import { createAmmPool } from '@aivilization/economy';
import {
  asMemoryRecordId,
  createShortTermMemoryRecord,
  type ReflectiveInsightSynthesizer,
  type SocialModelSynthesizer,
} from '@aivilization/memory';
import { asAgentId, createEventEnvelope, type SimulationTimestamp } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldCommandPolicies,
  type WorldEvent,
} from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createLocalSimulationLifecycleController,
  createLocalWorldRuntimeStorage,
  type LocalSimulationLifecycleValidationSchedule,
  type LocalSimulationLifecycleMemoryConsolidationSchedule,
} from './index';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
};

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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-lifecycle-'));
  tmpRoots.push(root);
  return root;
}

describe('local simulation lifecycle controller', () => {
  test('starts, pauses, resumes from lifecycle state, and replays world projection from events', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const firstController = createController({ storage, initialProjection });

    const first = await firstController.start(createRequest(1000));

    expect(first.status).toBe('completed');
    expect(first.state).toMatchObject({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      status: 'completed',
      nextTickIndex: 3,
      lastAppliedSequence: 2,
    });
    expect(first.loop.steps.map((step) => [step.tickIndex, step.tickId])).toEqual([
      [1, 'loop-main:tick:1'],
      [2, 'loop-main:tick:2'],
    ]);

    const paused = await firstController.pause(createRequest(1200));

    expect(paused.status).toBe('paused');
    expect(paused.state).toMatchObject({
      status: 'paused',
      nextTickIndex: 3,
      lastAppliedSequence: 2,
    });

    const restartedStorage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(restartedStorage.lifecycleStateStore.getState(createRequest(1300))).toMatchObject({
      status: 'paused',
      nextTickIndex: 3,
      lastAppliedSequence: 2,
    });
    const resumedController = createController({
      storage: restartedStorage,
      initialProjection,
    });
    const resumed = await resumedController.start(createRequest(1300));

    expect(resumed.status).toBe('completed');
    expect(resumed.state).toMatchObject({
      status: 'completed',
      nextTickIndex: 5,
      lastAppliedSequence: 4,
    });
    expect(resumed.loop.steps.map((step) => [step.tickIndex, step.tickId])).toEqual([
      [3, 'loop-main:tick:3'],
      [4, 'loop-main:tick:4'],
    ]);

    const replayed = await resumedController.replay({ ...createRequest(1400), toSequence: 2 });

    expect(replayed.status).toBe('replayed');
    expect(replayed.requestedFromSequence).toBe(0);
    expect(replayed.requestedToSequence).toBe(2);
    expect(replayed.lastAppliedSequence).toBe(2);
    expect(replayed.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
      [2, 'SimulationTimeAdvanced'],
    ]);
    expect(replayed.projection.clock).toEqual({ now: 2000, tickDurationMs: 1000 });
  });

  test('runs configured validation schedule after a completed lifecycle start', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110, 99]);
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      validationSchedule: {
        runIdPrefix: 'lifecycle-validation',
        plannerRuns: createPlannerRuns(),
        eventWindow: { afterSequence: 0, toSequence: 3 },
        expectedTrajectoryAgentIds: ['agent-1'],
        trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
        thresholds: {
          heavyTailReturns: { minimumExcessKurtosis: -2 },
          volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
        },
      },
    });

    const result = await controller.start(createRequest(500));

    expect(result.status).toBe('completed');
    expect(result.state.lastAppliedSequence).toBe(4);
    expect(result.state).toMatchObject({
      lastValidationStatus: 'succeeded',
      lastValidationReportRunId: 'lifecycle-validation:500:4',
      lastValidationGeneratedAt: 500,
    });
    expect(result.validationReport).toMatchObject({
      streamName: storage.partition.eventStreamName,
      streamVersion: 4,
      fromSequence: 0,
      toSequence: 3,
      eventCount: 3,
      projectionSequence: 3,
      report: {
        run: {
          runId: 'lifecycle-validation:500:4',
          simulationId: 'sim-1',
          generatedAt: 500,
          source: 'local-lifecycle-validation',
        },
      },
    });
    await expect(
      storage.experimentValidationReportRepository.get('lifecycle-validation:500:4'),
    ).resolves.toEqual(result.validationReport?.report);
    const restartedStorage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(restartedStorage.lifecycleStateStore.getState(createRequest(550))).toMatchObject({
      lastValidationStatus: 'succeeded',
      lastValidationReportRunId: 'lifecycle-validation:500:4',
      lastValidationGeneratedAt: 500,
    });
  });

  test('skips configured validation schedule when lifecycle start pauses before ticking', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const controller = createController({
      storage,
      initialProjection,
      pauseBeforeTick: () => true,
      validationSchedule: {
        runIdPrefix: 'paused-validation',
        plannerRuns: createPlannerRuns(),
        expectedTrajectoryAgentIds: ['agent-1'],
        trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      },
    });

    const result = await controller.start(createRequest(700));

    expect(result.status).toBe('paused');
    expect(result.validationReport).toBeUndefined();
    await expect(
      storage.experimentValidationReportRepository.query({ simulationId: 'sim-1' }),
    ).resolves.toEqual([]);
  });

  test('returns validation failure metadata without failing a completed lifecycle start', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      validationSchedule: {
        plannerRuns: createPlannerRuns(),
        expectedTrajectoryAgentIds: ['agent-1'],
        trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
      },
    });

    const result = await controller.start(createRequest(900));

    expect(result.status).toBe('completed');
    expect(result.state.lastAppliedSequence).toBe(1);
    expect(result.state).toMatchObject({
      lastValidationStatus: 'failed',
      lastValidationFailure: {
        name: 'Error',
        message: 'events must include at least one TradeExecuted observation',
      },
    });
    expect(result.validationReport).toBeUndefined();
    expect(result.validationFailure).toMatchObject({
      name: 'Error',
      message: 'events must include at least one TradeExecuted observation',
    });
    await expect(
      storage.experimentValidationReportRepository.query({ simulationId: 'sim-1' }),
    ).resolves.toEqual([]);
    const restartedStorage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(restartedStorage.lifecycleStateStore.getState(createRequest(950))).toMatchObject({
      lastValidationStatus: 'failed',
      lastValidationFailure: {
        name: 'Error',
        message: 'events must include at least one TradeExecuted observation',
      },
    });
  });

  test('records validation failure when a generated report contains failing metrics', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    appendTradeEvents(storage, [100, 110, 99]);
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      validationSchedule: {
        runIdPrefix: 'lifecycle-validation-critical',
        plannerRuns: createPlannerRuns(),
        eventWindow: { afterSequence: 0, toSequence: 3 },
        expectedTrajectoryAgentIds: ['agent-1'],
        trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
        thresholds: {
          marketStability: {
            maximumLogPriceRange: 1,
            maximumDrawdown: 0.05,
            minimumLogReturnStandardDeviation: 0,
          },
          heavyTailReturns: { minimumExcessKurtosis: -2 },
          volatilityClustering: { minimumLagOneAbsoluteReturnAutocorrelation: -1 },
        },
      },
    });

    const result = await controller.start(createRequest(950));

    expect(result.status).toBe('completed');
    expect(result.validationReport?.report.run.runId).toBe('lifecycle-validation-critical:950:4');
    expect(result.validationReport?.reportGate).toMatchObject({
      status: 'fail',
      criteriaId: 'lifecycle-validation-critical:950:4:lifecycle-validation-gate',
      failureCount: 1,
    });
    expect(
      result.validationReport?.report.metrics.find((metric) => metric.id === 'market-stability')
        ?.status,
    ).toBe('fail');
    expect(result.validationFailure).toMatchObject({
      name: 'Error',
      message: 'validation report gate failed: metric market-stability status fail is not allowed',
    });
    expect(result.state).toMatchObject({
      lastValidationStatus: 'failed',
      lastValidationReportRunId: 'lifecycle-validation-critical:950:4',
      lastValidationGeneratedAt: 950,
      lastValidationFailure: {
        name: 'Error',
        message:
          'validation report gate failed: metric market-stability status fail is not allowed',
      },
    });
    await expect(
      storage.experimentValidationReportRepository.get('lifecycle-validation-critical:950:4'),
    ).resolves.toEqual(result.validationReport?.report);
    const restartedStorage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(restartedStorage.lifecycleStateStore.getState(createRequest(975))).toMatchObject({
      lastValidationStatus: 'failed',
      lastValidationReportRunId: 'lifecycle-validation-critical:950:4',
      lastValidationGeneratedAt: 950,
      lastValidationFailure: {
        name: 'Error',
        message:
          'validation report gate failed: metric market-stability status fail is not allowed',
      },
    });
  });

  test('runs configured memory consolidation schedule after a completed lifecycle start', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    await storage.shortTermMemoryRepository.appendMany([
      createStudyMemory(1),
      createStudyMemory(2),
      createStudyMemory(3),
    ]);
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      memoryConsolidationSchedule: {
        retrievalLimit: 10,
        minPatternCount: 3,
      },
    });

    const first = await controller.start(createRequest(1000));

    expect(first.status).toBe('completed');
    expect(first.state).toMatchObject({
      lastMemoryConsolidationStatus: 'succeeded',
      lastMemoryConsolidationAt: 1000,
      lastMemoryConsolidationAgentCount: 1,
      lastMemoryConsolidationPatchCount: 1,
      lastMemoryConsolidationCursorCount: 1,
    });
    expect(first.memoryConsolidation).toMatchObject({
      agentIds: ['agent-1'],
      patchCount: 1,
      cursors: [
        {
          agentId: 'agent-1',
          lastProcessedOccurredAt: 3,
          updatedAt: 1000,
        },
      ],
    });
    await expect(storage.longTermProfileRepository.getOrCreate(agentOne)).resolves.toMatchObject({
      habits: [
        {
          key: 'study-before-work',
          statement: 'Studies before starting work.',
        },
      ],
    });
    await expect(storage.memoryConsolidationCursorStore.getCursor(agentOne)).resolves.toEqual({
      agentId: 'agent-1',
      lastProcessedOccurredAt: 3,
      updatedAt: 1000,
    });
    const storedFirstState = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    }).lifecycleStateStore.getState(createRequest(1500));
    expect(storedFirstState).toMatchObject({
      lastMemoryConsolidationStatus: 'succeeded',
      lastMemoryConsolidationAt: 1000,
      lastMemoryConsolidationAgentCount: 1,
      lastMemoryConsolidationPatchCount: 1,
      lastMemoryConsolidationCursorCount: 1,
    });

    const restartedStorage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const restartedController = createController({
      storage: restartedStorage,
      initialProjection,
      tickBatchSize: 1,
      memoryConsolidationSchedule: {
        retrievalLimit: 10,
        minPatternCount: 3,
      },
    });
    const second = await restartedController.start(createRequest(2000));

    expect(second.status).toBe('completed');
    expect(second.memoryConsolidation).toMatchObject({
      agentIds: ['agent-1'],
      patchCount: 0,
      cursors: [],
    });
  });

  test('passes a reflective insight synthesizer through the lifecycle memory schedule', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    await storage.shortTermMemoryRepository.append(createTradeMemory(1));
    const reflectiveInsightSynthesizer: ReflectiveInsightSynthesizer = () => ({
      insights: [
        {
          id: 'reflection-agent-1-value-market-patience-1060',
          agentId: agentOne,
          kind: 'value',
          topicKey: 'market-patience',
          statement: 'The agent values waiting for better market conditions.',
          confidence: 0.8,
          evidenceRecordIds: [asMemoryRecordId('trade-memory-1')],
          generatedAt: 1060,
          tags: ['trade', 'market', 'value'],
        },
      ],
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'reflection-agent-1-1060',
        providerId: 'scripted-reflection',
        model: 'reflection-model',
      },
    });
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      memoryConsolidationSchedule: {
        retrievalLimit: 10,
        minPatternCount: 1,
        reflectiveInsightSynthesizer,
      },
    });

    const result = await controller.start(createRequest(1060));

    expect(result.status).toBe('completed');
    expect(result.memoryConsolidation).toMatchObject({
      patchCount: 1,
      results: [
        {
          reflectionSynthesisTrace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'reflection-agent-1-1060',
            providerId: 'scripted-reflection',
            model: 'reflection-model',
          },
        },
      ],
    });
    await expect(storage.longTermProfileRepository.getOrCreate(agentOne)).resolves.toMatchObject({
      values: [
        {
          key: 'market-patience',
          statement: 'The agent values waiting for better market conditions.',
        },
      ],
    });
  });

  test('passes a social model synthesizer through the lifecycle memory schedule', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    await storage.shortTermMemoryRepository.append(createSocialMemory(1));
    const socialModelSynthesizer: SocialModelSynthesizer = () => ({
      patches: [
        {
          id: 'ltm-patch-agent-1-social-agent-2-1070',
          agentId: agentOne,
          section: 'socialRecords',
          key: agentTwo,
          statement: 'agent-2 reliably shares food during recovery windows.',
          confidence: 0.9,
          provenanceRecordIds: [asMemoryRecordId('social-memory-1')],
          proposedAt: 1070,
          relationDelta: 2,
          attitudeDelta: 1,
        },
      ],
      socialReflections: [
        {
          id: 'social-reflection-agent-1-agent-2-llm-0-1070',
          agentId: agentOne,
          targetAgentId: agentTwo,
          statement: 'agent-2 is becoming a trusted food-sharing partner.',
          relationDelta: 2,
          attitudeDelta: 1,
          confidence: 0.9,
          evidenceRecordIds: [asMemoryRecordId('social-memory-1')],
          generatedAt: 1070,
          tags: ['social', 'post-interaction-reflection', 'agent-2', 'food'],
        },
      ],
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: 'social-model-agent-1-1070',
        providerId: 'scripted-social-model',
        model: 'social-model',
      },
    });
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      memoryConsolidationSchedule: {
        retrievalLimit: 10,
        minPatternCount: 3,
        socialModelSynthesizer,
      },
    });

    const result = await controller.start(createRequest(1070));

    expect(result.status).toBe('completed');
    expect(result.memoryConsolidation).toMatchObject({
      patchCount: 1,
      results: [
        {
          socialModelSynthesisTrace: {
            status: 'accepted',
            source: 'llm',
            requestId: 'social-model-agent-1-1070',
            providerId: 'scripted-social-model',
            model: 'social-model',
          },
        },
      ],
    });
    await expect(storage.longTermProfileRepository.getOrCreate(agentOne)).resolves.toMatchObject({
      socialRecords: [
        {
          key: agentTwo,
          statement: 'agent-2 reliably shares food during recovery windows.',
        },
      ],
    });
  });

  test('surfaces skipped memory consolidation when reflection importance threshold is not met', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    await storage.shortTermMemoryRepository.appendMany([
      createStudyMemory(1),
      createStudyMemory(2),
    ]);
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      memoryConsolidationSchedule: {
        retrievalLimit: 10,
        minPatternCount: 3,
        reflectionTrigger: { minimumImportanceScore: 2 },
      },
    });

    const result = await controller.start(createRequest(1025));

    expect(result.status).toBe('completed');
    expect(result.state).toMatchObject({
      lastMemoryConsolidationStatus: 'succeeded',
      lastMemoryConsolidationAt: 1025,
      lastMemoryConsolidationAgentCount: 0,
      lastMemoryConsolidationPatchCount: 0,
      lastMemoryConsolidationCursorCount: 0,
    });
    expect(result.memoryConsolidation).toMatchObject({
      agentIds: ['agent-1'],
      results: [],
      patchCount: 0,
      cursors: [],
      skipped: [
        {
          agentId: 'agent-1',
          reason: 'importance-threshold-not-met',
          pendingRecordCount: 2,
          pendingImportanceScore: 1.2,
          minimumImportanceScore: 2,
        },
      ],
    });
    await expect(
      storage.memoryConsolidationCursorStore.getCursor(agentOne),
    ).resolves.toBeUndefined();
    await expect(storage.longTermProfileRepository.getOrCreate(agentOne)).resolves.toMatchObject({
      habits: [],
    });
  });

  test('persists scheduled social reflection observations through lifecycle storage', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    await storage.shortTermMemoryRepository.append(createSocialMemory(1));
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      memoryConsolidationSchedule: {
        retrievalLimit: 10,
        minPatternCount: 3,
      },
    });

    const result = await controller.start(createRequest(1040));

    expect(result.status).toBe('completed');
    expect(result.memoryConsolidation).toMatchObject({
      agentIds: ['agent-1'],
      patchCount: 1,
      socialReflectionObservationCount: 1,
    });
    expect(result.state).toMatchObject({
      lastMemoryConsolidationStatus: 'succeeded',
      lastMemoryConsolidationAt: 1040,
      lastMemoryConsolidationAgentCount: 1,
      lastMemoryConsolidationPatchCount: 1,
      lastMemoryConsolidationCursorCount: 1,
      lastMemoryConsolidationSocialReflectionObservationCount: 1,
    });
    await expect(
      storage.socialReflectionObservationRepository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: agentOne,
        targetAgentId: agentTwo,
      }),
    ).resolves.toMatchObject([
      {
        observationId: 'sim-1:world-main:social-reflection-agent-1-agent-2-social-memory-1-1040',
        reflectionId: 'social-reflection-agent-1-agent-2-social-memory-1-1040',
        generatedAt: 1040,
        evidenceRecordIds: ['social-memory-1'],
      },
    ]);

    const restartedStorage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(restartedStorage.lifecycleStateStore.getState(createRequest(1045))).toMatchObject({
      lastMemoryConsolidationStatus: 'succeeded',
      lastMemoryConsolidationSocialReflectionObservationCount: 1,
    });
  });

  test('returns memory consolidation failure metadata without failing a completed lifecycle start', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const controller = createController({
      storage,
      initialProjection,
      tickBatchSize: 1,
      memoryConsolidationSchedule: {
        retrievalLimit: 0,
        minPatternCount: 3,
      },
    });

    const result = await controller.start(createRequest(1050));

    expect(result.status).toBe('completed');
    expect(result.memoryConsolidation).toBeUndefined();
    expect(result.memoryConsolidationFailure).toMatchObject({
      name: 'Error',
      message: 'limit must be a positive integer',
    });
    expect(result.state).toMatchObject({
      lastMemoryConsolidationStatus: 'failed',
      lastMemoryConsolidationFailure: {
        name: 'Error',
        message: 'limit must be a positive integer',
      },
    });
    const restartedStorage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(restartedStorage.lifecycleStateStore.getState(createRequest(1055))).toMatchObject({
      lastMemoryConsolidationStatus: 'failed',
      lastMemoryConsolidationFailure: {
        name: 'Error',
        message: 'limit must be a positive integer',
      },
    });
  });

  test('skips configured memory consolidation schedule when lifecycle start pauses before ticking', async () => {
    const rootDir = createRootDir();
    const initialProjection = createInitialProjection();
    const storage = createLocalWorldRuntimeStorage({
      rootDir,
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    const controller = createController({
      storage,
      initialProjection,
      pauseBeforeTick: () => true,
      memoryConsolidationSchedule: {
        retrievalLimit: 10,
        minPatternCount: 3,
      },
    });

    const result = await controller.start(createRequest(1100));

    expect(result.status).toBe('paused');
    expect(result.memoryConsolidation).toBeUndefined();
    expect(result.memoryConsolidationFailure).toBeUndefined();
    await expect(
      storage.memoryConsolidationCursorStore.getCursor(agentOne),
    ).resolves.toBeUndefined();
  });
});

function createController(input: {
  readonly storage: ReturnType<typeof createLocalWorldRuntimeStorage>;
  readonly initialProjection: ReturnType<typeof createInitialProjection>;
  readonly tickBatchSize?: number;
  readonly pauseBeforeTick?: () => boolean;
  readonly validationSchedule?: LocalSimulationLifecycleValidationSchedule;
  readonly memoryConsolidationSchedule?: LocalSimulationLifecycleMemoryConsolidationSchedule;
}) {
  return createLocalSimulationLifecycleController({
    storage: input.storage,
    lifecycleStateStore: input.storage.lifecycleStateStore,
    loopId: 'loop-main',
    tickBatchSize: input.tickBatchSize ?? 2,
    tickIntervalMs: 100,
    simulationId: 'sim-1',
    initialProjection: input.initialProjection,
    policies,
    commandConsumerId: 'worker-main',
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
    ...(input.pauseBeforeTick === undefined ? {} : { pauseBeforeTick: input.pauseBeforeTick }),
    ...(input.validationSchedule === undefined
      ? {}
      : { validationSchedule: input.validationSchedule }),
    ...(input.memoryConsolidationSchedule === undefined
      ? {}
      : { memoryConsolidationSchedule: input.memoryConsolidationSchedule }),
  });
}

function createRequest(requestedAt: SimulationTimestamp) {
  return {
    simulationId: 'sim-1',
    partitionKey: 'world-main',
    requestedAt,
  };
}

function createInitialProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
    marketPools: [createAmmPool({ commodity: 'Fish', commodityReserve: 10, currencyReserve: 100 })],
  });
}

function appendTradeEvents(
  storage: ReturnType<typeof createLocalWorldRuntimeStorage>,
  closePrices: readonly number[],
): void {
  storage.eventStore.appendToStream({
    streamName: storage.partition.eventStreamName,
    expectedVersion: 0,
    events: closePrices.map((closePrice, index) =>
      createTradeEvent({
        id: `trade-${index + 1}`,
        price: closePrice,
        occurredAt: index,
        sequence: index + 1,
      }),
    ),
  });
}

function createTradeEvent(input: {
  readonly id: string;
  readonly price: number;
  readonly occurredAt: number;
  readonly sequence: number;
}): WorldEvent {
  return createEventEnvelope({
    id: input.id,
    simulationId: 'sim-1',
    type: 'TradeExecuted',
    payload: {
      agentId: agentOne,
      side: 'buy' as const,
      commodityName: 'Fish',
      commodityQuantity: 1,
      currencyQuantity: input.price,
      poolAfter: createAmmPool({
        commodity: 'Fish',
        commodityReserve: 10,
        currencyReserve: input.price * 10,
      }),
      moneySupplyDelta: 0,
    },
    occurredAt: input.occurredAt,
    sequence: input.sequence,
  });
}

function createPlannerRuns() {
  return [
    {
      taskId: 'high-tech-production',
      variant: 'default',
      metrics: [{ metricId: 'net-worth', value: 110_098, higherIsBetter: true }],
    },
    {
      taskId: 'high-tech-production',
      variant: 'without-branch',
      metrics: [{ metricId: 'net-worth', value: 75_237, higherIsBetter: true }],
    },
    {
      taskId: 'high-tech-production',
      variant: 'without-objective-decomposition',
      metrics: [{ metricId: 'net-worth', value: 95_279, higherIsBetter: true }],
    },
  ];
}

function createStudyMemory(index: number) {
  return createShortTermMemoryRecord({
    id: `study-memory-${index}`,
    agentId: agentOne,
    kind: 'action',
    status: 'succeeded',
    summary: 'Completed a focused study session.',
    occurredAt: index,
    importanceScore: 0.6,
    source: { eventIds: [] },
    tags: ['study'],
    consolidationHint: {
      kind: 'habit',
      patternKey: 'study-before-work',
      statement: 'Studies before starting work.',
    },
  });
}

function createTradeMemory(index: number) {
  return createShortTermMemoryRecord({
    id: `trade-memory-${index}`,
    agentId: agentOne,
    kind: 'action',
    status: 'succeeded',
    summary: 'Waited for a better apple price before buying.',
    occurredAt: index,
    importanceScore: 0.8,
    source: { eventIds: [] },
    tags: ['trade', 'market'],
  });
}

function createSocialMemory(index: number) {
  return createShortTermMemoryRecord({
    id: `social-memory-${index}`,
    agentId: agentOne,
    kind: 'social-interaction',
    status: 'succeeded',
    summary: 'Shared food after work.',
    occurredAt: index,
    importanceScore: 0.8,
    source: { eventIds: [] },
    tags: ['conversation', 'community'],
    consolidationHint: {
      kind: 'social',
      targetAgentId: agentTwo,
      relationDelta: 1,
      attitudeDelta: 1,
      summary: 'Shared food after work.',
    },
  });
}
