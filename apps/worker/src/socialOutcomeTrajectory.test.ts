import {
  createBranchPlan,
  type BranchPlanRecord,
  type PrioritizedSubtask,
} from '@aivilization/agent-runtime';
import {
  applyLongTermMemoryPatches,
  createEmptyLongTermAgentProfile,
  convertReflectiveInsightsToLongTermMemoryPatches,
  proposeReflectiveInsights,
  proposeSocialLongTermMemoryPatches,
} from '@aivilization/memory';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import {
  applyWorldEvent,
  createWorldProjection,
  handleAgentStartConversationCommand,
  type WorldAgentState,
  type WorldProjection,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createCanonicalDomainRuntimeRegistrations,
  createDefaultAutonomousObjectiveProposal,
} from './index';

const agentA = asAgentId('agent-a');
const agentB = asAgentId('agent-b');
const agentC = asAgentId('agent-c');
const townSquare = asLocationId('town-square');

describe('outcome-grounded social trajectory', () => {
  test('cooperation and betrayal produce different relation, identity, objective, and action traces', async () => {
    const constructive = await runTrajectory('constructive');
    const conflict = await runTrajectory('conflict');
    const adverse = await runTrajectory('adverse');

    expect(
      constructive.projection.socialRelations['agent-a->agent-b']?.relationScore,
    ).toBeGreaterThan(0);
    expect(adverse.projection.socialRelations['agent-a->agent-b']?.relationScore).toBeLessThan(0);
    expect(conflict.projection.socialRelations['agent-a->agent-b']?.relationScore).toBeGreaterThan(
      adverse.projection.socialRelations['agent-a->agent-b']?.relationScore ?? 0,
    );
    expect(constructive.profile.values.map((entry) => entry.key)).toContain(
      'community-cooperation',
    );
    expect(adverse.profile.values.map((entry) => entry.key)).toContain('verified-reciprocity');
    expect(conflict.profile.values.map((entry) => entry.key)).toContain(
      'constructive-disagreement',
    );
    expect(constructive.objective.decisionTrace.selectedCandidateId).toBe(
      'social-identity-cooperation',
    );
    expect(constructive.objective.decisionTrace.profileEvidenceRecordIds).toContain(
      'command-constructive-agent-b:memory:3',
    );
    expect(constructive.objective.decisionTrace.profileEvidenceRecordIds).toContain(
      'command-constructive-agent-c:memory:3',
    );
    expect(adverse.objective.decisionTrace.selectedCandidateId).toBe('social-identity-caution');
    expect(adverse.objective.decisionTrace.profileEvidenceRecordIds).toContain(
      'command-adverse-agent-b:memory:3',
    );
    expect(adverse.objective.decisionTrace.profileEvidenceRecordIds).toContain(
      'command-adverse-agent-c:memory:3',
    );
    expect(conflict.objective.decisionTrace.selectedCandidateId).toBe(
      'social-identity-deescalation',
    );
    expect(conflict.objective.decisionTrace.profileEvidenceRecordIds).toContain(
      'command-conflict-agent-b:memory:3',
    );
    expect(conflict.objective.decisionTrace.profileEvidenceRecordIds).toContain(
      'command-conflict-agent-c:memory:3',
    );
    expect(constructive.action.commandType).toBe('AgentStartConversation');
    expect(conflict.action.commandType).toBe('AgentStartConversation');
    expect(readStringProperty(conflict.action.payload, 'topic')).toContain('clarify disagreement');
    expect(adverse.action.commandType).toBe('AgentObserveLocation');
    expect(readStringProperty(adverse.action.payload, 'focus')).toContain('Verify commitments');
  });
});

