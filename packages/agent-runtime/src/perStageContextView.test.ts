import {
  asMemoryRecordId,
  createShortTermMemoryRecord,
  type AgentIntentionState,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createPerStageContextView,
  createPerStageContextViewTrace,
  PER_STAGE_CONTEXT_SALIENCE_MAX_COUNT,
} from './perStageContextView';
import {
  WORLD_DECISION_CONTEXT_VIEW_VERSION,
  type WorldDecisionContext,
} from './worldDecisionContext';

const agentId = asAgentId('agent-1');
const targetAgentId = asAgentId('agent-2');

describe('per-stage context view', () => {
  test('removes rules, enterprises, and the directory from ranking while retaining derived salience', () => {
    const view = createPerStageContextView({
      stage: 'subtask-prioritization',
      context: createCompleteContext(),
      at: 100,
    });

    expect(view).toMatchObject({
      contextViewVersion: WORLD_DECISION_CONTEXT_VIEW_VERSION,
      stage: 'subtask-prioritization',
      agent: { agentId },
      market: { spotPrices: [{ commodity: 'Fish', spotPrice: 12 }] },
      salience: [
        {
          kind: 'survival',
          source: 'critical-threshold',
          sourceId: 'health',
        },
        {
          kind: 'survival',
          source: 'critical-threshold',
          sourceId: 'energy',
        },
        {
          kind: 'opportunity',
          sourceId: 'occupation:Carpenter',
        },
      ],
    });
    expect(view.rules).toBeUndefined();
    expect(view.enterprises).toBeUndefined();
    expect(view.society).toBeUndefined();
  });

  test('limits dialogue to identity, relations, relevant memories, obligations, and the counterpart row', () => {
    const view = createPerStageContextView({
      stage: 'social-dialogue',
      context: createCompleteContext(),
      at: 100,
      targetAgentId,
      intentionState: createIntentionState(),
      shortTermMemoryContext: [
        createMemory('social-memory', 'social-interaction', 0.9, 'Remembered a useful talk.'),
        createMemory('ordinary-memory', 'observation', 0.9, 'Saw a market opening.'),
      ],
    });

    expect(view.agent).toEqual({
      agentId,
      locationId: 'square',
      displayName: 'Ari',
      job: null,
      relations: [
        {
          agentId: targetAgentId,
          direction: 'outgoing',
          relationLabel: 'friend',
          relationScore: 4,
          attitudeScore: 3,
          interactionCount: 2,
        },
      ],
    });
    expect(view.society?.agents.map((entry) => entry.agentId)).toEqual([targetAgentId]);
    expect(view.salience.map((entry) => entry.kind)).toEqual([
      'obligation',
      'memory',
      'relationship',
    ]);
    expect(view.market).toBeUndefined();
    expect(view.rules).toBeUndefined();
    expect(view.enterprises).toBeUndefined();
    expect(view.townPulse).toBeUndefined();
  });

  test('keeps action-critical sections and traces the actual visible view', () => {
    const view = createPerStageContextView({
      stage: 'action-sequence-generation',
      context: createCompleteContext(),
      at: 100,
    });
    const trace = createPerStageContextViewTrace(view);

    expect(view.rules?.occupations).toHaveLength(1);
    expect(view.enterprises).toHaveLength(1);
    expect(trace).toMatchObject({
      contextViewVersion: WORLD_DECISION_CONTEXT_VIEW_VERSION,
      contextViewStage: 'action-sequence-generation',
      visibleContextSections: [
        'salience',
        'agent',
        'market',
        'townPulse',
        'society',
        'weather',
        'enterprises',
        'rules',
      ],
      salienceCount: 3,
      salienceKinds: ['survival', 'opportunity'],
      societyAgentCount: 2,
      enterpriseCount: 1,
      occupationRuleCount: 1,
    });
  });

  test('uses existing importance values deterministically and applies the hard cap', () => {
    const records = Array.from({ length: 8 }, (_, index) =>
      createMemory(
        `memory-${index}`,
        'observation',
        index === 7 ? 0.79 : 0.8 + index * 0.01,
        ` Memory ${index}\u0000 with   whitespace `,
      ),
    );
    const input = {
      stage: 'reaction-evaluation' as const,
      context: createCompleteContext({ healthy: true, noOpportunities: true }),
      at: 100,
      shortTermMemoryContext: records,
    };

    const first = createPerStageContextView(input);
    const second = createPerStageContextView(input);
    expect(first).toEqual(second);
    expect(first.salience).toHaveLength(PER_STAGE_CONTEXT_SALIENCE_MAX_COUNT);
    expect(first.salience.map((entry) => entry.sourceId)).toEqual([
      asMemoryRecordId('memory-6'),
      asMemoryRecordId('memory-5'),
      asMemoryRecordId('memory-4'),
      asMemoryRecordId('memory-3'),
      asMemoryRecordId('memory-2'),
      asMemoryRecordId('memory-1'),
    ]);
    expect(first.salience[0]?.summary).toBe('Memory 6 with whitespace');
  });

  test('surfaces assigned, assignable, and due social matters as deterministic obligations', () => {
    const context: WorldDecisionContext = {
      ...createCompleteContext({ healthy: true, noOpportunities: true }),
      matters: [
        {
          ...createMatter('matter-assigned', 'assignee', 'assigned', 500),
          initiatorAgentId: asAgentId('agent-3'),
        },
        {
          ...createMatter('matter-needs-assignment', 'initiator', 'collecting', 600),
          responses: [{ responderAgentId: targetAgentId, decision: 'accept', respondedAt: 10 }],
        },
        {
          ...createMatter('matter-due', 'responder', 'open', 700),
          initiatorAgentId: asAgentId('agent-3'),
          myResponse: 'accept',
          responses: [{ responderAgentId: agentId, decision: 'accept', respondedAt: 20 }],
        },
      ],
    };

    const ranking = createPerStageContextView({
      stage: 'subtask-prioritization',
      context,
      at: 100,
    });
    expect(ranking.matters).toHaveLength(3);
    expect(ranking.salience).toMatchObject([
      { kind: 'obligation', source: 'social-matter', sourceId: 'assigned:matter-assigned' },
      {
        kind: 'obligation',
        source: 'social-matter',
        sourceId: 'assignment:matter-needs-assignment',
      },
      { kind: 'obligation', source: 'social-matter', sourceId: 'due:matter-due' },
    ]);

    const dialogue = createPerStageContextView({
      stage: 'social-dialogue',
      context,
      at: 100,
      targetAgentId,
    });
    expect(dialogue.matters?.map((matter) => matter.matterId)).toEqual(['matter-needs-assignment']);

    const trace = createPerStageContextViewTrace(ranking);
    expect(trace).toMatchObject({ matterCount: 3, obligationMatterCount: 2 });
    expect(trace.visibleContextSections).toContain('matters');
  });
});

