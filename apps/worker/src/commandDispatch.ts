import type { CommandDraft } from '@aivilization/agent-runtime';
import {
  createCommandEnvelope,
  type CommandEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';

export type DispatchCommandDraftsResult = {
  readonly commands: readonly CommandEnvelope<CoreCommandType, unknown>[];
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
};

export function createCommandEnvelopeFromDraft(input: {
  readonly draft: CommandDraft;
  readonly commandId: string;
  readonly idempotencyKey?: string;
  readonly expectedVersion?: number;
}): CommandEnvelope<CoreCommandType, unknown> {
  return createCommandEnvelope({
    id: input.commandId,
    simulationId: input.draft.simulationId,
    idempotencyKey: input.idempotencyKey ?? input.commandId,
    actorId: input.draft.actorId,
    source: input.draft.source,
    type: input.draft.type,
    payload: input.draft.payload,
    issuedAt: input.draft.issuedAt,
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
  });
}

export function dispatchCommandDraftsToWorld(input: {
  readonly commandDrafts: readonly CommandDraft[];
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicies;
  readonly startingSequence: number;
  readonly commandIdPrefix: string;
  readonly expectedVersion?: number;
}): DispatchCommandDraftsResult {
  assertPositiveInteger(input.startingSequence, 'startingSequence');
  assertNonEmpty(input.commandIdPrefix, 'commandIdPrefix');

  let nextSequence = input.startingSequence;
  let projection = input.projection;
  const commands: CommandEnvelope<CoreCommandType, unknown>[] = [];
  const events: WorldEvent[] = [];

  input.commandDrafts.forEach((draft, index) => {
    const command = createCommandEnvelopeFromDraft({
      draft,
      commandId: `${input.commandIdPrefix}-${index + 1}`,
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    });
    const commandEvents = dispatchWorldCommand({
      command,
      projection,
      policies: input.policies,
      nextSequence,
    });

    commands.push(command);
    events.push(...commandEvents);
    projection = commandEvents.reduce(applyWorldEvent, projection);
    nextSequence += commandEvents.length;
  });

  return { commands, events, projection };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
