import { afterEach, describe, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBranchPlan,
  type AtomicActionProposal,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import { type ScenarioPreset } from '@aivilization/content';
import { asMemoryRecordId } from '@aivilization/memory';
import {
  InMemoryRuntimeProfileRunReportRepository,
  createAgentCycleTrace,
  createExperimentValidationReport,
  createRuntimeProfileRunReport,
} from '@aivilization/observability';
import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
import { type WorldCommandPolicies } from '@aivilization/world';
import {
  createLocalRuntimeTownDaemonScenarioProfile,
  createLocalRuntimeTownNodeHttpServer,
} from './index';
import {
  FileLocalSimulationRuntimeRunQueueRepository,
  FileLocalSimulationRuntimeRunSessionRepository,
  type LocalSimulationRuntimeManifest,
  type LocalSimulationRuntimeSupervisorStartAllResult,
} from '@aivilization/worker';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const mainSquare = asLocationId('main-square');
const tmpRoots: string[] = [];
const servers: Server[] = [];

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
};

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server !== undefined) {
      await closeServer(server);
    }
  }
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town HTTP gateway', () => {
  test('boots the smoke scale profile through the local HTTP gateway', async () => {
    const profile = createLocalRuntimeTownDaemonScenarioProfile('smoke-25');
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: profile.manifest,
      scenarioPresets: profile.scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      runtimeRunQueue: profile.runtimeRunQueue,
      runtimeScheduler: profile.runtimeScheduler,
      runtimeRecovery: profile.runtimeRecovery,
    });
    const server = await listen(runtime.server);

    await expect(fetchJson(`${server.baseUrl}/runtime/daemon/status`)).resolves.toMatchObject({
      manifestId: 'aivilization-smoke-25',
      health: 'healthy',
      components: {
        supervisor: {
          partitionCount: 1,
          healthyPartitionCount: 1,
        },
        scheduler: {
          configured: true,
          desiredRunning: false,
        },
        recovery: {
          configured: true,
          desiredRunning: false,
        },
      },
    });

    const projection = requireProjection(
      await fetchJson(
        `${server.baseUrl}/simulations/aivilization-smoke-25/partitions/world-main/projection`,
      ),
    );
    expect(Object.keys(projection.projection.agents)).toHaveLength(25);
  });

  test('serves durable social reflection observations from partition storage', async () => {
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });
    const server = await listen(runtime.server);
    const observationId = 'sim-1:world-main:social-reflection-agent-1-agent-2-memory-social-1-360';

    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.socialReflectionObservationRepository.record([
        {
          observationId,
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          reflectionId: 'social-reflection-agent-1-agent-2-memory-social-1-360',
          agentId: 'agent-1',
          targetAgentId: 'agent-2',
          statement: 'Interaction with agent-2 changed relation by 1 and attitude by 1.',
          relationDelta: 1,
          attitudeDelta: 1,
          confidence: 0.8,
          evidenceRecordIds: ['memory-social-1'],
          generatedAt: 360,
          tags: ['social', 'post-interaction-reflection'],
          source: 'memory-consolidation',
        },
      ]);

    await expect(
      fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/social-reflection-observations?agentId=agent-1&targetAgentId=agent-2&limit=1`,
      ),
    ).resolves.toMatchObject([
      {
        observationId,
        agentId: 'agent-1',
        targetAgentId: 'agent-2',
        generatedAt: 360,
        source: 'memory-consolidation',
      },
    ]);
    await expect(
      fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/social-reflection-observations/${encodeURIComponent(observationId)}`,
      ),
    ).resolves.toMatchObject({
      observationId,
      reflectionId: 'social-reflection-agent-1-agent-2-memory-social-1-360',
      agentId: 'agent-1',
      targetAgentId: 'agent-2',
      generatedAt: 360,
    });
  });

  test('serves supervisor and projection routes from a manifest-bootstrapped local runtime', async () => {
    const profileRunReportRepository = new InMemoryRuntimeProfileRunReportRepository();
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      runtimeProfileRunReports: profileRunReportRepository,
    });
    const server = await listen(runtime.server);

    const status = await fetchJson(`${server.baseUrl}/runtime/status`);
    expect(status).toMatchObject({
      manifestId: 'town-runtime',
      partitionCount: 2,
      healthyPartitionCount: 2,
      partitions: [
        {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          scenarioPresetId: 'scenario-main',
          status: 'bootstrapped',
        },
        {
          simulationId: 'sim-1',
          partitionKey: 'world-east',
          scenarioPresetId: 'scenario-east',
          status: 'bootstrapped',
        },
      ],
    });
    await expect(fetchJson(`${server.baseUrl}/runtime/daemon/status`)).resolves.toMatchObject({
      manifestId: 'town-runtime',
      health: 'healthy',
      components: {
        supervisor: {
          partitionCount: 2,
          healthyPartitionCount: 2,
        },
        worker: {
          configured: true,
          desiredRunning: false,
          status: {
            running: false,
          },
        },
      },
    });

    const projection = await fetchJson(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/projection`,
    );
    expect(projection).toMatchObject({
      projection: {
        agents: {
          'agent-1': {
            educationScore: 10,
          },
        },
      },
    });
    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.objectiveRenewalTraceRepository.record({
        traceId: 'trace-objective-agent-1-300',
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        objectiveId: 'objective-study-300',
        selectedCandidateId: 'education-development',
        rationale: 'Agent 1 should study before applying for better work.',
        score: 88,
        shortTermMemoryContextIds: ['memory-study-1'],
        profileEntryKeys: ['values:education'],
        profileEvidenceRecordIds: ['profile-education-1'],
        strategicPlan: {
          status: 'accepted',
          source: 'llm',
          requestId: 'llm-plan-objective-study-300',
          providerId: 'scripted-profile-planner',
          model: 'planner-model',
        },
        issuedAt: 300,
      });
    const objectiveRenewalTraces = requireObjectiveRenewalTraceList(
      await fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/objective-renewal-traces?agentId=agent-1&limit=1`,
      ),
    );
    expect(objectiveRenewalTraces).toHaveLength(1);
    expect(objectiveRenewalTraces[0]).toMatchObject({
      traceId: 'trace-objective-agent-1-300',
      agentId: 'agent-1',
      objectiveId: 'objective-study-300',
      strategicPlan: {
        source: 'llm',
        providerId: 'scripted-profile-planner',
      },
    });
    await expect(
      fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/objective-renewal-traces/trace-objective-agent-1-300`,
      ),
    ).resolves.toMatchObject({
      traceId: 'trace-objective-agent-1-300',
      selectedCandidateId: 'education-development',
      issuedAt: 300,
    });
    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.dailyPlanRenewalTraceRepository.record({
        traceId: 'daily-plan-renewal:sim-1:world-main:agent-1:daily-plan:agent-1:0:310',
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: 'agent-1',
        dailyPlanId: 'daily-plan:agent-1:0',
        scheduledIntentionIds: ['daily-plan:agent-1:0:party-prep'],
        shortTermMemoryContextIds: ['memory-social-party'],
        profileEntryKeys: ['habits:party-planning'],
        profileEvidenceRecordIds: ['profile-party-1'],
        planningTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'daily-plan-agent-1-310',
          providerId: 'scripted-daily-planner',
          model: 'daily-planner-model',
        },
        issuedAt: 310,
      });
    const dailyPlanRenewalTraces = requireDailyPlanRenewalTraceList(
      await fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/daily-plan-renewal-traces?agentId=agent-1&dailyPlanId=${encodeURIComponent('daily-plan:agent-1:0')}&limit=1`,
      ),
    );
    expect(dailyPlanRenewalTraces).toHaveLength(1);
    expect(dailyPlanRenewalTraces[0]).toMatchObject({
      traceId: 'daily-plan-renewal:sim-1:world-main:agent-1:daily-plan:agent-1:0:310',
      agentId: 'agent-1',
      dailyPlanId: 'daily-plan:agent-1:0',
      scheduledIntentionIds: ['daily-plan:agent-1:0:party-prep'],
      planningTrace: {
        source: 'llm',
        providerId: 'scripted-daily-planner',
      },
    });
    await expect(
      fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/daily-plan-renewal-traces/${encodeURIComponent('daily-plan-renewal:sim-1:world-main:agent-1:daily-plan:agent-1:0:310')}`,
      ),
    ).resolves.toMatchObject({
      traceId: 'daily-plan-renewal:sim-1:world-main:agent-1:daily-plan:agent-1:0:310',
      dailyPlanId: 'daily-plan:agent-1:0',
      issuedAt: 310,
    });
    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.steeringTraceRepository.record({
        traceId: 'sim-1:world-main:1:cmd-objective-study',
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        commandId: 'cmd-objective-study',
        commandType: 'SetLongHorizonObjective',
        source: 'godot',
        agentId: 'agent-1',
        resultKind: 'long-horizon-objective-set',
        objectiveId: 'objective-study',
        planId: 'plan-objective-study',
        selectedPlannerDomain: 'study',
        candidateActionCount: 2,
        commandDraftCount: 1,
        shortTermMemoryRecordIds: ['memory-study-1'],
        strategicPlan: {
          status: 'accepted',
          source: 'llm',
          requestId: 'llm-plan-objective-study',
          providerId: 'scripted-profile-planner',
          model: 'planner-model',
          attempts: [
            {
              attemptIndex: 1,
              status: 'accepted',
              providerId: 'scripted-profile-planner',
              model: 'planner-model',
              message: 'compiled branch plan',
              usage: {
                inputTokens: 100,
                outputTokens: 40,
                totalTokens: 140,
                estimatedCostMicros: 12,
              },
            },
          ],
        },
        issuedAt: 320,
        recordedAt: 330,
      });
    const steeringTraces = requireSteeringTraceList(
      await fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/steering-traces?traceId=${encodeURIComponent('sim-1:world-main:1:cmd-objective-study')}&agentId=agent-1&commandId=cmd-objective-study&limit=1`,
      ),
    );
    expect(steeringTraces).toHaveLength(1);
    expect(steeringTraces[0]).toMatchObject({
      traceId: 'sim-1:world-main:1:cmd-objective-study',
      commandId: 'cmd-objective-study',
      agentId: 'agent-1',
      resultKind: 'long-horizon-objective-set',
      strategicPlan: {
        source: 'llm',
        providerId: 'scripted-profile-planner',
      },
    });
    await expect(
      fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/steering-traces/${encodeURIComponent('sim-1:world-main:1:cmd-objective-study')}`,
      ),
    ).resolves.toMatchObject({
      traceId: 'sim-1:world-main:1:cmd-objective-study',
      objectiveId: 'objective-study',
      issuedAt: 320,
    });
    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.agentCycleTraceRepository.record(createServerAgentCycleTrace());
    const agentCycleTraces = await fetchJson(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/agent-cycle-traces?agentId=agent-1&limit=1`,
    );
    expect(agentCycleTraces).toMatchObject([
      {
        traceId: 'cycle-trace-agent-1-350',
        agentId: 'agent-1',
        selectedBranch: 'recovery',
        simulatorResult: { status: 'repaired', reason: 'buy Apple before eating' },
        simulatorEvents: [
          {
            actionId: 'eat-apple-1',
            attempt: 'original',
            status: 'rejected',
            reason: 'insufficient Apple',
            events: [
              {
                type: 'ActionRejected',
                sequence: 10,
                summary: 'insufficient Apple',
              },
            ],
          },
          {
            actionId: 'buy-apple-1',
            attempt: 'repair',
            status: 'accepted',
            events: [
              {
                type: 'TradeExecuted',
                sequence: 11,
                summary: 'buy Apple 1',
              },
            ],
          },
        ],
      },
    ]);
    await expect(
      fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/agent-cycle-traces/cycle-trace-agent-1-350`,
      ),
    ).resolves.toMatchObject({
      traceId: 'cycle-trace-agent-1-350',
      agentId: 'agent-1',
      cycleStartedAt: 350,
      simulatorEvents: [
        {
          actionId: 'eat-apple-1',
          attempt: 'original',
          status: 'rejected',
          reason: 'insufficient Apple',
        },
        {
          actionId: 'buy-apple-1',
          attempt: 'repair',
          status: 'accepted',
        },
      ],
    });
    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.longTermProfileRepository.applyPatches(agentOne, [
        {
          id: 'ltm-patch-agent-1-value-community-220',
          agentId: agentOne,
          section: 'values',
          key: 'community-cooperation',
          statement: 'Agent 1 values cooperative community routines.',
          confidence: 0.8,
          provenanceRecordIds: [asMemoryRecordId('memory-social-value-1')],
          proposedAt: 220,
        },
        {
          id: 'ltm-patch-agent-1-personality-sociable-220',
          agentId: agentOne,
          section: 'personality',
          key: 'sociable',
          statement: 'Agent 1 shows a sociable disposition.',
          confidence: 0.7,
          provenanceRecordIds: [asMemoryRecordId('memory-social-personality-1')],
          proposedAt: 220,
        },
        {
          id: 'ltm-patch-agent-1-social-agent-2-220',
          agentId: agentOne,
          section: 'socialRecords',
          key: 'agent-2',
          statement: 'Agent 1 recently cooperated with Agent 2.',
          confidence: 0.9,
          provenanceRecordIds: [asMemoryRecordId('memory-social-record-1')],
          proposedAt: 220,
          relationDelta: 0.2,
          attitudeDelta: 0.15,
        },
      ]);
    const agentProfile = requireAgentProfile(
      await fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/agent-profiles/agent-1`,
      ),
    );
    expect(agentProfile).toMatchObject({
      agentId: 'agent-1',
      values: [
        {
          key: 'community-cooperation',
          statement: 'Agent 1 values cooperative community routines.',
          confidence: 0.8,
          updatedAt: 220,
          provenanceRecordIds: ['memory-social-value-1'],
        },
      ],
    });
    expect(agentProfile.personality).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'sociable',
          statement: 'Agent 1 shows a sociable disposition.',
          confidence: 0.7,
        }),
      ]),
    );
    expect(agentProfile.socialRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'agent-2',
          statement: 'Agent 1 recently cooperated with Agent 2.',
          relationDelta: 0.2,
          attitudeDelta: 0.15,
        }),
      ]),
    );
    await expect(
      fetchJson(`${server.baseUrl}/simulations/sim-1/partitions/world-main/agent-profiles?limit=1`),
    ).resolves.toEqual([
      expect.objectContaining({
        agentId: 'agent-1',
        values: [
          expect.objectContaining({
            key: 'community-cooperation',
          }),
        ],
      }),
    ]);

    const start = await fetchJson(`${server.baseUrl}/runtime/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: 'op-start-all-200', requestedAt: 200 }),
    });
    expect(start).toMatchObject({
      traceId: 'op-start-all-200',
      outcome: 'succeeded',
      succeededPartitionCount: 2,
      failedPartitionCount: 0,
    });

    const eventFeed = requireEventFeed(
      await fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/events?afterSequence=0&limit=5`,
      ),
    );
    expect(eventFeed).toMatchObject({
      streamName: 'simulation/sim-1/partition/world-main/events',
      streamVersion: 1,
      nextAfterSequence: 1,
    });
    expect(eventFeed.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
    ]);

    const sync = requireSyncEnvelope(
      await fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/sync?afterSequence=0&limit=1`,
      ),
    );
    expect(sync).toMatchObject({
      streamName: 'simulation/sim-1/partition/world-main/events',
      streamVersion: 1,
      projectionSequence: 1,
      nextAfterSequence: 1,
      hasMoreEvents: false,
    });
    expect(sync.projection.agents['agent-1']?.educationScore).toBe(10);
    expect(sync.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'SimulationTimeAdvanced'],
    ]);

    const syncEvent = await fetchFirstSseEvent(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/sync-stream?afterSequence=0&limit=1`,
    );
    expect(syncEvent).toContain('id: 1\n');
    expect(syncEvent).toContain('event: sync\n');
    expect(syncEvent).toContain('"streamName":"simulation/sim-1/partition/world-main/events"');
    expect(syncEvent).toContain('"nextAfterSequence":1');
    expect(syncEvent).toContain('"type":"SimulationTimeAdvanced"');

    const validationReport = createValidationReport();
    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.experimentValidationReportRepository.record(validationReport);
    const validationReports = await fetchJson(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/validation-reports?limit=1`,
    );
    expect(validationReports).toMatchObject([
      {
        run: {
          runId: 'validation-server-1',
          simulationId: 'sim-1',
        },
      },
    ]);
    await profileRunReportRepository.record(createProfileRunReport());
    await expect(
      fetchJson(`${server.baseUrl}/runtime/profile-run-reports?profileId=smoke-25&limit=1`),
    ).resolves.toMatchObject([
      {
        runId: 'run-server-1',
        profileId: 'smoke-25',
        manifestId: 'aivilization-smoke-25',
        totalProjectionAgentCount: 25,
      },
    ]);
    await expect(
      fetchJson(`${server.baseUrl}/runtime/profile-run-reports/run-server-1`),
    ).resolves.toMatchObject({
      runId: 'run-server-1',
      profileId: 'smoke-25',
      manifestId: 'aivilization-smoke-25',
      totalProjectionAgentCount: 25,
    });

    const trace = await fetchJson(`${server.baseUrl}/runtime/operation-traces/op-start-all-200`);
    expect(trace).toMatchObject({
      traceId: 'op-start-all-200',
      manifestId: 'town-runtime',
      command: 'start-all',
      outcome: 'succeeded',
    });

    const run = await fetchJson(`${server.baseUrl}/runtime/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operationId: 'op-run-cycles-400',
        requestedAt: 400,
        cycleCount: 2,
        cycleIntervalMs: 100,
      }),
    });
    expect(run).toMatchObject({
      traceId: 'op-run-cycles-400',
      outcome: 'succeeded',
      requestedCycleCount: 2,
      completedCycleCount: 2,
      stopReason: 'cycle-count-completed',
      cycles: [
        {
          traceId: 'op-run-cycles-400:cycle:1',
          requestedAt: 400,
          outcome: 'succeeded',
        },
        {
          traceId: 'op-run-cycles-400:cycle:2',
          requestedAt: 500,
          outcome: 'succeeded',
        },
      ],
    });

    const queuedRun = await fetchJson(`${server.baseUrl}/runtime/run-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: 'job-run-async-600',
        operationId: 'op-run-async-600',
        enqueuedAt: 590,
        requestedAt: 600,
        cycleCount: 3,
        cycleIntervalMs: 75,
        stopOnAttention: true,
      }),
    });
    expect(queuedRun).toMatchObject({
      jobId: 'job-run-async-600',
      manifestId: 'town-runtime',
      status: 'queued',
      enqueuedAt: 590,
      updatedAt: 590,
      runRequest: {
        operationId: 'op-run-async-600',
        requestedAt: 600,
        cycleCount: 3,
        cycleIntervalMs: 75,
        stopOnAttention: true,
      },
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-run-async-600`),
    ).resolves.toMatchObject({
      jobId: 'job-run-async-600',
      manifestId: 'town-runtime',
      status: 'queued',
      enqueuedAt: 590,
      runRequest: {
        operationId: 'op-run-async-600',
        requestedAt: 600,
        cycleCount: 3,
      },
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-queue-worker/status`),
    ).resolves.toMatchObject({
      running: false,
      inFlight: false,
      processedJobCount: 0,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-queue-worker/drain`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxJobs: 1 }),
      }),
    ).resolves.toMatchObject({
      processedJobCount: 1,
      completedJobCount: 1,
      failedJobCount: 0,
      results: [{ status: 'completed', job: { jobId: 'job-run-async-600' } }],
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-queue-worker/status`),
    ).resolves.toMatchObject({
      running: false,
      inFlight: false,
      processedJobCount: 1,
      completedJobCount: 1,
      failedJobCount: 0,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-run-async-600`),
    ).resolves.toMatchObject({
      jobId: 'job-run-async-600',
      manifestId: 'town-runtime',
      status: 'completed',
      resultTraceId: 'op-run-async-600',
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-sessions/op-run-async-600`),
    ).resolves.toMatchObject({
      traceId: 'op-run-async-600',
      manifestId: 'town-runtime',
      status: 'completed',
      completedCycleCount: 3,
      stopReason: 'cycle-count-completed',
    });

    const runQueueRepository = new FileLocalSimulationRuntimeRunQueueRepository({
      rootDir: join(runtime.host.rootDir, 'operations'),
    });
    await runQueueRepository.enqueue({
      jobId: 'job-dead-server-1',
      manifestId: 'town-runtime',
      enqueuedAt: 800,
      runRequest: {
        operationId: 'op-run-dead-server-1',
        requestedAt: 810,
        cycleCount: 1,
      },
    });
    await runQueueRepository.claimNext({
      workerId: 'worker-dead',
      claimedAt: 820,
      leaseDurationMs: 100,
    });
    await runQueueRepository.fail({
      jobId: 'job-dead-server-1',
      failedAt: 830,
      maxAttempts: 1,
      error: { name: 'Error', message: 'server-side failure' },
    });
    await expect(
      fetchJson(
        `${server.baseUrl}/runtime/run-jobs?status=dead-lettered&manifestId=town-runtime&limit=1`,
      ),
    ).resolves.toMatchObject([
      {
        jobId: 'job-dead-server-1',
        manifestId: 'town-runtime',
        status: 'dead-lettered',
        deadLetteredAt: 830,
      },
    ]);
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-dead-server-1/replay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ replayedAt: 900 }),
      }),
    ).resolves.toMatchObject({
      jobId: 'job-dead-server-1',
      manifestId: 'town-runtime',
      status: 'queued',
      nextAttemptAt: 900,
      replayCount: 1,
      lastReplayedAt: 900,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-dead-server-1`),
    ).resolves.toMatchObject({
      jobId: 'job-dead-server-1',
      status: 'queued',
      maxAttempts: 2,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/stats?observedAt=910&manifestId=town-runtime`),
    ).resolves.toMatchObject({
      observedAt: 910,
      manifestId: 'town-runtime',
      totalJobCount: 2,
      statusCounts: {
        queued: 1,
        leased: 0,
        completed: 1,
        failed: 0,
        'dead-lettered': 0,
      },
      readyQueueCount: 1,
      delayedQueueCount: 0,
      activeLeaseCount: 0,
      expiredLeaseCount: 0,
      failedAttemptCount: 1,
      replayCount: 1,
      oldestQueuedAt: 800,
      oldestReadyJobEnqueuedAt: 800,
    });

    const runSession = await fetchJson(`${server.baseUrl}/runtime/run-sessions/op-run-cycles-400`);
    expect(runSession).toMatchObject({
      traceId: 'op-run-cycles-400',
      manifestId: 'town-runtime',
      status: 'completed',
      outcome: 'succeeded',
      requestedCycleCount: 2,
      completedCycleCount: 2,
      stopReason: 'cycle-count-completed',
      cycles: [
        {
          cycleIndex: 1,
          traceId: 'op-run-cycles-400:cycle:1',
          requestedAt: 400,
        },
        {
          cycleIndex: 2,
          traceId: 'op-run-cycles-400:cycle:2',
          requestedAt: 500,
        },
      ],
    });

    const stopFirstCycle = await runtime.supervisor.startAll({
      operationId: 'op-run-stop-700:cycle:1',
      requestedAt: 700,
    });
    const runSessionRepository = new FileLocalSimulationRuntimeRunSessionRepository({
      rootDir: join(runtime.host.rootDir, 'operations'),
    });
    await runSessionRepository.save({
      traceId: 'op-run-stop-700',
      manifestId: 'town-runtime',
      requestedAt: 700,
      requestedCycleCount: 3,
      cycleIntervalMs: 50,
      stopOnAttention: true,
      status: 'running',
      completedCycleCount: 1,
      cycles: [createRunCycleSummary(1, 700, stopFirstCycle)],
      statusSnapshot: stopFirstCycle.status,
      updatedAt: 700,
    });
    const stopRequest = await fetchJson(
      `${server.baseUrl}/runtime/run-sessions/op-run-stop-700/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestedAt: 725 }),
      },
    );
    expect(stopRequest).toMatchObject({
      traceId: 'op-run-stop-700',
      status: 'running',
      stopRequestedAt: 725,
    });

    const stoppedRun = await fetchJson(`${server.baseUrl}/runtime/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operationId: 'op-run-stop-700',
        requestedAt: 700,
        cycleCount: 3,
        cycleIntervalMs: 50,
      }),
    });
    expect(stoppedRun).toMatchObject({
      traceId: 'op-run-stop-700',
      completedCycleCount: 2,
      stopReason: 'stop-requested',
      cycles: [
        { cycleIndex: 1, traceId: 'op-run-stop-700:cycle:1', requestedAt: 700 },
        { cycleIndex: 2, traceId: 'op-run-stop-700:cycle:2', requestedAt: 750 },
      ],
    });
    const stoppedSession = await fetchJson(
      `${server.baseUrl}/runtime/run-sessions/op-run-stop-700`,
    );
    expect(stoppedSession).toMatchObject({
      traceId: 'op-run-stop-700',
      status: 'stopped',
      stopReason: 'stop-requested',
      stopRequestedAt: 725,
      completedCycleCount: 2,
    });

    const runTrace = await fetchJson(
      `${server.baseUrl}/runtime/operation-traces/op-run-cycles-400`,
    );
    expect(runTrace).toMatchObject({
      traceId: 'op-run-cycles-400',
      manifestId: 'town-runtime',
      command: 'run-cycles',
      outcome: 'succeeded',
      cycles: [
        {
          cycleIndex: 1,
          traceId: 'op-run-cycles-400:cycle:1',
          requestedAt: 400,
        },
        {
          cycleIndex: 2,
          traceId: 'op-run-cycles-400:cycle:2',
          requestedAt: 500,
        },
      ],
    });
  });

  test('passes dynamic agent providers through server runtime composition', async () => {
    const providerObserved: string[] = [];
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      agentProvider: ({ projection, storage }) => {
        providerObserved.push(
          `${storage.partition.partitionKey}:${projection.agents['agent-1']?.educationScore ?? -1}`,
        );
        if (storage.partition.partitionKey !== 'world-main') {
          return [];
        }
        return [
          {
            agentId: agentOne,
            observedStateSummary: 'server provider study agent',
            plan: createStudyPlan(),
            signals: [],
            microPlanners: [
              studyMicroPlanner({
                id: 'server-provider-study',
                description: 'server provider study',
                commandType: 'AgentStudy',
                payload: { durationSeconds: 30, educationRatePerSecond: 1 },
              }),
            ],
            simulate: ({ action }) => ({ status: 'accepted', action }),
          },
        ];
      },
    });
    const server = await listen(runtime.server);

    await expect(
      fetchJson(`${server.baseUrl}/runtime/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: 'op-provider-start', requestedAt: 200 }),
      }),
    ).resolves.toMatchObject({
      traceId: 'op-provider-start',
      outcome: 'succeeded',
      succeededPartitionCount: 2,
    });
    expect(providerObserved).toContain('world-main:10');

    const projection = requireProjection(
      await fetchJson(`${server.baseUrl}/simulations/sim-1/partitions/world-main/projection`),
    );
    expect(projection.projection.agents['agent-1']).toMatchObject({
      educationScore: 40,
    });
  });

  test('optionally wires a runtime scheduler host into the local server API', async () => {
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      runtimeScheduler: {
        schedulerId: 'main-loop',
        cycleCount: 2,
        cycleIntervalMs: 50,
        scheduleIntervalMs: 1_000,
      },
    });
    const server = await listen(runtime.server);

    await expect(fetchJson(`${server.baseUrl}/runtime/scheduler/status`)).resolves.toMatchObject({
      running: false,
      inFlight: false,
      attemptedScheduleCount: 0,
    });
    const scheduled = await fetchJson(`${server.baseUrl}/runtime/scheduler/run-once`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(scheduled).toMatchObject({
      status: 'enqueued',
      job: {
        manifestId: 'town-runtime',
        status: 'queued',
        runRequest: {
          cycleCount: 2,
          cycleIntervalMs: 50,
        },
      },
    });
    if (
      scheduled === null ||
      typeof scheduled !== 'object' ||
      !('status' in scheduled) ||
      scheduled.status !== 'enqueued' ||
      !('job' in scheduled) ||
      scheduled.job === null ||
      typeof scheduled.job !== 'object' ||
      !('jobId' in scheduled.job) ||
      typeof scheduled.job.jobId !== 'string'
    ) {
      throw new Error('expected scheduler to enqueue a run job');
    }
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/${encodeURIComponent(scheduled.job.jobId)}`),
    ).resolves.toMatchObject({
      jobId: scheduled.job.jobId,
      manifestId: 'town-runtime',
      status: 'queued',
      runRequest: {
        cycleCount: 2,
        cycleIntervalMs: 50,
      },
    });
  });

  test('optionally wires runtime recovery controls into the local server API', async () => {
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      runtimeRecovery: {
        recoveryIntervalMs: 1_000,
        maxDrainJobsPerRun: 1,
      },
    });
    const server = await listen(runtime.server);

    await fetchJson(`${server.baseUrl}/runtime/run-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jobId: 'job-run-recovery-600',
        operationId: 'op-run-recovery-600',
        enqueuedAt: 590,
        requestedAt: 600,
        cycleCount: 1,
      }),
    });

    await expect(fetchJson(`${server.baseUrl}/runtime/recovery/status`)).resolves.toMatchObject({
      running: false,
      inFlight: false,
      attemptedRecoveryCount: 0,
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/recovery/run-once`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    ).resolves.toMatchObject({
      status: 'recovered',
      drainResult: {
        processedJobCount: 1,
        completedJobCount: 1,
        failedJobCount: 0,
      },
    });
    await expect(
      fetchJson(`${server.baseUrl}/runtime/run-jobs/job-run-recovery-600`),
    ).resolves.toMatchObject({
      jobId: 'job-run-recovery-600',
      manifestId: 'town-runtime',
      status: 'completed',
      resultTraceId: 'op-run-recovery-600',
    });
    await expect(fetchJson(`${server.baseUrl}/runtime/recovery/status`)).resolves.toMatchObject({
      running: false,
      inFlight: false,
      attemptedRecoveryCount: 1,
      recoveredCount: 1,
    });
  });

  test('delegates daemon auto-start and close cleanup through runtime orchestration', async () => {
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      runtimeRunQueue: {
        autoStart: true,
        pollIntervalMs: 10_000,
      },
      runtimeScheduler: {
        autoStart: true,
        cycleCount: 1,
        scheduleIntervalMs: 10_000,
      },
      runtimeRecovery: {
        autoStart: true,
        recoveryIntervalMs: 10_000,
      },
    });
    await listen(runtime.server);

    expect(runtime.runtimeOrchestration.runQueueWorkerHost.getStatus()).toMatchObject({
      running: true,
    });
    expect(runtime.runtimeOrchestration.runQueueSchedulerHost?.getStatus()).toMatchObject({
      running: true,
    });
    expect(runtime.runtimeOrchestration.runQueueRecoveryHost?.getStatus()).toMatchObject({
      running: true,
    });

    const server = servers.pop();
    expect(server).toBe(runtime.server);
    if (server !== undefined) {
      await closeServer(server);
    }
    expect(runtime.runtimeOrchestration.runQueueWorkerHost.getStatus()).toMatchObject({
      running: false,
    });
    expect(runtime.runtimeOrchestration.runQueueSchedulerHost?.getStatus()).toMatchObject({
      running: false,
    });
    expect(runtime.runtimeOrchestration.runQueueRecoveryHost?.getStatus()).toMatchObject({
      running: false,
    });
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-server-'));
  tmpRoots.push(root);
  return root;
}

function createManifest(): LocalSimulationRuntimeManifest {
  return {
    id: 'town-runtime',
    defaults: {
      tickBatchSize: 1,
      tickIntervalMs: 100,
      commandConsumerIdPrefix: 'worker',
    },
    partitions: [
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        scenarioPresetId: 'scenario-main',
      },
      {
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        scenarioPresetId: 'scenario-east',
      },
    ],
  };
}

function createScenarioPresets(): readonly ScenarioPreset[] {
  return [
    createScenarioPreset({
      id: 'scenario-main',
      agentId: agentOne,
      educationScore: 10,
    }),
    createScenarioPreset({
      id: 'scenario-east',
      agentId: agentTwo,
      educationScore: 20,
    }),
  ];
}

function createScenarioPreset(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly educationScore: number;
}): ScenarioPreset {
  return {
    id: input.id,
    name: input.id,
    description: `${input.id} test scenario`,
    clock: { now: 0, tickDurationMs: 1000 },
    timeScale: 35,
    locations: [
      {
        locationId: mainSquare,
        name: 'Main Square',
        kind: 'social',
        activityAffinities: ['study'],
        capacity: null,
        source: 'test',
      },
    ],
    agentSeeds: [
      {
        agentId: input.agentId,
        displayName: input.agentId,
        profile: { personality: { mbti: 'INTJ' }, source: 'test' },
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: input.educationScore,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
        locationId: mainSquare,
        source: 'test',
        tags: ['test'],
      },
    ],
    source: 'test',
  };
}

function createStudyPlan() {
  return createBranchPlan({
    objective: 'develop education',
    branches: [
      {
        id: 'development',
        objective: 'improve education',
        subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
      },
    ],
  });
}

function studyMicroPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'study',
    supports: ({ subtaskId }) => subtaskId === 'study',
    propose: () => [action],
  };
}

function createRunCycleSummary(
  cycleIndex: number,
  requestedAt: number,
  result: LocalSimulationRuntimeSupervisorStartAllResult,
) {
  return {
    cycleIndex,
    traceId: result.traceId,
    requestedAt,
    outcome: result.outcome,
    succeededPartitionCount: result.succeededPartitionCount,
    failedPartitionCount: result.failedPartitionCount,
    attentionPartitionCount: result.status.attentionPartitionCount,
  };
}

function createValidationReport() {
  return createExperimentValidationReport({
    run: {
      runId: 'validation-server-1',
      simulationId: 'sim-1',
      generatedAt: 500,
    },
    priceSeries: [
      { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
      { commodityId: 'Fish', observedAt: 1, closePrice: 101 },
    ],
    wealthSnapshot: [
      { agentId: 'agent-1', educationScore: 10, netWorth: 100 },
      { agentId: 'agent-2', educationScore: 20, netWorth: 120 },
    ],
    plannerRuns: [
      {
        taskId: 'task-1',
        variant: 'default',
        metrics: [{ metricId: 'net-worth', value: 100, higherIsBetter: true }],
      },
      {
        taskId: 'task-1',
        variant: 'without-branch',
        metrics: [{ metricId: 'net-worth', value: 80, higherIsBetter: true }],
      },
      {
        taskId: 'task-1',
        variant: 'without-objective-decomposition',
        metrics: [{ metricId: 'net-worth', value: 90, higherIsBetter: true }],
      },
    ],
    expectedTrajectoryAgentIds: ['agent-1'],
    trajectories: [{ agentId: 'agent-1', stepCount: 1 }],
    thresholds: {
      heavyTailReturns: { minimumExcessKurtosis: -2 },
    },
  });
}

function createServerAgentCycleTrace() {
  return createAgentCycleTrace({
    traceId: 'cycle-trace-agent-1-350',
    simulationId: 'sim-1',
    agentId: 'agent-1',
    cycleStartedAt: 350,
    observedStateSummary: 'energy=40 satiety=30 health=100 inventory.Apple=0',
    selectedBranch: 'recovery',
    subtaskCandidates: [
      {
        branchId: 'recovery',
        subtaskId: 'restore-satiety',
        description: 'eat before studying',
        score: 8,
        scoreBreakdown: {
          basePriorityScore: 5,
          signalInfluenceScore: 2,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 1,
          profileInfluenceScore: 0,
        },
      },
    ],
    actionSynthesis: {
      acceptedActions: [
        {
          id: 'eat-apple-1',
          description: 'eat Apple 1',
          commandType: 'AgentEat',
          priority: 4,
          synthesisContext: {
            branchId: 'recovery',
            subtaskId: 'restore-satiety',
            subtaskScore: 8,
          },
          resourceEstimate: {
            actionSeconds: 10,
            inventoryCosts: { Apple: 1 },
          },
        },
      ],
      rejectedActions: [],
    },
    candidateActions: ['eat Apple 1'],
    simulatorResult: { status: 'repaired', reason: 'buy Apple before eating' },
    simulatorEvents: [
      {
        actionId: 'eat-apple-1',
        attempt: 'original',
        status: 'rejected',
        reason: 'insufficient Apple',
        events: [
          {
            type: 'ActionRejected',
            sequence: 10,
            summary: 'insufficient Apple',
          },
        ],
      },
      {
        actionId: 'buy-apple-1',
        attempt: 'repair',
        status: 'accepted',
        events: [
          {
            type: 'TradeExecuted',
            sequence: 11,
            summary: 'buy Apple 1',
          },
        ],
      },
    ],
    selectionEvidence: {
      selectedSubtaskId: 'restore-satiety',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 1,
      profileInfluenceScore: 0,
      memoryEvidenceRecordIds: ['stm-hungry-1'],
      profileEntryKeys: ['habits:buy-food-when-hungry'],
      profileEvidenceRecordIds: ['profile-habit-food-1'],
    },
    replanningDecision: {
      kind: 'memory-guided-correction',
      trigger: 'simulator-rejection',
      reason: 'buy Apple before eating',
      failedActionIds: ['eat-apple-1'],
      evidenceRecordIds: ['stm-hungry-1'],
    },
    subtaskReplanningDecisions: [
      {
        branchId: 'recovery',
        subtaskId: 'restore-satiety',
        decision: {
          kind: 'memory-guided-correction',
          trigger: 'simulator-rejection',
          reason: 'buy Apple before eating',
          failedActionIds: ['eat-apple-1'],
          evidenceRecordIds: ['stm-hungry-1'],
        },
      },
    ],
    emittedCommandIds: ['cmd-buy-apple-1', 'cmd-eat-apple-1'],
    memoryContextIds: ['stm-hungry-1'],
    memoryWriteIds: ['stm-repair-food-1'],
  });
}

function createProfileRunReport() {
  return createRuntimeProfileRunReport({
    runId: 'run-server-1',
    profileId: 'smoke-25',
    manifestId: 'aivilization-smoke-25',
    rootDir: '/tmp/aivilization-profile-run-server',
    generatedAt: 600,
    requestedAt: 500,
    daemonHealth: 'healthy',
    outcome: 'succeeded',
    requestedCycleCount: 1,
    completedCycleCount: 1,
    stopReason: 'cycle-count-completed',
    partitionCount: 1,
    totalProjectionAgentCount: 25,
    totalEventCount: 10,
    totalAgentTraceCount: 5,
    agentCycleDiagnostics: createAgentCycleDiagnostics(5),
    partitions: [
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-smoke-25-world-main',
        status: 'completed',
        health: 'healthy',
        lastAppliedSequence: 10,
        streamVersion: 10,
        eventCount: 10,
        projectionAgentCount: 25,
        agentTraceCount: 5,
      },
    ],
  });
}

function createAgentCycleDiagnostics(traceCount: number) {
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
  };
}

async function listen(server: Server): Promise<{ readonly baseUrl: string }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected TCP server address');
  }
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
  return response.json() as Promise<unknown>;
}

async function fetchFirstSseEvent(url: string): Promise<string> {
  const abort = new AbortController();
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream' },
    signal: abort.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error('expected response body reader');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!buffer.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    abort.abort();
    await reader.cancel().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        throw error;
      }
    });
  }
  return buffer.slice(0, buffer.indexOf('\n\n') + 2);
}

function requireProjection(value: unknown): {
  readonly projection: {
    readonly agents: Readonly<Record<string, unknown>>;
  };
} {
  if (value === null || typeof value !== 'object' || !('projection' in value)) {
    throw new Error('expected projection response');
  }
  return value as {
    readonly projection: {
      readonly agents: Readonly<Record<string, unknown>>;
    };
  };
}

function requireAgentProfile(value: unknown): {
  readonly agentId: string;
  readonly values: readonly unknown[];
  readonly personality: readonly unknown[];
  readonly socialRecords: readonly unknown[];
} {
  if (value === null || typeof value !== 'object' || !('agentId' in value)) {
    throw new Error('expected agent profile response');
  }
  return value as {
    readonly agentId: string;
    readonly values: readonly unknown[];
    readonly personality: readonly unknown[];
    readonly socialRecords: readonly unknown[];
  };
}

function requireObjectiveRenewalTraceList(value: unknown): readonly {
  readonly traceId: string;
  readonly agentId: string;
  readonly objectiveId: string;
  readonly strategicPlan?: {
    readonly source?: string;
    readonly providerId?: string;
  };
}[] {
  if (!Array.isArray(value)) {
    throw new Error('expected objective renewal trace list response');
  }
  return value as readonly {
    readonly traceId: string;
    readonly agentId: string;
    readonly objectiveId: string;
    readonly strategicPlan?: {
      readonly source?: string;
      readonly providerId?: string;
    };
  }[];
}

function requireDailyPlanRenewalTraceList(value: unknown): readonly {
  readonly traceId: string;
  readonly agentId: string;
  readonly dailyPlanId: string;
  readonly scheduledIntentionIds: readonly string[];
  readonly planningTrace?: {
    readonly source?: string;
    readonly providerId?: string;
  };
}[] {
  if (!Array.isArray(value)) {
    throw new Error('expected daily plan renewal trace list response');
  }
  return value as readonly {
    readonly traceId: string;
    readonly agentId: string;
    readonly dailyPlanId: string;
    readonly scheduledIntentionIds: readonly string[];
    readonly planningTrace?: {
      readonly source?: string;
      readonly providerId?: string;
    };
  }[];
}

function requireSteeringTraceList(value: unknown): readonly {
  readonly traceId: string;
  readonly commandId: string;
  readonly agentId: string;
  readonly resultKind: string;
  readonly strategicPlan?: {
    readonly source?: string;
    readonly providerId?: string;
  };
}[] {
  if (!Array.isArray(value)) {
    throw new Error('expected steering trace list response');
  }
  return value as readonly {
    readonly traceId: string;
    readonly commandId: string;
    readonly agentId: string;
    readonly resultKind: string;
    readonly strategicPlan?: {
      readonly source?: string;
      readonly providerId?: string;
    };
  }[];
}

function requireEventFeed(value: unknown): {
  readonly streamName: string;
  readonly streamVersion: number;
  readonly nextAfterSequence: number;
  readonly events: readonly { readonly sequence: number; readonly type: string }[];
} {
  if (value === null || typeof value !== 'object' || !('events' in value)) {
    throw new Error('expected event feed response');
  }
  return value as {
    readonly streamName: string;
    readonly streamVersion: number;
    readonly nextAfterSequence: number;
    readonly events: readonly { readonly sequence: number; readonly type: string }[];
  };
}

function requireSyncEnvelope(value: unknown): {
  readonly streamName: string;
  readonly streamVersion: number;
  readonly projectionSequence: number;
  readonly nextAfterSequence: number;
  readonly hasMoreEvents: boolean;
  readonly projection: {
    readonly agents: Readonly<Record<string, { readonly educationScore: number }>>;
  };
  readonly events: readonly { readonly sequence: number; readonly type: string }[];
} {
  if (value === null || typeof value !== 'object' || !('projection' in value)) {
    throw new Error('expected sync envelope response');
  }
  return value as {
    readonly streamName: string;
    readonly streamVersion: number;
    readonly projectionSequence: number;
    readonly nextAfterSequence: number;
    readonly hasMoreEvents: boolean;
    readonly projection: {
      readonly agents: Readonly<Record<string, { readonly educationScore: number }>>;
    };
    readonly events: readonly { readonly sequence: number; readonly type: string }[];
  };
}
