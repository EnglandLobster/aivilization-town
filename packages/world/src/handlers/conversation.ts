import type { SocialKnowledgeClaim, SocialKnowledgeClaimStatus } from '@aivilization/memory';
import { asConversationId, type AgentId, type CommandEnvelope } from '@aivilization/sim-core';
import {
  classifySocialCommitmentIntent,
  evaluateConversationSocialOutcomes,
  evaluateConversationSocialOutcomesFromSignals,
  evaluateConversationSocialOutcomesFromSignalSeverities,
  isSocialSignalName,
} from '@aivilization/society';
import type { AgentStartConversationPayload } from '../commands';
import { assertAgentStartConversationPayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import type { SocialMattersPolicy } from '../matters';
import { appendConversationMatterEvents } from './matters';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  planSocialInteractionEvent,
  rejectCommand,
  resolveCommandAgent,
  stableUnique,
} from './shared';

export function handleAgentStartConversationCommand(input: {
  readonly command: CommandEnvelope<'AgentStartConversation', unknown>;
  readonly projection: WorldProjection;
  readonly socialMatters?: SocialMattersPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentStartConversationPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentStartConversation', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const targetAgent = input.projection.agents[payload.targetAgentId];
  if (targetAgent === undefined) {
    return rejectCommand(
      input,
      'AgentStartConversation',
      `unknown target agent ${payload.targetAgentId}`,
    );
  }
  if (agent.agentId === targetAgent.agentId) {
    return rejectCommand(input, 'AgentStartConversation', 'conversation target must differ');
  }
  if (agent.locationId === null) {
    return rejectCommand(input, 'AgentStartConversation', 'agent location is unknown');
  }
  if (targetAgent.locationId === null) {
    return rejectCommand(input, 'AgentStartConversation', 'target agent location is unknown');
  }
  if (agent.locationId !== targetAgent.locationId) {
    return rejectCommand(
      input,
      'AgentStartConversation',
      `target agent ${targetAgent.agentId} is at ${targetAgent.locationId}, not co-located with ${agent.agentId} at ${agent.locationId}`,
    );
  }

  const location = input.projection.locations[agent.locationId];
  if (location === undefined) {
    return rejectCommand(
      input,
      'AgentStartConversation',
      `unknown current location ${agent.locationId}`,
    );
  }

  const participantAgentIds = [agent.agentId, targetAgent.agentId] as const;
  const participantSet = new Set<AgentId>(participantAgentIds);
  for (const turn of payload.turns) {
    if (!participantSet.has(turn.speakerAgentId)) {
      return rejectCommand(
        input,
        'AgentStartConversation',
        `conversation turn speaker ${turn.speakerAgentId} is not a participant`,
      );
    }
  }
  const firstTurn = payload.turns[0];
  if (firstTurn?.speakerAgentId !== agent.agentId) {
    return rejectCommand(
      input,
      'AgentStartConversation',
      `conversation first turn must be spoken by initiator ${agent.agentId}`,
    );
  }

  const turns = payload.turns.map((turn, index) => ({
    turnIndex: index,
    speakerAgentId: turn.speakerAgentId,
    utterance: turn.utterance,
    ...(turn.intent === undefined ? {} : { intent: turn.intent }),
  }));
  const summary = formatConversationSummary(payload.topic, turns);
  const outcomeTurns = verifyConversationCommitmentSignals({
    projection: input.projection,
    participantAgentIds,
    topic: payload.topic,
    turns,
  });
  const suppliedTurnSignals = resolveSuppliedConversationTurnSignals({
    turnSignals: payload.turnSignals,
    turnCount: turns.length,
  });
  const socialOutcomes =
    suppliedTurnSignals === undefined
      ? evaluateConversationSocialOutcomes({
          initiatorAgentId: agent.agentId,
          targetAgentId: targetAgent.agentId,
          turns: outcomeTurns,
        })
      : hasSuppliedSignalSeverities(suppliedTurnSignals)
        ? evaluateConversationSocialOutcomesFromSignalSeverities({
            initiatorAgentId: agent.agentId,
            targetAgentId: targetAgent.agentId,
            turns: outcomeTurns,
            turnSignals: suppliedTurnSignals,
          })
        : evaluateConversationSocialOutcomesFromSignals({
            initiatorAgentId: agent.agentId,
            targetAgentId: targetAgent.agentId,
            turns: outcomeTurns,
            turnSignals: suppliedTurnSignals.map((entry) => ({
              turnIndex: entry.turnIndex,
              signals: entry.signals.map((signal) => signal.signal),
            })),
          });
  const knowledgeClaims = extractSocialKnowledgeClaims(payload.topic, turns);
  const sourceKnowledgeClaims = knowledgeClaims.filter(
    (claim) => claim.sourceAgentId === targetAgent.agentId,
  );
  const targetKnowledgeClaims = knowledgeClaims.filter(
    (claim) => claim.sourceAgentId === agent.agentId,
  );
  const sourceRelation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: agent.agentId,
    targetAgentId: targetAgent.agentId,
    summary,
    relationDelta: socialOutcomes.initiatorToTarget.relationDelta,
    attitudeDelta: socialOutcomes.initiatorToTarget.attitudeDelta,
    outcomePolicyVersion: socialOutcomes.policyVersion,
    outcomeSignals: socialOutcomes.initiatorToTarget.signals,
    ...(socialOutcomes.initiatorToTarget.signalSeverities === undefined
      ? {}
      : { outcomeSignalSeverities: socialOutcomes.initiatorToTarget.signalSeverities }),
  });
  if (sourceRelation.status === 'invalid') {
    return rejectCommand(input, 'AgentStartConversation', sourceRelation.reason);
  }
  const targetRelation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: targetAgent.agentId,
    targetAgentId: agent.agentId,
    summary,
    relationDelta: socialOutcomes.targetToInitiator.relationDelta,
    attitudeDelta: socialOutcomes.targetToInitiator.attitudeDelta,
    outcomePolicyVersion: socialOutcomes.policyVersion,
    outcomeSignals: socialOutcomes.targetToInitiator.signals,
    ...(socialOutcomes.targetToInitiator.signalSeverities === undefined
      ? {}
      : { outcomeSignalSeverities: socialOutcomes.targetToInitiator.signalSeverities }),
  });
  if (targetRelation.status === 'invalid') {
    return rejectCommand(input, 'AgentStartConversation', targetRelation.reason);
  }

  const conversationId = asConversationId(`conversation-${input.command.id}`);
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'ConversationRecorded', {
      conversationId,
      initiatorAgentId: agent.agentId,
      participantAgentIds,
      locationId: location.locationId,
      topic: payload.topic,
      turns,
    }),
    makeEvent(input, 1, 'SocialInteractionCompleted', sourceRelation.payload),
    makeEvent(input, 2, 'SocialInteractionCompleted', targetRelation.payload),
    makeMemoryEvent(input, 3, {
      agentId: agent.agentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      sourceEventOffsets: [0, 1, 2],
      tags: stableUnique([
        'conversation',
        payload.topic,
        targetAgent.agentId,
        location.locationId,
        ...socialOutcomes.initiatorToTarget.signals,
      ]),
      consolidationHint: {
        kind: 'social',
        targetAgentId: targetAgent.agentId,
        relationDelta: socialOutcomes.initiatorToTarget.relationDelta,
        attitudeDelta: socialOutcomes.initiatorToTarget.attitudeDelta,
        summary,
        outcomePolicyVersion: socialOutcomes.policyVersion,
        outcomeSignals: socialOutcomes.initiatorToTarget.signals,
        ...(socialOutcomes.initiatorToTarget.signalSeverities === undefined
          ? {}
          : { outcomeSignalSeverities: socialOutcomes.initiatorToTarget.signalSeverities }),
        knowledgeClaims: sourceKnowledgeClaims,
      },
    }),
    makeMemoryEvent(input, 4, {
      agentId: targetAgent.agentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      sourceEventOffsets: [0, 1, 2],
      tags: stableUnique([
        'conversation',
        payload.topic,
        agent.agentId,
        location.locationId,
        ...socialOutcomes.targetToInitiator.signals,
      ]),
      consolidationHint: {
        kind: 'social',
        targetAgentId: agent.agentId,
        relationDelta: socialOutcomes.targetToInitiator.relationDelta,
        attitudeDelta: socialOutcomes.targetToInitiator.attitudeDelta,
        summary,
        outcomePolicyVersion: socialOutcomes.policyVersion,
        outcomeSignals: socialOutcomes.targetToInitiator.signals,
        ...(socialOutcomes.targetToInitiator.signalSeverities === undefined
          ? {}
          : { outcomeSignalSeverities: socialOutcomes.targetToInitiator.signalSeverities }),
        knowledgeClaims: targetKnowledgeClaims,
      },
    }),
  ];
  appendConversationMatterEvents({
    input,
    events,
    conversationId,
    topic: payload.topic,
    participantAgentIds,
    outcomeTurns,
    ...(input.socialMatters === undefined ? {} : { policy: input.socialMatters }),
  });
  return events;
}

