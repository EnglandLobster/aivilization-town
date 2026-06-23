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
  | 'AgentEat'
  | 'AgentSleep'
  | 'AgentStudy'
  | 'AgentApplyJob'
  | 'AgentWork'
  | 'AgentSocialize'
  | 'SetLongHorizonObjective'
  | 'IssueReactiveCommand'
  | 'AdvanceSimulationTime';

export type CommandSource = 'human' | 'agent-runtime' | 'system' | 'experiment';

export type CommandEnvelope<TType extends string = CoreCommandType, TPayload = unknown> = {
  readonly id: CommandId;
  readonly simulationId: SimulationId;
  readonly idempotencyKey: CommandIdempotencyKey;
  readonly actorId?: AgentId;
  readonly source: CommandSource;
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
  readonly type: TType;
  readonly payload: TPayload;
  readonly issuedAt: SimulationTimestamp;
  readonly expectedVersion?: number;
}): CommandEnvelope<TType, TPayload> {
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
  return input.expectedVersion === undefined
    ? withActor
    : { ...withActor, expectedVersion: input.expectedVersion };
}
