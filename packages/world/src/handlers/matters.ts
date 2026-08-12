import { getInventoryQuantity } from '@aivilization/economy';
import type { AgentId, CommandEnvelope, CoreCommandType } from '@aivilization/sim-core';
import { classifySocialCommitmentIntent, resolveSocialSignalDeltas } from '@aivilization/society';
import {
  assertAgentAssignMatterPayload,
  assertAgentCloseMatterPayload,
  assertAgentRaiseMatterPayload,
  assertAgentRespondMatterPayload,
} from '../commands';
import type { WorldEvent } from '../events';
import { isMatterAssignable, type SocialMattersPolicy, type WorldSocialMatterState } from '../matters';
import type { WorldProjection } from '../projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  planSocialInteractionEvent,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

export function handleAgentRaiseMatterCommand(input: {
  readonly command: CommandEnvelope<'AgentRaiseMatter', unknown>;
  readonly projection: WorldProjection;
  readonly socialMatters?: SocialMattersPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.socialMatters === undefined) {
    return rejectCommand(input, 'AgentRaiseMatter', 'missing social matters policy');
  }
  const payloadResult = parsePayload(() => assertAgentRaiseMatterPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentRaiseMatter', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const matter: WorldSocialMatterState = {
    matterId: `matter-${input.command.id}`,
    kind: 'help-request',
    status: 'open',
    initiatorAgentId: agent.agentId,
    topic: payload.topic,
    statement: payload.statement,
    ...(payload.requiredCommodity === undefined
      ? {}
      : { requiredCommodity: { ...payload.requiredCommodity } }),
    responses: [],
    createdAt: input.command.issuedAt,
    expiresAt: input.projection.clock.now + (payload.expiresInMs ?? input.socialMatters.defaultExpiryMs),
  };
  return [
    makeEvent(input, 0, 'MatterRaised', { matter }),
    makeMemoryEvent(input, 1, {
      agentId: agent.agentId,
      kind: 'action',
      summary: `Raised help request "${matter.topic}": ${matter.statement}`,
      status: 'succeeded',
      tags: ['social-matter', 'help-request', matter.matterId],
    }),
  ];
}

