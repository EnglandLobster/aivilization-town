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
import { createTownStaticBearerCredentialDigest } from '@aivilization/api';
import { asMemoryRecordId, createShortTermMemoryRecord } from '@aivilization/memory';
import { createScriptedLlmProvider } from '@aivilization/llm';
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
  createLocalRuntimeTownApi,
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
  test('exposes one content-addressed Agent directory across runtime partitions', async () => {
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

    await expect(
      fetchJson(`${server.baseUrl}/simulations/sim-1/society/agents`),
    ).resolves.toMatchObject({
      schemaVersion: 'local-simulation-society-directory-v1',
      manifestId: 'town-runtime',
      simulationId: 'sim-1',
      agents: [
        { agentId: 'agent-1', ownerPartitionKey: 'world-main' },
        { agentId: 'agent-2', ownerPartitionKey: 'world-east' },
      ],
    });
    await expect(
      fetchJson(`${server.baseUrl}/simulations/sim-1/society/agents/agent-2`),
    ).resolves.toMatchObject({
      agentId: 'agent-2',
      ownerPartitionKey: 'world-east',
      publicState: { educationScore: 20, locationId: 'main-square' },
    });
    await expect(
      fetchJson(`${server.baseUrl}/simulations/sim-1/society/projection`),
    ).resolves.toMatchObject({
      schemaVersion: 'local-simulation-society-projection-v1',
      simulationId: 'sim-1',
      population: {
        totalAgentCount: 2,
        owners: [
          { partitionKey: 'world-east', agentCount: 1 },
          { partitionKey: 'world-main', agentCount: 1 },
        ],
      },
      locations: [
        {
          location: { locationId: 'main-square' },
          occupantAgentIds: ['agent-1', 'agent-2'],
          occupancy: 2,
        },
      ],
      migrations: [
        { agentId: 'agent-1', ownerPartitionKey: 'world-main', locationId: 'main-square' },
        { agentId: 'agent-2', ownerPartitionKey: 'world-east', locationId: 'main-square' },
      ],
      market: { status: 'consistent-replica', pools: [] },
    });
    await expect(
      fetchJson(`${server.baseUrl}/simulations/sim-1/society/agents/missing-agent`),
    ).rejects.toThrow('404');

    await expect(
      fetchJson(`${server.baseUrl}/simulations/sim-1/society/interactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationId: 'http-agent-1-meets-agent-2',
          initiatorAgentId: 'agent-1',
          targetAgentId: 'agent-2',
          topic: 'town cooperation',
          turns: [
            {
              speakerAgentId: 'agent-1',
              utterance: 'Could we coordinate our work at the square?',
            },
            {
              speakerAgentId: 'agent-2',
              utterance: 'Yes, I will share what the east side needs.',
            },
          ],
          issuedAt: 100,
        }),
      }),
    ).resolves.toMatchObject({
      schemaVersion: 'local-simulation-social-interaction-v1',
      operationId: 'http-agent-1-meets-agent-2',
      sourcePartitionKey: 'world-main',
      targetPartitionKey: 'world-east',
      partitionStreamVersions: { 'world-main': 4, 'world-east': 4 },
      idempotentReplay: false,
    });
    for (const partitionKey of ['world-main', 'world-east']) {
      await expect(
        fetchJson(`${server.baseUrl}/simulations/sim-1/partitions/${partitionKey}/projection`),
      ).resolves.toMatchObject({
        streamVersion: 4,
        projection: {
          conversationRecords: [
            {
              initiatorAgentId: 'agent-1',
              participantAgentIds: ['agent-1', 'agent-2'],
            },
          ],
        },
      });
    }
  });

  test('creates a post-bootstrap agent through the durable HTTP command lifecycle', async () => {
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      canonicalAgents: true,
    });
    const server = await listen(runtime.server);

    await expect(
      fetchJson(`${server.baseUrl}/simulations/sim-1/partitions/world-main/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: 'agent-created-ada',
          creatorId: 'participant-7',
          displayName: 'Ada',
          issuedAt: 90,
        }),
      }),
    ).resolves.toMatchObject({
      command: {
        id: 'api-register-sim-1-agent-created-ada',
        actorId: 'agent-created-ada',
        type: 'RegisterAgent',
      },
      result: { accepted: true, sequence: 1 },
    });

    await expect(
      fetchJson(`${server.baseUrl}/runtime/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationId: 'run-materialize-agent-registration',
          requestedAt: 100,
          cycleCount: 1,
          cycleIntervalMs: 0,
        }),
      }),
    ).resolves.toMatchObject({ outcome: 'succeeded', completedCycleCount: 1 });

    const projection = requireProjection(
      await fetchJson(`${server.baseUrl}/simulations/sim-1/partitions/world-main/projection`),
    );
    expect(projection.projection.agents['agent-created-ada']).toMatchObject({
      agentId: 'agent-created-ada',
      registration: {
        creatorId: 'participant-7',
        displayName: 'Ada',
        policyVersion: 'runtime-agent-registration-v3',
        provenance: 'post-bootstrap-command',
      },
    });
    await expect(
      runtime.host.registry
        .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
        .storage.longTermProfileRepository.getOrCreate(asAgentId('agent-created-ada')),
    ).resolves.toMatchObject({ agentId: 'agent-created-ada' });
    const eventFeed = (await fetchJson(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/events?limit=10`,
    )) as { readonly events: readonly unknown[] };
    expect(eventFeed.events[0]).toMatchObject({
      type: 'AgentRegistered',
      commandId: 'api-register-sim-1-agent-created-ada',
      payload: { creatorId: 'participant-7' },
    });
    expect(
      eventFeed.events.some((event) => {
        if (typeof event !== 'object' || event === null || !('type' in event)) return false;
        if (event.type !== 'EducationChanged' || !('payload' in event)) return false;
        const payload = event.payload;
        return (
          typeof payload === 'object' &&
          payload !== null &&
          'agentId' in payload &&
          payload.agentId === 'agent-created-ada'
        );
      }),
    ).toBe(true);
  });

  test('authenticates participants, binds ownership, enforces quota, and reserves operations for operators', async () => {
    const participantToken = 'participant-token-0000000000000000000001';
    const otherParticipantToken = 'participant-token-0000000000000000000002';
    const operatorToken = 'operator-token-0000000000000000000000001';
    const runtime = await createLocalRuntimeTownNodeHttpServer({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      canonicalAgents: true,
      participantAccess: {
        mode: 'authenticated',
        maxAgentsPerParticipant: 1,
        credentials: (
          [
            {
              keyId: 'participant-7-primary',
              subjectId: 'participant-7',
              token: participantToken,
              roles: ['participant'],
            },
            {
              keyId: 'participant-8-primary',
              subjectId: 'participant-8',
              token: otherParticipantToken,
              roles: ['participant'],
            },
            {
              keyId: 'operator-primary',
              subjectId: 'operator-1',
              token: operatorToken,
              roles: ['operator'],
            },
          ] as const
        ).map(createTownStaticBearerCredentialDigest),
      },
    });
    const server = await listen(runtime.server);
    const agentsUrl = `${server.baseUrl}/simulations/sim-1/partitions/world-main/agents`;

    const anonymous = await fetch(agentsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-owned',
        displayName: 'Owned',
        issuedAt: 100,
        consentPolicyVersion: 'participant-data-consent-v1',
      }),
    });
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({
      error: { code: 'authentication_required' },
    });

    const registration = await fetch(agentsUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${participantToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agentId: 'agent-owned',
        displayName: 'Owned',
        issuedAt: 100,
        consentPolicyVersion: 'participant-data-consent-v1',
      }),
    });
    expect(registration.status).toBe(202);
    await expect(registration.json() as Promise<unknown>).resolves.toMatchObject({
      command: {
        type: 'RegisterAgent',
        payload: { creatorId: 'participant-7', agentId: 'agent-owned' },
      },
    });

    const operatorRun = await fetch(`${server.baseUrl}/runtime/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${operatorToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        operationId: 'run-authenticated-registration',
        requestedAt: 100,
        cycleCount: 1,
        cycleIntervalMs: 0,
      }),
    });
    expect(operatorRun.status).toBe(202);

    const session = await fetch(`${server.baseUrl}/access/session`, {
      headers: { authorization: `Bearer ${participantToken}` },
    });
    await expect(session.json()).resolves.toMatchObject({
      policy: {
        policyVersion: 'participant-access-control-v2',
        mode: 'authenticated',
        maxAgentsPerParticipant: 1,
      },
      authentication: {
        authenticated: true,
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      },
    });

    const objectiveUrl = `${server.baseUrl}/simulations/sim-1/partitions/world-main/objectives`;
    const ownObjective = await fetch(objectiveUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${participantToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agentId: 'agent-owned',
        objectiveId: 'objective-owned',
        statement: 'Build a durable future.',
        priority: 10,
        affinityTags: ['education'],
        issuedAt: 200,
        consentPolicyVersion: 'participant-data-consent-v1',
      }),
    });
    expect(ownObjective.status).toBe(202);

    const postObjectiveCycle = await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .lifecycle.start({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 200,
      });
    if ('loop' in postObjectiveCycle && postObjectiveCycle.loop.status === 'command-drain-failed') {
      const failedDrain = postObjectiveCycle.loop.failedStep.result.commandDrain;
      if (failedDrain.status === 'failed') throw failedDrain.error;
      throw new Error('command-drain-failed lifecycle must expose a failed command drain');
    }
    expect(postObjectiveCycle.status).toBe('completed');

    const crossOwnerObjective = await fetch(objectiveUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${otherParticipantToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agentId: 'agent-owned',
        objectiveId: 'objective-spoofed',
        statement: 'Take over another participant agent.',
        priority: 10,
        affinityTags: [],
        issuedAt: 200,
      }),
    });
    expect(crossOwnerObjective.status).toBe(403);
    await expect(crossOwnerObjective.json()).resolves.toMatchObject({
      error: { code: 'agent_not_owned' },
    });

    const participantRuntimeMutation = await fetch(`${server.baseUrl}/runtime/run`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${participantToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requestedAt: 200, cycleCount: 1 }),
    });
    expect(participantRuntimeMutation.status).toBe(403);
    await expect(participantRuntimeMutation.json()).resolves.toMatchObject({
      error: { code: 'insufficient_role' },
    });

    const quota = await fetch(agentsUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${participantToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agentId: 'agent-over-quota',
        displayName: 'Extra',
        issuedAt: 200,
        consentPolicyVersion: 'participant-data-consent-v1',
      }),
    });
    expect(quota.status).toBe(429);
    await expect(quota.json()).resolves.toMatchObject({
      error: { code: 'participant_agent_quota_reached' },
    });

    const projection = requireProjection(
      await fetchJson(`${server.baseUrl}/simulations/sim-1/partitions/world-main/projection`),
    );
    expect(projection.projection.agents['agent-owned']).toMatchObject({
      registration: {
        creatorId: 'participant-7',
        policyVersion: 'runtime-agent-registration-v3',
        humanAttribution: {
          principalSubjectId: 'participant-7',
          accessPolicyVersion: 'participant-access-control-v2',
          consentPolicyVersion: 'participant-data-consent-v1',
        },
      },
    });
    await expect(
      runtime.host.registry
        .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
        .storage.steeringTraceRepository.query({
          simulationId: 'sim-1',
          agentId: 'agent-owned',
        }),
    ).resolves.toMatchObject([
      {
        objectiveId: 'objective-owned',
        humanAttribution: {
          principalSubjectId: 'participant-7',
          principalRoles: ['participant'],
          accessPolicyVersion: 'participant-access-control-v2',
          consentPolicyVersion: 'participant-data-consent-v1',
        },
      },
    ]);
  });

  test('applies paper planner ablations after the same configured base compiler', async () => {
    const compiledObjectives: string[] = [];

    for (const plannerVariant of ['without-branch', 'without-objective-decomposition'] as const) {
      const runtime = await createLocalRuntimeTownApi({
        rootDir: createRootDir(),
        bootstrappedAt: 100,
        manifest: createManifest(),
        scenarioPresets: createScenarioPresets(),
        policies,
        localizedPlanners: [],
        steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
        agents: [],
        canonicalAgents: true,
        plannerVariant,
        strategicPlanCompiler: ({ objective }) => {
          compiledObjectives.push(objective.statement);
          return {
            plan: createBranchPlan({
              objective: objective.statement,
              branches: [
                {
                  id: 'development',
                  objective: 'Build capability.',
                  subtasks: [
                    {
                      id: 'study',
                      description: 'Study before working.',
                      basePriority: 10,
                      signalKeys: ['education'],
                    },
                  ],
                },
                {
                  id: 'employment',
                  objective: 'Secure income.',
                  subtasks: [
                    {
                      id: 'apply-for-work',
                      description: 'Apply for suitable work.',
                      basePriority: 9,
                      signalKeys: ['work'],
                    },
                  ],
                },
              ],
            }),
            planningTrace: {
              status: 'accepted',
              source: 'llm',
              requestId: 'controlled-base-request',
              providerId: 'controlled-provider',
              model: 'controlled-model',
              usage: {
                inputTokens: 100,
                outputTokens: 40,
                totalTokens: 140,
                estimatedCostMicros: 12,
              },
            },
          };
        },
        ambientObservationMemory: { enabled: false },
      });
      const backend = runtime.host.registry.getBackend({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
      });

      await backend.lifecycle.start({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 200,
      });
      const record = await backend.storage.planRepository.require({
        planId: 'auto-objective-agent-1-200-1',
        agentId: agentOne,
      });

      expect(record.planningTrace).toMatchObject({
        status: 'accepted',
        source: 'llm',
        requestId: 'controlled-base-request',
        providerId: 'controlled-provider',
        model: 'controlled-model',
        plannerVariant,
        ablationPolicyVersion: 'paper-planner-ablation-v1',
        usage: { totalTokens: 140, estimatedCostMicros: 12 },
      });
      if (plannerVariant === 'without-branch') {
        expect(record.plan.branches).toHaveLength(1);
        expect(record.plan.branches[0]).toMatchObject({ id: 'without-branch' });
        expect(record.plan.branches[0]?.subtasks.map((subtask) => subtask.id)).toEqual([
          'study',
          'apply-for-work',
        ]);
      } else {
        expect(record.plan.branches).toHaveLength(2);
        expect(
          record.plan.branches.every(
            (branch) =>
              branch.id.startsWith('without-objective-decomposition-') &&
              branch.subtasks.length === 1,
          ),
        ).toBe(true);
      }
    }

    expect(compiledObjectives).toEqual([
      'Improve education to qualify for better town opportunities.',
      'Improve education to qualify for better town opportunities.',
    ]);
  });

  test('builds autonomous agents from durable objectives through the canonical provider', async () => {
    const runtime = await createLocalRuntimeTownApi({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      canonicalAgents: true,
      ambientObservationMemory: { enabled: false },
    });
    const backend = runtime.host.registry.getBackend({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });

    const result = await backend.lifecycle.start({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      requestedAt: 200,
    });

    expect(result).toMatchObject({
      status: 'completed',
      loop: {
        steps: [
          {
            tick: {
              traces: [
                {
                  agentId: agentOne,
                  globalSynthesis: {
                    status: 'deterministic',
                    source: 'deterministic',
                    message: 'global-action-synthesis-v1',
                  },
                },
              ],
            },
          },
        ],
      },
    });
    await expect(backend.storage.intentionRepository.getOrCreate(agentOne)).resolves.toMatchObject({
      activeObjective: {
        id: 'auto-objective-agent-1-200-1',
        statement: 'Improve education to qualify for better town opportunities.',
      },
    });
    await expect(
      backend.storage.planRepository.require({
        planId: 'auto-objective-agent-1-200-1',
        agentId: agentOne,
      }),
    ).resolves.toMatchObject({
      plan: { objective: 'Improve education to qualify for better town opportunities.' },
      strategicContext: {
        policyVersion: 'strategic-plan-renewal-v3',
        physiologyRegimes: ['stable'],
      },
    });
    await expect(
      backend.storage.objectiveRenewalTraceRepository.query({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId: agentOne,
        limit: 1,
      }),
    ).resolves.toMatchObject([
      {
        objectiveId: 'auto-objective-agent-1-200-1',
        selectedCandidateId: 'education-growth',
      },
    ]);
  });

  test('rejects ambiguous canonical and caller-owned agent provider wiring', async () => {
    const baseInput = {
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }: { readonly action: AtomicActionProposal }) => ({
        status: 'accepted' as const,
        action,
      }),
      agents: [],
      canonicalAgents: true as const,
    };

    await expect(
      createLocalRuntimeTownApi({
        ...baseInput,
        agentProvider: () => [],
      }),
    ).rejects.toThrow('canonicalAgents cannot be combined with agentProvider');
    await expect(
      createLocalRuntimeTownApi({
        ...baseInput,
        agents: [
          {
            agentId: agentOne,
            observedStateSummary: 'static agent',
            plan: createStudyPlan(),
            signals: [],
            microPlanners: [],
            simulate: ({ action }) => ({ status: 'accepted' as const, action }),
          },
        ],
      }),
    ).rejects.toThrow('canonicalAgents cannot be combined with static agents');
  });

  test('applies configured structured LLM stages to canonical server agents', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-server-llm',
      responses: Array.from({ length: 4 }, () => ({
        providerId: 'scripted-server-llm',
        model: 'server-test-model',
        content: '{}',
        finishReason: 'stop' as const,
        usage: { inputTokens: 4, outputTokens: 2 },
      })),
    });
    const studyAction: AtomicActionProposal = {
      id: 'study-with-llm-fallback',
      description: 'Study with a validated deterministic fallback.',
      commandType: 'AgentStudy',
      payload: { durationSeconds: 60, educationRatePerSecond: 0.01 },
    };
    const runtime = await createLocalRuntimeTownApi({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [
        {
          agentId: agentOne,
          observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
          plan: createStudyPlan(),
          signals: [{ key: 'study', weight: 5 }],
          microPlanners: [studyMicroPlanner(studyAction)],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ],
      ambientObservationMemory: { enabled: false },
      llm: {
        provider: scripted.provider,
        model: 'server-test-model',
        maxAttempts: 1,
        pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 3 },
        stages: {
          'strategic-planning': false,
          'reactive-correction': false,
          'social-dialogue': false,
          'ambient-reaction': false,
          'memory-reflection': false,
          'social-model-synthesis': false,
        },
      },
    });
    const result = await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .lifecycle.start({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 200,
      });

    expect(result).toMatchObject({
      status: 'completed',
      loop: {
        steps: [
          {
            tick: {
              traces: [
                {
                  contextualPrioritization: {
                    status: 'fallback',
                    source: 'deterministic-fallback',
                    providerId: 'scripted-server-llm',
                  },
                  actionSequenceGeneration: [
                    {
                      status: 'fallback',
                      source: 'deterministic-fallback',
                      providerId: 'scripted-server-llm',
                    },
                  ],
                  globalSynthesis: {
                    status: 'fallback',
                    source: 'deterministic-fallback',
                    providerId: 'scripted-server-llm',
                  },
                  replanningDecisionTrace: {
                    status: 'fallback',
                    source: 'deterministic-fallback',
                    providerId: 'scripted-server-llm',
                  },
                },
              ],
            },
          },
        ],
      },
    });
    expect(scripted.getRequests().map((request) => request.schemaName)).toEqual([
      'aivilization_subtask_prioritization',
      'aivilization_action_sequence_generation',
      'aivilization_global_synthesis',
      'aivilization_replanning_decision',
    ]);
  });

  test('enables canonical memory consolidation without caller wiring', async () => {
    const runtime = await createLocalRuntimeTownApi({
      rootDir: createRootDir(),
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });
    const backend = runtime.host.registry.getBackend({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    await backend.storage.shortTermMemoryRepository.appendMany(
      [1, 2, 3].map((index) =>
        createShortTermMemoryRecord({
          id: `canonical-study-${index}`,
          agentId: agentOne,
          kind: 'action',
          status: 'succeeded',
          summary: 'Completed a focused study session.',
          occurredAt: 100 + index,
          importanceScore: 0.6,
          source: { eventIds: [] },
          tags: ['study'],
          consolidationHint: {
            kind: 'habit',
            patternKey: 'focused-study',
            statement: 'Studies in focused sessions.',
          },
        }),
      ),
    );

    const result = await backend.lifecycle.start({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      requestedAt: 200,
    });

    expect(result).toMatchObject({
      status: 'completed',
      state: {
        lastMemoryConsolidationStatus: 'succeeded',
        lastMemoryConsolidationAt: 200,
        lastMemoryConsolidationPatchCount: 1,
        lastMemoryConsolidationCursorCount: 1,
      },
      memoryConsolidation: {
        patchCount: 1,
        skipped: [],
      },
    });
    await expect(
      backend.storage.longTermProfileRepository.getOrCreate(agentOne),
    ).resolves.toMatchObject({
      habits: [
        expect.objectContaining({
          key: 'focused-study',
          provenanceRecordIds: ['canonical-study-1', 'canonical-study-2', 'canonical-study-3'],
        }),
      ],
    });
  });

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

    const uiResponse = await fetch(`${server.baseUrl}/`);
    expect(uiResponse.status).toBe(200);
    expect(uiResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(uiResponse.headers.get('content-security-policy')).toContain("default-src 'self'");
    const uiHtml = await uiResponse.text();
    expect(uiHtml).toContain('Aivilization Living City');
    expect(uiHtml).toContain('aria-orientation="horizontal"');
    expect(uiHtml).toContain('Mission control');
    expect(uiHtml).toContain('id="view-description"');
    expect(uiHtml).toContain('Access & ownership');
    expect(uiHtml).toContain('semantic layout · interpolated movement');
    expect(uiHtml).toContain('id="town-canvas"');
    expect(uiHtml).toContain('type="module" src="/ui/app.js"');
    const scriptResponse = await fetch(`${server.baseUrl}/ui/app.js`);
    expect(scriptResponse.status).toBe(200);
    expect(scriptResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const script = await scriptResponse.text();
    expect(script).toContain('loadAgentCognition');
    expect(script).toContain('aivilization.access-token');
    expect(script).toContain('readViewFromLocation');
    expect(script).toContain("window.history.pushState(null, '', `#${view}`)");
    expect(script).toContain("'ArrowRight'");
    // app.js is served at /ui/app.js, so relative imports must resolve under
    // /ui/ — importing './ui/…' would produce /ui/ui/… 404s in the browser.
    expect(script).toContain("import { createMapRenderer } from './map/renderer.js'");
    expect(script).not.toContain("from './ui/");
    const rendererResponse = await fetch(`${server.baseUrl}/ui/map/renderer.js`);
    expect(rendererResponse.status).toBe(200);
    expect(rendererResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const interpolationResponse = await fetch(`${server.baseUrl}/ui/map/interpolation.js`);
    expect(interpolationResponse.status).toBe(200);
    expect(await interpolationResponse.text()).toContain('resolveAgentPosition');
    const workspacesResponse = await fetch(`${server.baseUrl}/ui/panels/workspaces.js`);
    expect(workspacesResponse.status).toBe(200);
    expect(await workspacesResponse.text()).toContain('data-location-id');
    const tilesResponse = await fetch(`${server.baseUrl}/ui/assets/tiles.png`);
    expect(tilesResponse.status).toBe(200);
    expect(tilesResponse.headers.get('content-type')).toBe('image/png');
    expect(tilesResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const tilesBytes = new Uint8Array(await tilesResponse.arrayBuffer());
    expect([...tilesBytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    await runtime.host.registry
      .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
      .storage.planRepository.save({
        planId: 'plan-agent-1-education',
        agentId: agentOne,
        plan: createStudyPlan(),
        createdAt: 150,
        updatedAt: 150,
      });

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
    await expect(
      fetchJson(
        `${server.baseUrl}/simulations/sim-1/partitions/world-main/branch-plans?agentId=agent-1&limit=1`,
      ),
    ).resolves.toMatchObject([
      {
        agentId: 'agent-1',
        plan: {
          objective: 'develop education',
        },
      },
    ]);

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
      workerId: 'worker-dead',
      attemptNumber: 1,
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
    localRepairAttemptCount: 0,
    localRepairAcceptedCount: 0,
    localRepairRejectedCount: 0,
    localRepairSkippedCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    simulatorRolloutEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    localRepairAcceptedRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
    simulatorRolloutCoverageRatio: traceCount === 0 ? 0 : 1,
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
