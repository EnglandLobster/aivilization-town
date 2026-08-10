import {
  InMemoryBranchPlanProgressRepository,
  InMemoryBranchPlanRepository,
  createBranchPlan,
  type BranchPlanProgressRepository,
  type BranchPlanRepository,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  type AgentIntentionRepository,
  type LongHorizonObjective,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createPlanningSessionPublicationPolicyManifest,
  publishPlanningSession,
} from './planningSessionPublication';

const agentId = asAgentId('agent-publication');

describe('planning session publication', () => {
  test('persists plan and initial progress before publishing the active objective', async () => {
    const calls: string[] = [];
    const intentions = new InMemoryAgentIntentionRepository();
    const plans = new InMemoryBranchPlanRepository();
    const progress = new InMemoryBranchPlanProgressRepository();
    const objective = createObjective();
    const planRecord = createPlanRecord(objective);

    const result = await publishPlanningSession({
      objective,
      publishedAt: 100,
      intentionRepository: recordingIntentions(intentions, calls),
      planRecord,
      planRepository: recordingPlans(plans, calls),
      planProgressRepository: recordingProgress(progress, calls),
    });

    expect(calls).toEqual(['plan', 'progress', 'objective']);
    await expect(plans.get({ planId: objective.id, agentId })).resolves.toEqual(planRecord);
    await expect(progress.get({ planId: objective.id, agentId })).resolves.toMatchObject({
      planId: objective.id,
      agentId,
      updatedAt: 100,
    });
    expect(result.intentionState.activeObjective).toEqual(objective);
  });

  test('does not publish an active objective when a dependency write fails', async () => {
    const intentions = new InMemoryAgentIntentionRepository();
    const objective = createObjective();

    await expect(
      publishPlanningSession({
        objective,
        publishedAt: 100,
        intentionRepository: intentions,
        planRecord: createPlanRecord(objective),
        planRepository: {
          get: () => Promise.resolve(undefined),
          require: () => Promise.reject(new Error('not used')),
          query: () => Promise.resolve([]),
          save: () => Promise.reject(new Error('disk unavailable')),
        },
      }),
    ).rejects.toThrow('disk unavailable');

    expect((await intentions.getOrCreate(agentId)).activeObjective).toBeUndefined();
  });

  test('leaves a support plan orphaned but the objective unpublished when progress fails', async () => {
    const intentions = new InMemoryAgentIntentionRepository();
    const plans = new InMemoryBranchPlanRepository();
    const objective = createObjective();
    const planRecord = createPlanRecord(objective);

    await expect(
      publishPlanningSession({
        objective,
        publishedAt: 100,
        intentionRepository: intentions,
        planRecord,
        planRepository: plans,
        planProgressRepository: {
          get: () => Promise.resolve(undefined),
          getOrCreate: () => Promise.reject(new Error('not used')),
          save: () => Promise.reject(new Error('progress disk unavailable')),
        },
      }),
    ).rejects.toThrow('progress disk unavailable');

    await expect(plans.get({ planId: objective.id, agentId })).resolves.toEqual(planRecord);
    expect((await intentions.getOrCreate(agentId)).activeObjective).toBeUndefined();
  });

  test('versions the dependency-first, publish-last consistency boundary', () => {
    expect(createPlanningSessionPublicationPolicyManifest()).toEqual({
      policyVersion: 'planning-session-publication-v1',
      source: 'repository-design',
      commitMarker: 'active-objective-intention-write',
      dependencyOrder: 'plan-then-initial-progress-then-active-objective',
      initialProgressRule: 'materialize-with-new-durable-plan-when-repository-configured',
      preCommitFailureRule: 'active-objective-remains-unpublished',
      orphanSupportRowRule: 'auditable-and-ignored-without-active-objective-reference',
      crossFileAtomicityClaimed: false,
    });
  });
});

function createObjective(): LongHorizonObjective {
  return {
    id: 'objective-publication-1',
    agentId,
    statement: 'Publish a complete planning session.',
    priority: 2,
    source: 'agent',
    affinityTags: ['planning'],
    createdAt: 100,
    updatedAt: 100,
  };
}

function createPlanRecord(objective: LongHorizonObjective) {
  return {
    planId: objective.id,
    agentId: objective.agentId,
    plan: createBranchPlan({
      objective: objective.statement,
      branches: [
        {
          id: 'publish',
          objective: 'Publish dependencies first.',
          subtasks: [{ id: 'commit', description: 'Commit objective last.', basePriority: 1 }],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function recordingIntentions(
  repository: InMemoryAgentIntentionRepository,
  calls: string[],
): AgentIntentionRepository {
  return {
    getOrCreate: (id) => repository.getOrCreate(id),
    save: (state) => repository.save(state),
    setObjective: (id, objective) => {
      calls.push('objective');
      return repository.setObjective(id, objective);
    },
    upsertScheduledIntentions: (id, scheduled) =>
      repository.upsertScheduledIntentions(id, scheduled),
    completeObjective: (id, input) => repository.completeObjective(id, input),
  };
}

function recordingPlans(
  repository: InMemoryBranchPlanRepository,
  calls: string[],
): BranchPlanRepository {
  return {
    get: (input) => repository.get(input),
    require: (input) => repository.require(input),
    query: (input) => repository.query(input),
    save: (record) => {
      calls.push('plan');
      return repository.save(record);
    },
  };
}

function recordingProgress(
  repository: InMemoryBranchPlanProgressRepository,
  calls: string[],
): BranchPlanProgressRepository {
  return {
    get: (input) => repository.get(input),
    getOrCreate: (input) => repository.getOrCreate(input),
    save: (record) => {
      calls.push('progress');
      return repository.save(record);
    },
  };
}