export function handleAgentRespondMatterCommand(input: {
  readonly command: CommandEnvelope<'AgentRespondMatter', unknown>;
  readonly projection: WorldProjection;
  readonly socialMatters?: SocialMattersPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.socialMatters === undefined) {
    return rejectCommand(input, 'AgentRespondMatter', 'missing social matters policy');
  }
  const payloadResult = parsePayload(() => assertAgentRespondMatterPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentRespondMatter', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const matter = input.projection.socialMatters?.[payload.matterId];
  if (matter === undefined) {
    return rejectCommand(input, 'AgentRespondMatter', `unknown matter ${payload.matterId}`);
  }
  if (matter.status !== 'open' && matter.status !== 'collecting') {
    return rejectCommand(
      input,
      'AgentRespondMatter',
      `matter ${matter.matterId} is not open for responses (status ${matter.status})`,
    );
  }
  if (agent.agentId === matter.initiatorAgentId) {
    return rejectCommand(input, 'AgentRespondMatter', 'initiator cannot respond to own matter');
  }
  return [
    makeEvent(input, 0, 'MatterResponded', {
      matterId: matter.matterId,
      responderAgentId: agent.agentId,
      decision: payload.decision,
      respondedAt: input.command.issuedAt,
    }),
    makeMemoryEvent(input, 1, {
      agentId: agent.agentId,
      kind: 'action',
      summary: `Responded "${payload.decision}" to matter ${matter.matterId} (${matter.topic}).`,
      status: 'succeeded',
      tags: ['social-matter', 'matter-response', matter.matterId],
    }),
  ];
}

export function handleAgentAssignMatterCommand(input: {
  readonly command: CommandEnvelope<'AgentAssignMatter', unknown>;
  readonly projection: WorldProjection;
  readonly socialMatters?: SocialMattersPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.socialMatters === undefined) {
    return rejectCommand(input, 'AgentAssignMatter', 'missing social matters policy');
  }
  const payloadResult = parsePayload(() => assertAgentAssignMatterPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentAssignMatter', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const matter = input.projection.socialMatters?.[payload.matterId];
  if (matter === undefined) {
    return rejectCommand(input, 'AgentAssignMatter', `unknown matter ${payload.matterId}`);
  }
  if (agent.agentId !== matter.initiatorAgentId) {
    return rejectCommand(input, 'AgentAssignMatter', 'only the initiator can assign the matter');
  }
  if (!isMatterAssignable(matter.status)) {
    return rejectCommand(
      input,
      'AgentAssignMatter',
      `matter ${matter.matterId} is not assignable (status ${matter.status})`,
    );
  }
  const assignee = input.projection.agents[payload.assigneeAgentId];
  if (assignee === undefined) {
    return rejectCommand(input, 'AgentAssignMatter', `unknown assignee ${payload.assigneeAgentId}`);
  }
  if (
    !matter.responses.some(
      (response) =>
        response.responderAgentId === payload.assigneeAgentId && response.decision === 'accept',
    )
  ) {
    return rejectCommand(
      input,
      'AgentAssignMatter',
      'assignee must be a candidate who accepted the matter',
    );
  }
  if (matter.requiredCommodity !== undefined) {
    const available = getInventoryQuantity(
      assignee.inventory,
      matter.requiredCommodity.commodityName,
    );
    if (available < matter.requiredCommodity.quantity) {
      return rejectCommand(
        input,
        'AgentAssignMatter',
        `assignee lacks capability: requires ${matter.requiredCommodity.commodityName} x${matter.requiredCommodity.quantity}, available x${available}`,
      );
    }
  }
  return [
    makeEvent(input, 0, 'MatterAssigned', {
      matterId: matter.matterId,
      assigneeAgentId: payload.assigneeAgentId,
      assignedAt: input.command.issuedAt,
    }),
    makeMemoryEvent(input, 1, {
      agentId: agent.agentId,
      kind: 'action',
      summary: `Assigned matter ${matter.matterId} (${matter.topic}) to ${payload.assigneeAgentId}.`,
      status: 'succeeded',
      tags: ['social-matter', 'matter-assignment', matter.matterId],
    }),
    makeMemoryEvent(input, 2, {
      agentId: payload.assigneeAgentId,
      kind: 'social-interaction',
      summary: `Assigned matter ${matter.matterId} (${matter.topic}) by ${agent.agentId}.`,
      status: 'succeeded',
      tags: ['social-matter', 'matter-assignment', matter.matterId],
    }),
  ];
}

export function handleAgentCloseMatterCommand(input: {
  readonly command: CommandEnvelope<'AgentCloseMatter', unknown>;
  readonly projection: WorldProjection;
  readonly socialMatters?: SocialMattersPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.socialMatters === undefined) {
    return rejectCommand(input, 'AgentCloseMatter', 'missing social matters policy');
  }
  const payloadResult = parsePayload(() => assertAgentCloseMatterPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentCloseMatter', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const matter = input.projection.socialMatters?.[payload.matterId];
  if (matter === undefined) {
    return rejectCommand(input, 'AgentCloseMatter', `unknown matter ${payload.matterId}`);
  }
  if (agent.agentId !== matter.initiatorAgentId) {
    return rejectCommand(input, 'AgentCloseMatter', 'only the initiator can close the matter');
  }
  if (matter.status === 'closed') {
    return rejectCommand(input, 'AgentCloseMatter', `matter ${matter.matterId} is already closed`);
  }
  if (payload.outcome === 'fulfilled') {
    // World verification: a commodity-backed request is fulfilled by delivered
    // goods (see the transfer hook), never by self-report. Other matters close
    // on the initiator's (the beneficiary's) confirmation.
    if (matter.requiredCommodity !== undefined) {
      return rejectCommand(
        input,
        'AgentCloseMatter',
        'fulfillment requires world-verified delivery, not self-report',
      );
    }
    if (matter.status !== 'assigned' && matter.status !== 'latent') {
      return rejectCommand(
        input,
        'AgentCloseMatter',
        `matter ${matter.matterId} has no committed party to confirm against (status ${matter.status})`,
      );
    }
    return closeMatterWithSocialOutcome({
      input,
      matter,
      closure: 'fulfilled',
      signal: 'fulfilled-commitment',
    });
  }
  if (payload.outcome === 'breached') {
    if (matter.status !== 'assigned' && matter.status !== 'executing') {
      return rejectCommand(
        input,
        'AgentCloseMatter',
        `matter ${matter.matterId} has no assignee to breach (status ${matter.status})`,
      );
    }
    return closeMatterWithSocialOutcome({
      input,
      matter,
      closure: 'breached',
      signal: 'betrayal',
    });
  }
  return [
    makeEvent(input, 0, 'MatterClosed', {
      matterId: matter.matterId,
      closure: 'withdrawn',
      closedAt: input.command.issuedAt,
    }),
    makeMemoryEvent(input, 1, {
      agentId: agent.agentId,
      kind: 'action',
      summary: `Withdrew matter ${matter.matterId} (${matter.topic}).`,
      status: 'succeeded',
      tags: ['social-matter', 'matter-withdrawn', matter.matterId],
    }),
  ];
}

/**
 * Closes a matter with the social consequence from the canonical signal rule
 * table (fulfilled-commitment / betrayal), attributed to the committed party
 * toward the initiator — the same scoring the conversation pipeline uses.
 */

export function closeMatterWithSocialOutcome(input: {
  readonly input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  };
  readonly matter: WorldSocialMatterState;
  readonly closure: 'fulfilled' | 'breached';
  readonly signal: 'fulfilled-commitment' | 'betrayal';
  readonly fulfillmentEventId?: string;
}): WorldEvent[] {
  const events: WorldEvent[] = [];
  appendMatterClosureWithSocialOutcome({ ...input, events });
  return events;
}

export function appendMatterClosureWithSocialOutcome(input: {
  readonly input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  };
  readonly events: WorldEvent[];
  readonly matter: WorldSocialMatterState;
  readonly closure: 'fulfilled' | 'breached';
  readonly signal: 'fulfilled-commitment' | 'betrayal';
  readonly fulfillmentEventId?: string;
}): void {
  const committedParty = input.matter.assigneeAgentId;
  if (committedParty === undefined) {
    throw new Error(`social matter ${input.matter.matterId} has no committed party`);
  }
  const deltas = resolveSocialSignalDeltas(input.signal);
  if (deltas === undefined) {
    throw new Error(`unknown social signal ${input.signal}`);
  }
  const summary = `Matter ${input.matter.matterId} (${input.matter.topic}) closed ${input.closure}.`;
  const relation = planSocialInteractionEvent({
    projection: input.input.projection,
    sourceAgentId: committedParty,
    targetAgentId: input.matter.initiatorAgentId,
    summary,
    relationDelta: deltas.relationDelta,
    attitudeDelta: deltas.attitudeDelta,
    outcomeSignals: [input.signal],
  });
  if (relation.status === 'invalid') {
    throw new Error(`social matter closure outcome invalid: ${relation.reason}`);
  }
  input.events.push(
    makeEvent(input.input, input.events.length, 'SocialInteractionCompleted', relation.payload),
    makeEvent(input.input, input.events.length + 1, 'MatterClosed', {
      matterId: input.matter.matterId,
      closure: input.closure,
      closedAt: input.input.command.issuedAt,
      ...(input.fulfillmentEventId === undefined
        ? {}
        : { fulfillmentEventId: input.fulfillmentEventId }),
    }),
    makeMemoryEvent(input.input, input.events.length + 2, {
      agentId: committedParty,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      tags: ['social-matter', `matter-${input.closure}`, input.matter.matterId],
    }),
    makeMemoryEvent(input.input, input.events.length + 3, {
      agentId: input.matter.initiatorAgentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      tags: ['social-matter', `matter-${input.closure}`, input.matter.matterId],
    }),
  );
}

/**
 * Conversation → matter escalation (social-matters switch): a verified
 * make-commitment turn raises a latent commitment matter pre-bound to the
 * promisor, and a verified fulfill/breach turn closes the matter linked to
 * the commitment it resolves. Runs on the post-anti-cheat turns, mirroring
 * applyConversationCommitmentChanges' matching rule.
 */

export function appendConversationMatterEvents(input: {
  readonly input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  };
  readonly events: WorldEvent[];
  readonly conversationId: string;
  readonly topic: string;
  readonly participantAgentIds: readonly [AgentId, AgentId];
  readonly outcomeTurns: readonly {
    readonly turnIndex: number;
    readonly speakerAgentId: AgentId;
    readonly utterance: string;
    readonly intent?: string;
  }[];
  readonly policy?: SocialMattersPolicy;
}): void {
  const policy = input.policy;
  if (policy === undefined) {
    return;
  }
  const projection = input.input.projection;

  // Pass 1: fulfill/breach turns resolve the oldest matching open commitment.
  const workingCommitments = new Map(Object.entries(projection.socialCommitments));
  for (const turn of input.outcomeTurns) {
    const intent = classifySocialCommitmentIntent(turn.intent);
    if (intent !== 'fulfilled' && intent !== 'breached') {
      continue;
    }
    const openCommitment = [...workingCommitments.values()]
      .filter(
        (commitment) =>
          commitment.status === 'open' &&
          commitment.promisorAgentId === turn.speakerAgentId &&
          commitment.topic === input.topic &&
          input.participantAgentIds.includes(commitment.beneficiaryAgentId),
      )
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.commitmentId.localeCompare(right.commitmentId)
          : left.createdAt - right.createdAt,
      )[0];
    if (openCommitment === undefined) {
      continue;
    }
    workingCommitments.delete(openCommitment.commitmentId);
    const matter = Object.values(projection.socialMatters ?? {}).find(
      (candidate) =>
        candidate.sourceCommitmentId === openCommitment.commitmentId &&
        candidate.status !== 'closed',
    );
    if (matter === undefined) {
      continue;
    }
    // The conversation's own social outcome already scores fulfill/breach
    // intents, so the matter only closes — no double-counted relation event.
    input.events.push(
      makeEvent(input.input, input.events.length, 'MatterClosed', {
        matterId: matter.matterId,
        closure: intent,
        closedAt: input.input.command.issuedAt,
      }),
    );
  }

  // Pass 2: make-commitment turns escalate into latent commitment matters.
  for (const turn of input.outcomeTurns) {
    if (classifySocialCommitmentIntent(turn.intent) !== 'created') {
      continue;
    }
    const beneficiaryAgentId = input.participantAgentIds.find(
      (participantAgentId) => participantAgentId !== turn.speakerAgentId,
    );
    if (beneficiaryAgentId === undefined) {
      continue;
    }
    const commitmentId = `${input.conversationId}:${turn.turnIndex}`;
    const matter: WorldSocialMatterState = {
      matterId: `matter-commitment-${input.conversationId}-${turn.turnIndex}`,
      kind: 'commitment',
      status: 'latent',
      initiatorAgentId: beneficiaryAgentId,
      topic: input.topic,
      statement: turn.utterance,
      assigneeAgentId: turn.speakerAgentId,
      responses: [],
      sourceCommitmentId: commitmentId,
      createdAt: input.input.command.issuedAt,
      expiresAt: projection.clock.now + policy.defaultExpiryMs,
    };
    input.events.push(makeEvent(input.input, input.events.length, 'MatterRaised', { matter }));
  }
}

