import { InMemoryBranchPlanRepository } from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  asMemoryRecordId,
  createShortTermMemoryRecord,
  type LongHorizonObjective,
  type LongTermAgentProfile,
} from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldAgentState } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createDefaultAutonomousObjective,
  createDefaultAutonomousObjectiveProposal,
  renewMissingActiveObjectives,
} from './index';

const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');

describe('worker objective renewal', () => {
  test('proposes a deterministic study objective for low-education agents', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    expect(
      createDefaultAutonomousObjective({
        agentId: agentA,
        agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
        projection,
        intentionState: {
          agentId: agentA,
          completedObjectives: [],
          scheduledIntentions: [],
          updatedAt: 0,
        },
        longTermProfile: createProfile(agentA),
        shortTermMemoryContext: [],
        issuedAt: 100,
      }),
    ).toEqual({
      id: 'auto-objective-agent-a-100',
      agentId: agentA,
      statement: 'Improve education to qualify for better town opportunities.',
      priority: 2,
      source: 'agent',
      affinityTags: ['study', 'education'],
      createdAt: 100,
      updatedAt: 100,
    });
  });

  test('renews missing active objectives and saves durable branch plans', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([
      createAgent({ agentId: agentA, educationScore: 12 }),
      createAgent({ agentId: agentB, educationScore: 50 }),
    ]);
    const existingObjective = createObjective(agentB, 'objective-existing');
    await intentionRepository.setObjective(agentB, existingObjective);

    await expect(
      renewMissingActiveObjectives({
        projection,
        intentionRepository,
        longTermProfileRepository,
        shortTermMemoryRepository,
        planRepository,
        issuedAt: 100,
      }),
    ).resolves.toEqual([
      {
        agentId: agentA,
        objectiveId: 'auto-objective-agent-a-100',
        planId: 'auto-objective-agent-a-100',
        decisionTrace: {
          agentId: agentA,
          objectiveId: 'auto-objective-agent-a-100',
          selectedCandidateId: 'education-growth',
          rationale: 'Education score is below the threshold for better town opportunities.',
          score: 40.88,
          shortTermMemoryContextIds: [],
          profileEntryKeys: [],
          profileEvidenceRecordIds: [],
          issuedAt: 100,
        },
      },
    ]);
    await expect(intentionRepository.getOrCreate(agentA)).resolves.toMatchObject({
      activeObjective: {
        id: 'auto-objective-agent-a-100',
        statement: 'Improve education to qualify for better town opportunities.',
      },
    });
    await expect(
      planRepository.require({
        planId: 'auto-objective-agent-a-100',
        agentId: agentA,
      }),
    ).resolves.toMatchObject({
      planId: 'auto-objective-agent-a-100',
      agentId: agentA,
      plan: {
        objective: 'Improve education to qualify for better town opportunities.',
      },
      createdAt: 100,
      updatedAt: 100,
    });
    await expect(intentionRepository.getOrCreate(agentB)).resolves.toMatchObject({
      activeObjective: existingObjective,
    });
  });

  test('uses recent failed memories to recover before pursuing education growth', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [
        createMemory({
          id: 'memory-work-failed',
          agentId: agentA,
          status: 'failed',
          summary: 'Work failed because the agent was too tired and low on energy.',
          tags: ['work', 'failed', 'energy'],
          importanceScore: 0.95,
        }),
      ],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      id: 'auto-objective-agent-a-100',
      agentId: agentA,
      statement: 'Recover from recent setbacks before pursuing new growth.',
      priority: 3,
      source: 'agent',
      affinityTags: ['recover', 'maintain', 'health', 'energy'],
    });
  });

  test('proposes physiology maintenance with satiety affinity for hungry agents', () => {
    const projection = createProjection([
      createAgent({ agentId: agentA, educationScore: 150, balance: 200, satiety: 10 }),
    ]);

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      statement: 'Maintain energy, satiety, and health before pursuing growth.',
      affinityTags: ['maintain', 'health', 'energy', 'satiety'],
    });
  });

  test('explains recent failed memory recovery objective decisions', () => {
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

    const proposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [
        createMemory({
          id: 'memory-work-failed',
          agentId: agentA,
          status: 'failed',
          summary: 'Work failed because the agent was too tired and low on energy.',
          tags: ['work', 'failed', 'energy'],
          importanceScore: 0.95,
        }),
      ],
      issuedAt: 100,
    });

    expect(proposal.objective).toMatchObject({
      id: 'auto-objective-agent-a-100',
      statement: 'Recover from recent setbacks before pursuing new growth.',
    });
    expect(proposal.decisionTrace).toEqual({
      agentId: agentA,
      objectiveId: 'auto-objective-agent-a-100',
      selectedCandidateId: 'recent-setback-recovery',
      rationale: 'Recent failed memory suggests recovery before new growth.',
      score: 83.5,
      shortTermMemoryContextIds: ['memory-work-failed'],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
      issuedAt: 100,
    });
  });

  test('can choose a profile-aligned routine when no urgent pressure exists', () => {
    const projection = createProjection([
      createAgent({
        agentId: agentA,
        educationScore: 150,
        balance: 200,
      }),
    ]);

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA, {
        habits: [
          {
            key: 'creative-routine',
            statement: 'Keeps a creative studio routine after basic needs are stable.',
            confidence: 0.9,
            updatedAt: 80,
            provenanceRecordIds: [],
          },
        ],
      }),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      id: 'auto-objective-agent-a-100',
      agentId: agentA,
      statement: 'Maintain a creative routine aligned with long-term profile.',
      priority: 1,
      source: 'agent',
      affinityTags: ['maintain', 'routine', 'profile', 'creative'],
    });
  });

  test('explains profile-aligned routine decisions with profile provenance', () => {
    const projection = createProjection([
      createAgent({
        agentId: agentA,
        educationScore: 150,
        balance: 200,
      }),
    ]);

    const proposal = createDefaultAutonomousObjectiveProposal({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [],
        scheduledIntentions: [],
        updatedAt: 0,
      },
      longTermProfile: createProfile(agentA, {
        habits: [
          {
            key: 'creative-routine',
            statement: 'Keeps a creative studio routine after basic needs are stable.',
            confidence: 0.9,
            updatedAt: 80,
            provenanceRecordIds: [
              asMemoryRecordId('reflection-creative-1'),
              asMemoryRecordId('reflection-creative-2'),
            ],
          },
        ],
      }),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect(proposal.objective).toMatchObject({
      id: 'auto-objective-agent-a-100',
      statement: 'Maintain a creative routine aligned with long-term profile.',
    });
    expect(proposal.decisionTrace).toEqual({
      agentId: agentA,
      objectiveId: 'auto-objective-agent-a-100',
      selectedCandidateId: 'profile-creative',
      rationale: 'Long-term profile suggests maintaining a creative routine.',
      score: 24,
      shortTermMemoryContextIds: [],
      profileEntryKeys: ['creative-routine'],
      profileEvidenceRecordIds: ['reflection-creative-1', 'reflection-creative-2'],
      issuedAt: 100,
    });
  });

  test('does not immediately repeat a just-completed objective when another candidate is viable', () => {
    const projection = createProjection([
      createAgent({
        agentId: agentA,
        educationScore: 12,
        balance: 20,
      }),
    ]);
    const completedStudyObjective: LongHorizonObjective = {
      id: 'completed-study',
      agentId: agentA,
      statement: 'Improve education to qualify for better town opportunities.',
      priority: 2,
      source: 'agent',
      affinityTags: ['study', 'education'],
      createdAt: 50,
      updatedAt: 50,
    };

    const objective = createDefaultAutonomousObjective({
      agentId: agentA,
      agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
      projection,
      intentionState: {
        agentId: agentA,
        completedObjectives: [
          {
            objective: completedStudyObjective,
            completedAt: 90,
            reason: 'plan-completed',
            planId: completedStudyObjective.id,
          },
        ],
        scheduledIntentions: [],
        updatedAt: 90,
      },
      longTermProfile: createProfile(agentA),
      shortTermMemoryContext: [],
      issuedAt: 100,
    });

    expect(objective).toMatchObject({
      id: 'auto-objective-agent-a-100',
      agentId: agentA,
      statement: 'Earn enough money to stay economically stable.',
      priority: 2,
      source: 'agent',
      affinityTags: ['work', 'income'],
    });
  });

  test('passes retrieved short-term memory context to custom objective proposers', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);
    await shortTermMemoryRepository.append(
      createMemory({
        id: 'memory-study-observed',
        agentId: agentA,
        status: 'observed',
        summary: 'The agent noticed the school was open and easy to reach.',
        tags: ['study', 'education'],
        importanceScore: 0.8,
      }),
    );
    const seenMemoryIds: string[][] = [];

    await renewMissingActiveObjectives({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      issuedAt: 100,
      objectiveProposer: (input) => {
        seenMemoryIds.push(input.shortTermMemoryContext.map((record) => record.id));
        return createObjective(input.agentId, 'objective-from-custom-proposer');
      },
    });

    expect(seenMemoryIds).toEqual([['memory-study-observed']]);
  });

  test('returns and emits objective renewal decision traces', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);
    const traces: unknown[] = [];

    const result = await renewMissingActiveObjectives({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      planRepository,
      issuedAt: 100,
      objectiveProposer: (input) => createObjective(input.agentId, 'objective-from-custom-proposer'),
      objectiveRenewalTraceSink: {
        record: (trace) => {
          traces.push(trace);
        },
      },
    });

    expect(result).toEqual([
      {
        agentId: agentA,
        objectiveId: 'objective-from-custom-proposer',
        planId: 'objective-from-custom-proposer',
        decisionTrace: {
          agentId: agentA,
          objectiveId: 'objective-from-custom-proposer',
          selectedCandidateId: 'custom-proposer',
          rationale: 'Objective was produced by a custom proposer without decision metadata.',
          score: 0,
          shortTermMemoryContextIds: [],
          profileEntryKeys: [],
          profileEvidenceRecordIds: [],
          issuedAt: 100,
        },
      },
    ]);
    expect(traces).toEqual([result[0]?.decisionTrace]);
  });
});