function createMatter(
  matterId: string,
  role: 'assignee' | 'initiator' | 'responder' | 'available',
  status: 'open' | 'collecting' | 'assigned' | 'executing',
  expiresAt: number,
): NonNullable<WorldDecisionContext['matters']>[number] {
  return {
    matterId,
    kind: 'help-request',
    status,
    role,
    initiatorAgentId: role === 'initiator' ? agentId : targetAgentId,
    topic: `Topic ${matterId}`,
    statement: `Statement ${matterId}`,
    ...(role === 'assignee' ? { assigneeAgentId: agentId } : {}),
    responses: [],
    createdAt: 0,
    expiresAt,
  };
}

function createCompleteContext(
  options: { readonly healthy?: boolean; readonly noOpportunities?: boolean } = {},
): WorldDecisionContext {
  return {
    agent: {
      agentId,
      locationId: 'square',
      displayName: 'Ari',
      physiology: options.healthy
        ? { energy: 80, satiety: 80, health: 80 }
        : { energy: 10, satiety: 80, health: 10 },
      educationScore: 40,
      balance: 100,
      residentialTier: 1,
      job: null,
      inventory: { Fish: 2 },
      relations: [
        {
          agentId: targetAgentId,
          direction: 'outgoing',
          relationLabel: 'friend',
          relationScore: 4,
          attitudeScore: 3,
          interactionCount: 2,
        },
      ],
    },
    market: { spotPrices: [{ commodity: 'Fish', spotPrice: 12 }] },
    townPulse: [{ kind: 'arrival', atMs: 80, subjectAgentId: targetAgentId }],
    society: {
      directoryId: 'directory-1',
      simulationId: 'simulation-1',
      partitionBoundaries: [],
      agents: [createSocietyAgent(agentId, 'Ari'), createSocietyAgent(targetAgentId, 'Bea')],
    },
    weather: { current: 'clear', since: 0 },
    enterprises: [
      {
        enterpriseId: 'enterprise-1',
        name: 'Workshop',
        ownerAgentId: agentId,
        occupationName: 'Carpenter',
        balance: 100,
        inventory: {},
        maxEmployees: 2,
        employeeAgentIds: [],
        status: 'active',
        cumulativeSales: 0,
        cumulativePurchases: 0,
        cumulativeWages: 0,
      },
    ],
    rules: {
      criticalThresholds: { energy: 20, health: 30 },
      occupations: [
        {
          occupationName: 'Carpenter',
          jobTier: 2,
          baseWage: 10,
          effectiveEducationThreshold: 20,
          requiredResidentialTier: 1,
          prerequisiteCommodity: null,
          eligible: !options.noOpportunities,
          rejectionReasons: options.noOpportunities ? ['disabled for test'] : [],
        },
      ],
      production: [],
    },
  };
}

function createSocietyAgent(id: typeof agentId, displayName: string) {
  return {
    agentId: id,
    ownerPartitionKey: 'partition-1',
    ownerLastAppliedSequence: 1,
    locationId: 'square',
    job: null,
    residentialTier: 1,
    educationScore: 10,
    displayName,
  };
}

function createIntentionState(): AgentIntentionState {
  return {
    agentId,
    completedObjectives: [],
    scheduledIntentions: [
      {
        id: 'intention-1',
        agentId,
        description: 'Meet Bea at the square.',
        priority: 5,
        startsAt: 0,
        endsAt: 200,
        status: 'active',
        affinityTags: ['social'],
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    updatedAt: 0,
  };
}

function createMemory(
  id: string,
  kind: 'observation' | 'social-interaction',
  importanceScore: number,
  summary: string,
) {
  return createShortTermMemoryRecord({
    id,
    agentId,
    kind,
    status: 'observed',
    summary,
    occurredAt: 50,
    importanceScore,
    source: { eventIds: [] },
  });
}