/**
 * World-verified fulfillment: a resource transfer from an assignee to the
 * initiator of an assigned/executing commodity-backed matter counts as
 * delivery progress (partial → executing; complete → closed fulfilled with
 * the fulfilled-commitment social outcome). Self-reported fulfillment is not
 * accepted anywhere.
 */

export function appendMatterFulfillmentEvents(input: {
  readonly input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  };
  readonly events: WorldEvent[];
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly commodityName: string;
  readonly quantity: number;
  readonly transferEventId: string;
  readonly policy?: SocialMattersPolicy;
}): void {
  if (input.policy === undefined) {
    return;
  }
  const matter = Object.values(input.input.projection.socialMatters ?? {})
    .filter(
      (candidate) =>
        (candidate.status === 'assigned' || candidate.status === 'executing') &&
        candidate.assigneeAgentId === input.sourceAgentId &&
        candidate.initiatorAgentId === input.targetAgentId &&
        candidate.requiredCommodity?.commodityName === input.commodityName,
    )
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.matterId.localeCompare(right.matterId),
    )[0];
  if (matter === undefined || matter.requiredCommodity === undefined) {
    return;
  }
  const deliveredQuantity = (matter.deliveredQuantity ?? 0) + input.quantity;
  input.events.push(
    makeEvent(input.input, input.events.length, 'MatterProgressed', {
      matterId: matter.matterId,
      deliveredQuantity,
      transferEventId: input.transferEventId,
    }),
  );
  if (deliveredQuantity < matter.requiredCommodity.quantity) {
    return;
  }
  appendMatterClosureWithSocialOutcome({
    input: input.input,
    events: input.events,
    matter,
    closure: 'fulfilled',
    signal: 'fulfilled-commitment',
    fulfillmentEventId: input.transferEventId,
  });
}