async function runTrajectory(kind: 'constructive' | 'conflict' | 'adverse') {
  let projection = createBaseProjection();
  let nextSequence = 1;
  for (const targetAgentId of [agentB, agentC]) {
    const events = handleAgentStartConversationCommand({
      command: createCommandEnvelope({
        id: `command-${kind}-${targetAgentId}`,
        simulationId: 'sim-social-trajectory',
        actorId: agentA,
        type: 'AgentStartConversation',
        payload: {
          targetAgentId,
          topic: 'community cooperation',
          relationDelta: 1,
          attitudeDelta: 1,
          turns: [
            {
              speakerAgentId: agentA,
              utterance: 'How should we support the community?',
              intent: 'open-contextual-topic',
            },
            kind === 'constructive'
              ? {
                  speakerAgentId: targetAgentId,
                  utterance: 'I can help and work together with you.',
                  intent: 'cooperate',
                }
              : kind === 'conflict'
                ? {
                    speakerAgentId: targetAgentId,
                    utterance: 'Stay away; I will not cooperate with you.',
                    intent: 'threaten',
                  }
                : {
                    speakerAgentId: targetAgentId,
                    utterance: 'I betrayed you and broke our trust.',
                    intent: 'betray',
                  },
          ],
        },
        issuedAt: nextSequence,
      }),
      projection,
      nextSequence,
    });
    nextSequence += events.length;
    projection = events.reduce(applyWorldEvent, projection);
  }

  const records = projection.memoryRecords.filter((record) => record.agentId === agentA);
  const reflectionPatches = convertReflectiveInsightsToLongTermMemoryPatches({
    insights: proposeReflectiveInsights({
      agentId: agentA,
      records,
      minEvidenceCount: 2,
      generatedAt: 100,
    }),
  });
  const profile = applyLongTermMemoryPatches(createEmptyLongTermAgentProfile(agentA), [
    ...proposeSocialLongTermMemoryPatches({ agentId: agentA, records, proposedAt: 100 }),
    ...reflectionPatches,
  ]);
  const objective = createDefaultAutonomousObjectiveProposal({
    agentId: agentA,
    agent: requireAgent(projection, agentA),
    projection,
    intentionState: {
      agentId: agentA,
      completedObjectives: [],
      scheduledIntentions: [],
      updatedAt: 0,
    },
    longTermProfile: profile,
    shortTermMemoryContext: [],
    issuedAt: 200,
  });
  const planRecord: BranchPlanRecord = {
    planId: objective.objective.id,
    agentId: agentA,
    plan: createBranchPlan({
      objective: objective.objective.statement,
      branches: [
        {
          id: 'social-branch',
          objective: objective.objective.statement,
          subtasks: [
            {
              id: 'social-step',
              description: objective.objective.statement,
              basePriority: 10,
              intentionAffinityTags: ['social'],
            },
          ],
        },
      ],
    }),
    createdAt: 200,
    updatedAt: 200,
  };
  const selectedSubtask: PrioritizedSubtask = {
    branchId: 'social-branch',
    subtaskId: 'social-step',
    description: objective.objective.statement,
    score: 10,
  };
  const registration = createCanonicalDomainRuntimeRegistrations().find(
    (candidate) => candidate.domain === 'social',
  );
  if (registration?.createMicroPlanners === undefined) {
    throw new Error('missing canonical social runtime registration');
  }
  const planners = await registration.createMicroPlanners({
    agentId: agentA,
    agent: requireAgent(projection, agentA),
    projection,
    activeObjective: objective.objective,
    planRecord,
    longTermProfile: profile,
  });
  const planner = planners.find((candidate) => candidate.supports(selectedSubtask));
  if (planner === undefined) {
    throw new Error('social trajectory did not resolve a social micro-planner');
  }
  const action = planner.propose({
    agentId: agentA,
    issuedAt: 200,
    plan: planRecord.plan,
    selectedSubtask,
    signals: [],
  })[0];
  if (action === undefined) {
    throw new Error('social trajectory did not produce an action');
  }
  return {
    projection,
    profile,
    objective,
    action,
  };
}

function createBaseProjection(): WorldProjection {
  return createWorldProjection({
    agents: [createAgent(agentA), createAgent(agentB), createAgent(agentC)],
    locations: [
      {
        locationId: townSquare,
        name: 'Town Square',
        kind: 'social',
        activityAffinities: ['socialize'],
        capacity: null,
      },
    ],
    locationObservations: [
      {
        agentId: agentA,
        locationId: townSquare,
        locationName: 'Town Square',
        observedAgentIds: [agentB, agentC],
        activityAffinities: ['socialize'],
        observedAt: 0,
      },
    ],
  });
}

function createAgent(agentId: typeof agentA): WorldAgentState {
  return {
    agentId,
    locationId: townSquare,
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: 150,
    balance: 200,
    residentialTier: 1,
    job: 'Cleaner',
    inventory: {},
  };
}

function readStringProperty(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`expected action payload object with ${key}`);
  }
  const property = (value as Readonly<Record<string, unknown>>)[key];
  if (typeof property !== 'string') {
    throw new Error(`expected action payload ${key} to be a string`);
  }
  return property;
}

function requireAgent(projection: WorldProjection, agentId: typeof agentA): WorldAgentState {
  const agent = projection.agents[agentId];
  if (agent === undefined) {
    throw new Error(`missing trajectory agent ${agentId}`);
  }
  return agent;
}
