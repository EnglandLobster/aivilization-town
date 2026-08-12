import {
  asAgentId,
  asCommandId,
  asCommandIdempotencyKey,
  asSimulationId,
  type AgentId,
  type CommandId,
  type CommandIdempotencyKey,
  type SimulationId,
} from './ids';
import type { SimulationTimestamp } from './time';

export type CoreCommandType =
  | 'AgentProduce'
  | 'AgentTrade'
  | 'AgentGiveResource'
  | 'AgentEat'
  | 'AgentMoveTo'
  | 'AgentObserveLocation'
  | 'AgentStartConversation'
  | 'AgentSleep'
  | 'AgentSeeDoctor'
  | 'AgentStudy'
  | 'AgentApplyJob'
  | 'AgentUpgradeResidentialTier'
  | 'AgentWork'
  | 'AgentPostBulletin'
  | 'IssueTownBulletin'
  | 'AgentRaiseMatter'
  | 'AgentRespondMatter'
  | 'AgentAssignMatter'
  | 'AgentCloseMatter'
  | 'AgentConfront'
  | 'AgentAttack'
  | 'AgentIntervene'
  | 'SetLongHorizonObjective'
  | 'IssueReactiveCommand'
  | 'RegisterAgent'
  | 'AdvanceSimulationTime';

export type CommandSource = 'human' | 'agent-runtime' | 'system' | 'experiment';

export type HumanCommandAttribution = {
  readonly principalSubjectId: string;
  readonly principalRoles: readonly string[];
  readonly accessPolicyVersion: string;
  readonly consentPolicyVersion: string;
};

export type CommandEnvelope<TType extends string = CoreCommandType, TPayload = unknown> = {
  readonly id: CommandId;
  readonly simulationId: SimulationId;
  readonly idempotencyKey: CommandIdempotencyKey;
  readonly actorId?: AgentId;
  readonly source: CommandSource;
  readonly humanAttribution?: HumanCommandAttribution;
  readonly type: TType;
  readonly payload: TPayload;
  readonly issuedAt: SimulationTimestamp;
  readonly expectedVersion?: number;
};

export function createCommandEnvelope<TType extends string, TPayload>(input: {
  readonly id: string;
  readonly simulationId: string;
  readonly idempotencyKey?: string;
  readonly actorId?: string;
  readonly source?: CommandSource;
  readonly humanAttribution?: HumanCommandAttribution;
  readonly type: TType;
  readonly payload: TPayload;
  readonly issuedAt: SimulationTimestamp;
  readonly expectedVersion?: number;
}): CommandEnvelope<TType, TPayload> {
  if (input.humanAttribution !== undefined) {
    if ((input.source ?? 'system') !== 'human') {
      throw new Error('humanAttribution is only valid for human commands');
    }
    assertHumanCommandAttribution(input.humanAttribution);
  }
  const base = {
    id: asCommandId(input.id),
    simulationId: asSimulationId(input.simulationId),
    idempotencyKey: asCommandIdempotencyKey(input.idempotencyKey ?? input.id),
    source: input.source ?? 'system',
    type: input.type,
    payload: input.payload,
    issuedAt: input.issuedAt,
  };

  const withActor =
    input.actorId === undefined ? base : { ...base, actorId: asAgentId(input.actorId) };
  const withAttribution =
    input.humanAttribution === undefined
      ? withActor
      : {
          ...withActor,
          humanAttribution: {
            ...input.humanAttribution,
            principalRoles: [...input.humanAttribution.principalRoles],
          },
        };
  return input.expectedVersion === undefined
    ? withAttribution
    : { ...withAttribution, expectedVersion: input.expectedVersion };
}

function assertHumanCommandAttribution(attribution: HumanCommandAttribution): void {
  for (const [field, value] of [
    ['principalSubjectId', attribution.principalSubjectId],
    ['accessPolicyVersion', attribution.accessPolicyVersion],
    ['consentPolicyVersion', attribution.consentPolicyVersion],
  ] as const) {
    if (value.trim().length === 0) {
      throw new Error(`humanAttribution ${field} must be non-empty`);
    }
  }
  if (
    attribution.principalRoles.length === 0 ||
    attribution.principalRoles.some((role) => role.trim().length === 0)
  ) {
    throw new Error('humanAttribution principalRoles must contain only non-empty roles');
  }
}