function createProjection(agents: readonly WorldAgentState[]) {
  return createWorldProjection({ agents });
}

function createAgent(input: {
  readonly agentId: AgentId;
  readonly energy?: number;
  readonly satiety?: number;
  readonly health?: number;
  readonly educationScore?: number;
  readonly balance?: number;
}): WorldAgentState {
  return {
    agentId: input.agentId,
    physiology: {
      energy: input.energy ?? 50,
      satiety: input.satiety ?? 80,
      health: input.health ?? 100,
    },
    educationScore: input.educationScore ?? 0,
    balance: input.balance ?? 100,
    residentialTier: 1,
    job: null,
    inventory: {},
  };
}

function createObjective(agentId: AgentId, id: string): LongHorizonObjective {
  return {
    id,
    agentId,
    statement: `Existing objective ${id}.`,
    priority: 1,
    source: 'human',
    affinityTags: ['study'],
    createdAt: 50,
    updatedAt: 50,
  };
}

function createProfile(
  agentId: AgentId,
  partial: Partial<Omit<LongTermAgentProfile, 'agentId'>> = {},
): LongTermAgentProfile {
  return {
    agentId,
    beliefs: [],
    habits: [],
    values: [],
    personality: [],
    socialRecords: [],
    ...partial,
  };
}

function createMemory(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly status: 'succeeded' | 'failed' | 'repaired' | 'observed';
  readonly summary: string;
  readonly tags: readonly string[];
  readonly importanceScore: number;
}) {
  return createShortTermMemoryRecord({
    id: input.id,
    agentId: input.agentId,
    kind: 'action',
    status: input.status,
    summary: input.summary,
    occurredAt: 90,
    importanceScore: input.importanceScore,
    source: { eventIds: [] },
    tags: input.tags,
  });
}