function formatConversationSummary(
  topic: string,
  turns: readonly { readonly utterance: string }[],
): string {
  return `Conversation about ${topic}: ${turns.map((turn) => turn.utterance).join(' / ')}`;
}

/**
 * Supplied per-turn signals are authoritative only when every entry references an in-range turn,
 * every signal name belongs to the social signal taxonomy, and every supplied severity stays within
 * [0, 1]; otherwise the field is ignored and the deterministic keyword adjudicator remains the
 * fallback.
 */

function resolveSuppliedConversationTurnSignals(input: {
  readonly turnSignals: AgentStartConversationPayload['turnSignals'];
  readonly turnCount: number;
}): AgentStartConversationPayload['turnSignals'] {
  if (input.turnSignals === undefined) {
    return undefined;
  }
  const usable = input.turnSignals.every(
    (entry) =>
      entry.turnIndex < input.turnCount &&
      entry.signals.every(
        (signal) =>
          isSocialSignalName(signal.signal) &&
          (signal.severity === undefined ||
            (signal.severity >= 0 && signal.severity <= 1)),
      ),
  );
  return usable ? input.turnSignals : undefined;
}

function hasSuppliedSignalSeverities(
  turnSignals: NonNullable<AgentStartConversationPayload['turnSignals']>,
): boolean {
  return turnSignals.some((entry) =>
    entry.signals.some((signal) => signal.severity !== undefined),
  );
}

