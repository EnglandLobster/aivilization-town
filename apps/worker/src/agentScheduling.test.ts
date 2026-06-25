import {
  createBranchPlan,
  createBranchPlanProgress,
  InMemoryBranchPlanRepository,
  InMemoryBranchPlanProgressRepository,
  markSubtaskCompleted,
  type AtomicActionProposal,
  type DomainMicroPlanner,
  type ReactiveCorrector,
  type ReplanningDecider,
} from '@aivilization/agent-runtime';
import { createAmmPool } from '@aivilization/economy';
import {
  asMemoryRecordId,
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  type LongTermAgentProfile,
} from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { buildWorkerTickAgentsFromActivePlans } from './index';

const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');
const agentC = asAgentId('agent-c');
const agentD = asAgentId('agent-d');
const agentE = asAgentId('agent-e');

describe('worker agent scheduling', () => {
  test('builds deterministic tick agent inputs from active objectives and saved plans', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const replanningPolicy = {
      consecutiveFailureThreshold: 2,
      majorContextShift: {
        key: 'profile-recovery-drill',
        reason: 'profile recovery drill requires a fresh plan',
      },
    } as const;
    const reactiveCorrector: ReactiveCorrector = () =>
      Promise.resolve({
        action: undefined,
        trace: {
          status: 'accepted',
          source: 'llm',
          decision: {
            kind: 'no-correction',
            rationale: 'test corrector',
            evidenceRecordIds: [],
          },
        },
      });
    const replanningDecider: ReplanningDecider = (input) => ({
      decision: { kind: 'none' },
      trace: {
        status: 'accepted',
        source: 'llm',
        requestId: `test-replanning:${input.agentId}:${input.selectedSubtask.subtaskId}:${input.issuedAt}`,
        decision: { kind: 'none' },
      },
    });
    const studyRuntime = {
      ...createRuntimeBinding('study'),
      replanningPolicy,
      reactiveCorrector,
      replanningDecider,
    };
    const tradeRuntime = createRuntimeBinding('trade');
    const projection = createWorldProjection({
      agents: [
        createProjectedAgent({
          agentId: agentE,
          energy: 80,
          satiety: 60,
          health: 100,
          educationScore: 30,
          balance: 50,
          residentialTier: 1,
          job: null,
          inventory: {},
        }),
        createProjectedAgent({
          agentId: agentA,
          energy: 40,
          satiety: 70,
          health: 90,
          educationScore: 12,
          balance: 300,
          residentialTier: 2,
          job: 'Student',
          inventory: { Fish: 2, Book: 1 },
        }),
        createProjectedAgent({ agentId: agentB }),
        createProjectedAgent({ agentId: agentC }),
        createProjectedAgent({ agentId: agentD }),
      ],
      marketPools: [
        createAmmPool({ commodity: 'Fish', commodityReserve: 10, currencyReserve: 3045 }),
      ],
    });

    await intentionRepository.setObjective(
      agentA,
      createObjective({
        id: 'objective-study',
        agentId: agentA,
        statement: 'Study before working.',
        priority: 3,
        affinityTags: ['study', 'education'],
      }),
    );
    await intentionRepository.setObjective(
      agentC,
      createObjective({
        id: 'objective-missing-plan',
        agentId: agentC,
        statement: 'This has no plan.',
        priority: 1,
        affinityTags: ['missing'],
      }),
    );
    await intentionRepository.setObjective(
      agentD,
      createObjective({
        id: 'objective-no-runtime',
        agentId: agentD,
        statement: 'This has no runtime binding.',
        priority: 1,
        affinityTags: ['skip'],
      }),
    );
    await intentionRepository.setObjective(
      agentE,
      createObjective({
        id: 'objective-trade',
        agentId: agentE,
        statement: 'Trade for food.',
        priority: 2,
        affinityTags: ['trade', 'food'],
      }),
    );
    await planRepository.save(createPlanRecord({ planId: 'objective-study', agentId: agentA }));
    await planRepository.save(
      createPlanRecord({ planId: 'objective-no-runtime', agentId: agentD }),
    );
    await planRepository.save(createPlanRecord({ planId: 'objective-trade', agentId: agentE }));

    const agents = await buildWorkerTickAgentsFromActivePlans({
      projection,
      intentionRepository,
      planRepository,
      resolveRuntime: ({ agentId }) => {
        if (agentId === agentA) {
          return studyRuntime;
        }
        if (agentId === agentE) {
          return tradeRuntime;
        }
        return undefined;
      },
    });

    expect(agents.map((agent) => agent.agentId)).toEqual([agentA, agentE]);
    expect(agents[0]).toMatchObject({
      agentId: agentA,
      planId: 'objective-study',
      observedStateSummary:
        'energy=40 satiety=70 health=90 education=12 balance=300 residentialTier=2 job=Student inventory=Book:1,Fish:2',
      signals: [
        { key: 'study', weight: 3 },
        { key: 'education', weight: 3 },
      ],
    });
    expect(agents[0]?.microPlanners).toBe(studyRuntime.microPlanners);
    expect(agents[0]?.simulate).toBe(studyRuntime.simulate);
    expect(agents[0]?.replanningPolicy).toEqual(studyRuntime.replanningPolicy);
    expect(agents[0]?.reactiveCorrector).toBe(reactiveCorrector);
    expect(agents[0]?.replanningDecider).toBe(replanningDecider);
    expect(agents[0]?.worldDecisionContext).toMatchObject({
      agent: {
        agentId: agentA,
        educationScore: 12,
        balance: 300,
        residentialTier: 2,
        job: 'Student',
        inventory: { Book: 1, Fish: 2 },
      },
      market: {
        spotPrices: [{ commodity: 'Fish', spotPrice: 304.5 }],
      },
    });
    expect(agents[1]).toMatchObject({
      agentId: agentE,
      planId: 'objective-trade',
      observedStateSummary:
        'energy=80 satiety=60 health=100 education=30 balance=50 residentialTier=1 job=unemployed inventory=empty',
      signals: [
        { key: 'trade', weight: 2 },
        { key: 'food', weight: 2 },
      ],
    });
    expect(agents[1]?.microPlanners).toBe(tradeRuntime.microPlanners);
    expect(agents[1]?.simulate).toBe(tradeRuntime.simulate);
  });

  test('skips active durable plans with no selectable subtasks', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const planProgressRepository = new InMemoryBranchPlanProgressRepository();
    const projection = createWorldProjection({
      agents: [createProjectedAgent({ agentId: agentA })],
    });
    await intentionRepository.setObjective(
      agentA,
      createObjective({
        id: 'objective-study',
        agentId: agentA,
        statement: 'Study before working.',
        priority: 3,
        affinityTags: ['study'],
      }),
    );
    await planRepository.save(createPlanRecord({ planId: 'objective-study', agentId: agentA }));
    await planProgressRepository.save(
      markSubtaskCompleted(
        createBranchPlanProgress({
          planId: 'objective-study',
          agentId: agentA,
          createdAt: 100,
        }),
        { subtaskId: 'pursue-objective', completedAt: 200 },
      ),
    );

    const agents = await buildWorkerTickAgentsFromActivePlans({
      projection,
      intentionRepository,
      planRepository,
      planProgressRepository,
      resolveRuntime: () => {
        throw new Error('runtime should not be resolved for completed plans');
      },
    });

    expect(agents).toEqual([]);
  });

  test('attaches configured memory retrieval budgets to scheduled tick agents', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createWorldProjection({
      agents: [createProjectedAgent({ agentId: agentA })],
    });
    await intentionRepository.setObjective(
      agentA,
      createObjective({
        id: 'objective-study',
        agentId: agentA,
        statement: 'Study before working.',
        priority: 3,
        affinityTags: ['study'],
      }),
    );
    await planRepository.save(createPlanRecord({ planId: 'objective-study', agentId: agentA }));

    const agents = await buildWorkerTickAgentsFromActivePlans({
      projection,
      intentionRepository,
      planRepository,
      memoryRetrievalLimit: 8,
      memoryRetrievalCandidateLimit: 24,
      resolveRuntime: () => createRuntimeBinding('study'),
    });

    expect(agents).toHaveLength(1);
    expect(agents[0]?.memoryRetrievalLimit).toBe(8);
    expect(agents[0]?.memoryRetrievalCandidateLimit).toBe(24);
  });

  test('passes long-term profile context into runtime resolution when available', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const planRepository = new InMemoryBranchPlanRepository();
    const projection = createWorldProjection({
      agents: [createProjectedAgent({ agentId: agentA })],
    });
    await intentionRepository.setObjective(
      agentA,
      createObjective({
        id: 'objective-social',
        agentId: agentA,
        statement: 'Coordinate with the town.',
        priority: 3,
        affinityTags: ['social'],
      }),
    );
    await planRepository.save(createPlanRecord({ planId: 'objective-social', agentId: agentA }));
    await longTermProfileRepository.applyPatches(agentA, [
      {
        id: 'ltm-patch-agent-a-value-community-100',
        agentId: agentA,
        section: 'values',
        key: 'community-cooperation',
        statement: 'Agent values cooperative community routines.',
        confidence: 0.9,
        provenanceRecordIds: [asMemoryRecordId('memory-social-value-1')],
        proposedAt: 100,
      },
    ]);
    let observedProfile: LongTermAgentProfile | undefined;

    await buildWorkerTickAgentsFromActivePlans({
      projection,
      intentionRepository,
      longTermProfileRepository,
      planRepository,
      resolveRuntime: ({ longTermProfile }) => {
        observedProfile = longTermProfile;
        return createRuntimeBinding('social');
      },
    });

    expect(observedProfile?.values).toEqual([
      expect.objectContaining({
        key: 'community-cooperation',
        statement: 'Agent values cooperative community routines.',
      }),
    ]);
  });
});

