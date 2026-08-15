import {
  createMemoryProvenance,
  createShortTermMemoryRecord,
  type SocialKnowledgeClaim,
  type SocialKnowledgeClaimStatus,
} from '@aivilization/memory';
import {
  asConversationId,
  createSeededRandom,
  type AgentId,
  type CommandEnvelope,
} from '@aivilization/sim-core';
import {
  classifySocialCommitmentIntent,
  evaluateConversationSocialOutcomes,
  evaluateConversationSocialOutcomesFromSignals,
  evaluateConversationSocialOutcomesFromSignalSeverities,
  evaluateDiscoursePropagation,
  HEARSAY_CHAIN_TAG_PREFIX,
  isSocialSignalName,
  parseHearsayChainDepth,
  type TownDiscoursePolicy,
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
  /**
   * Optional town-discourse policy (town-discourse-v1). When present, each
   * conversation direction can additionally carry one of the speaker's
   * eligible recent memories to the listener as a hearsay copy with a
   * deterministically distorted importance (rolls seeded per command and
   * direction). Absent keeps conversations byte-for-byte identical to legacy
   * runs.
   */
  readonly discourse?: TownDiscoursePolicy;
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
  appendDiscoursePropagationEvents({
    input,
    events,
    policy: input.discourse,
    directions: [
      { speakerAgentId: agent.agentId, listenerAgentId: targetAgent.agentId },
      { speakerAgentId: targetAgent.agentId, listenerAgentId: agent.agentId },
    ],
  });
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

/**
 * Hearsay propagation (town-discourse-v1): one extra ShortTermMemoryRecorded
 * per direction, decided by the society pure rule. Candidates come from the
 * projection's bounded recent-memory cache (explicitly a read cache, not the
 * authoritative memory repository — a speaker whose records were evicted
 * from the cache simply has nothing to share this turn). The rolls are
 * derived only from the command envelope and the clock, so every replay and
 * every partition re-derives identical copies.
 */
function appendDiscoursePropagationEvents(input: {
  readonly input: {
    readonly command: CommandEnvelope<'AgentStartConversation', unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  };
  readonly events: WorldEvent[];
  readonly policy: TownDiscoursePolicy | undefined;
  readonly directions: readonly {
    readonly speakerAgentId: AgentId;
    readonly listenerAgentId: AgentId;
  }[];
}): void {
  const policy = input.policy;
  if (policy === undefined) {
    return;
  }
  for (const direction of input.directions) {
    const rng = createSeededRandom(
      [
        'town-discourse-propagation',
        input.input.command.simulationId,
        input.input.command.id,
        input.input.projection.clock.now,
        `${direction.speakerAgentId}->${direction.listenerAgentId}`,
      ].join(':'),
    );
    const speakerRecords = input.input.projection.memoryRecords.filter(
      (record) => record.agentId === direction.speakerAgentId,
    );
    const decision = evaluateDiscoursePropagation({
      candidates: speakerRecords.map((record) => ({
        recordId: record.id,
        importanceScore: record.importanceScore,
        tags: record.tags,
        ...(record.provenance === undefined
          ? {}
          : {
              provenanceKind: record.provenance.kind,
              provenanceStatus: record.provenance.status,
            }),
        chainDepth: parseHearsayChainDepth(record.tags),
      })),
      policy,
      gateRoll: rng.nextFloat(),
      distortionRoll: rng.nextFloat(),
    });
    if (decision === null) {
      continue;
    }
    const sourceRecord = speakerRecords.find((record) => record.id === decision.candidate.recordId);
    if (sourceRecord === undefined) {
      continue;
    }
    input.events.push(
      makeEvent(input.input, input.events.length, 'ShortTermMemoryRecorded', {
        record: createShortTermMemoryRecord({
          id: `${input.input.command.id}:memory:hearsay-${input.events.length}`,
          agentId: direction.listenerAgentId,
          kind: sourceRecord.kind,
          status: sourceRecord.status,
          summary: `Heard from ${direction.speakerAgentId}: ${sourceRecord.summary}`,
          occurredAt: input.input.command.issuedAt,
          importanceScore: decision.distortedImportance,
          source: {
            commandId: input.input.command.id,
            eventIds: [...sourceRecord.source.eventIds],
          },
          tags: stableUnique([
            ...sourceRecord.tags.filter((tag) => !tag.startsWith(HEARSAY_CHAIN_TAG_PREFIX)),
            'hearsay',
            `${HEARSAY_CHAIN_TAG_PREFIX}${decision.nextChainDepth}`,
            `from:${direction.speakerAgentId}`,
          ]),
          provenance: createMemoryProvenance({ kind: 'hearsay' }),
        }),
      }),
    );
  }
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
          (signal.severity === undefined || (signal.severity >= 0 && signal.severity <= 1)),
      ),
  );
  return usable ? input.turnSignals : undefined;
}

function hasSuppliedSignalSeverities(
  turnSignals: NonNullable<AgentStartConversationPayload['turnSignals']>,
): boolean {
  return turnSignals.some((entry) => entry.signals.some((signal) => signal.severity !== undefined));
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