function extractSocialKnowledgeClaims(
  topic: string,
  turns: readonly {
    readonly speakerAgentId: AgentId;
    readonly utterance: string;
    readonly intent?: string;
  }[],
): readonly SocialKnowledgeClaim[] {
  return turns.flatMap((turn) => {
    const status = resolveKnowledgeClaimStatus(turn.intent);
    return status === undefined
      ? []
      : [
          {
            sourceAgentId: turn.speakerAgentId,
            topic,
            statement: turn.utterance,
            status,
          },
        ];
  });
}

function verifyConversationCommitmentSignals(input: {
  readonly projection: WorldProjection;
  readonly participantAgentIds: readonly [AgentId, AgentId];
  readonly topic: string;
  readonly turns: readonly {
    readonly turnIndex: number;
    readonly speakerAgentId: AgentId;
    readonly utterance: string;
    readonly intent?: string;
  }[];
}) {
  const openCommitmentByPromisor = new Map<AgentId, boolean>();
  for (const promisorAgentId of input.participantAgentIds) {
    openCommitmentByPromisor.set(
      promisorAgentId,
      hasOpenConversationCommitment({
        projection: input.projection,
        participantAgentIds: input.participantAgentIds,
        topic: input.topic,
        promisorAgentId,
      }),
    );
  }

  return input.turns.map((turn) => {
    const intent = normalizeSocialIntent(turn.intent);
    const requiresOpenCommitment = isCommitmentResolutionIntent(intent);
    const hasOpenCommitment = openCommitmentByPromisor.get(turn.speakerAgentId) ?? false;
    if (requiresOpenCommitment && !hasOpenCommitment) {
      return { ...turn, intent: 'unverified-social-claim' };
    }
    if (requiresOpenCommitment) {
      openCommitmentByPromisor.set(turn.speakerAgentId, false);
    }
    return turn;
  });
}

function hasOpenConversationCommitment(input: {
  readonly projection: WorldProjection;
  readonly participantAgentIds: readonly [AgentId, AgentId];
  readonly topic: string;
  readonly promisorAgentId: AgentId;
}): boolean {
  return Object.values(input.projection.socialCommitments).some(
    (commitment) =>
      commitment.status === 'open' &&
      commitment.promisorAgentId === input.promisorAgentId &&
      commitment.topic === input.topic &&
      input.participantAgentIds.includes(commitment.beneficiaryAgentId),
  );
}

function normalizeSocialIntent(intent: string | undefined): string {
  return intent?.trim().toLowerCase().replaceAll('_', '-') ?? '';
}

function isCommitmentResolutionIntent(intent: string): boolean {
  const commitmentIntent = classifySocialCommitmentIntent(intent);
  return commitmentIntent === 'fulfilled' || commitmentIntent === 'breached';
}

function resolveKnowledgeClaimStatus(
  intent: string | undefined,
): SocialKnowledgeClaimStatus | undefined {
  const normalized = intent?.trim().toLowerCase().replaceAll('_', '-') ?? '';
  if (containsAnySignal(normalized, ['misinform', 'deceive', 'lie'])) {
    return 'suspected-misinformation';
  }
  if (containsAnySignal(normalized, ['correct-information', 'correct-claim'])) {
    return 'corrected';
  }
  if (containsAnySignal(normalized, ['dispute-information', 'dispute-claim'])) {
    return 'disputed';
  }
  if (containsAnySignal(normalized, ['share-information', 'assert-claim', 'report-fact'])) {
    return 'asserted';
  }
  return undefined;
}

function containsAnySignal(value: string, signals: readonly string[]): boolean {
  return signals.some((signal) => value.includes(signal));
}
