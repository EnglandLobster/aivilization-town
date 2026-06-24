export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type SimulationId = Brand<string, 'SimulationId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type LocationId = Brand<string, 'LocationId'>;
export type ConversationId = Brand<string, 'ConversationId'>;
export type CommandId = Brand<string, 'CommandId'>;
export type CommandIdempotencyKey = Brand<string, 'CommandIdempotencyKey'>;
export type EventId = Brand<string, 'EventId'>;

export function asSimulationId(value: string): SimulationId {
  return value as SimulationId;
}

export function asAgentId(value: string): AgentId {
  return value as AgentId;
}

export function asLocationId(value: string): LocationId {
  return value as LocationId;
}

export function asConversationId(value: string): ConversationId {
  return value as ConversationId;
}

export function asCommandId(value: string): CommandId {
  return value as CommandId;
}

export function asCommandIdempotencyKey(value: string): CommandIdempotencyKey {
  return value as CommandIdempotencyKey;
}

export function asEventId(value: string): EventId {
  return value as EventId;
}
