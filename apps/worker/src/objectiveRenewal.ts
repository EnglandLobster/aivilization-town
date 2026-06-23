import {
  compileStrategicObjectiveToBranchPlan,
  type BranchPlanRecord,
  type BranchPlanRepository,
  type StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  AgentIntentionState,
  LongHorizonObjective,
  LongTermAgentProfile,
  LongTermProfileRepository,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldAgentState, WorldProjection } from '@aivilization/world';

export type AutonomousObjectiveProposerInput = {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly intentionState: AgentIntentionState;
  readonly longTermProfile: LongTermAgentProfile;
  readonly issuedAt: number;
};

export type AutonomousObjectiveProposer = (
  input: AutonomousObjectiveProposerInput,
) => LongHorizonObjective | undefined | Promise<LongHorizonObjective | undefined>;

export type RenewedActiveObjectiveResult = {
  readonly agentId: AgentId;
  readonly objectiveId: string;
  readonly planId: string;
};

export function createDefaultAutonomousObjective(
  input: AutonomousObjectiveProposerInput,
): LongHorizonObjective {
  const base = {
    id: createAutonomousObjectiveId(input.agentId, input.issuedAt),
    agentId: input.agentId,
    source: 'agent' as const,
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  };

  if (
    input.agent.physiology.energy < 30 ||
    input.agent.physiology.satiety < 30 ||
    input.agent.physiology.health < 50
  ) {
    return {
      ...base,
      statement: 'Maintain energy, satiety, and health before pursuing growth.',
      priority: 3,
      affinityTags: ['maintain', 'health', 'energy'],
    };
  }

  if (input.agent.educationScore < 100) {
    return {
      ...base,
      statement: 'Improve education to qualify for better town opportunities.',
      priority: 2,
      affinityTags: ['study', 'education'],
    };
  }

  if (input.agent.balance < 50) {
    return {
      ...base,
      statement: 'Earn enough money to stay economically stable.',
      priority: 2,
      affinityTags: ['work', 'income'],
    };
  }

  return {
    ...base,
    statement: 'Maintain a balanced daily routine in the town.',
    priority: 1,
    affinityTags: ['maintain', 'routine'],
  };
}

export async function renewMissingActiveObjectives(input: {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly planRepository: BranchPlanRepository;
  readonly issuedAt: number;
  readonly objectiveProposer?: AutonomousObjectiveProposer;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
}): Promise<readonly RenewedActiveObjectiveResult[]> {
  const renewed: RenewedActiveObjectiveResult[] = [];
  const proposer = input.objectiveProposer ?? createDefaultAutonomousObjective;
  const compile = input.strategicPlanCompiler ?? compileStrategicObjectiveToBranchPlan;

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) {
      continue;
    }

    const intentionState = await input.intentionRepository.getOrCreate(agent.agentId);
    if (intentionState.activeObjective !== undefined) {
      continue;
    }

    const longTermProfile = await input.longTermProfileRepository.getOrCreate(agent.agentId);
    const objective = await proposer({
      agentId: agent.agentId,
      agent,
      projection: input.projection,
      intentionState,
      longTermProfile,
      issuedAt: input.issuedAt,
    });
    if (objective === undefined) {
      continue;
    }

    await input.intentionRepository.setObjective(agent.agentId, objective);
    await input.planRepository.save(
      await createStrategicPlanRecord({
        objective,
        issuedAt: input.issuedAt,
        compile,
      }),
    );
    renewed.push({
      agentId: agent.agentId,
      objectiveId: objective.id,
      planId: objective.id,
    });
  }

  return renewed;
}

async function createStrategicPlanRecord(input: {
  readonly objective: LongHorizonObjective;
  readonly issuedAt: number;
  readonly compile: StrategicPlanCompiler;
}): Promise<BranchPlanRecord> {
  return {
    planId: input.objective.id,
    agentId: input.objective.agentId,
    plan: await input.compile({ objective: input.objective, issuedAt: input.issuedAt }),
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  };
}

function createAutonomousObjectiveId(agentId: AgentId, issuedAt: number): string {
  return `auto-objective-${agentId}-${issuedAt}`;
}