function createProjectedAgent(input: {
  readonly agentId: typeof agentA;
  readonly energy?: number;
  readonly satiety?: number;
  readonly health?: number;
  readonly educationScore?: number;
  readonly balance?: number;
  readonly residentialTier?: number;
  readonly job?: string | null;
  readonly inventory?: Readonly<Record<string, number>>;
}) {
  return {
    agentId: input.agentId,
    physiology: {
      energy: input.energy ?? 50,
      satiety: input.satiety ?? 50,
      health: input.health ?? 100,
    },
    educationScore: input.educationScore ?? 0,
    balance: input.balance ?? 0,
    residentialTier: input.residentialTier ?? 1,
    job: input.job ?? null,
    inventory: input.inventory ?? {},
  };
}

function createObjective(input: {
  readonly id: string;
  readonly agentId: typeof agentA;
  readonly statement: string;
  readonly priority: number;
  readonly affinityTags: readonly string[];
}) {
  return {
    id: input.id,
    agentId: input.agentId,
    statement: input.statement,
    priority: input.priority,
    source: 'human' as const,
    affinityTags: input.affinityTags,
    createdAt: 100,
    updatedAt: 100,
  };
}

function createPlanRecord(input: { readonly planId: string; readonly agentId: typeof agentA }) {
  return {
    planId: input.planId,
    agentId: input.agentId,
    plan: createBranchPlan({
      objective: input.planId,
      branches: [
        {
          id: 'primary-objective',
          objective: input.planId,
          subtasks: [{ id: 'pursue-objective', description: 'pursue objective', basePriority: 5 }],
        },
      ],
    }),
    createdAt: 100,
    updatedAt: 100,
  };
}

function createRuntimeBinding(domain: string) {
  const action: AtomicActionProposal = {
    id: `${domain}-action`,
    description: `${domain} action`,
    commandType: 'AgentStudy',
    payload: { durationSeconds: 60, educationRatePerSecond: 1 },
  };
  const planner: DomainMicroPlanner = {
    domain,
    supports: () => true,
    propose: () => [action],
  };
  return {
    microPlanners: [planner],
    simulate: ({ action: candidate }: { readonly action: AtomicActionProposal }) => ({
      status: 'accepted' as const,
      action: candidate,
    }),
  };
}
