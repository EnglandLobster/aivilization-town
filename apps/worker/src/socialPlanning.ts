import type {
  PrioritizedSubtask,
  SocialDialogueTurnProposal,
  SocialPlanningContextTrace,
  SocialTargetScoreBreakdown,
} from '@aivilization/agent-runtime';
import type { LongTermProfileEntry } from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { SocialRelationKey } from '@aivilization/society';
import type { WorldAgentState } from '@aivilization/world';
import type { WorkerDomainRuntimeFactoryInput } from './domainRuntimeRegistry';

export const SOCIAL_PLANNING_POLICY_VERSION = 'contextual-social-planning-v1';

const LOW_BALANCE_THRESHOLD = 50;
const EDUCATION_GAP_NORMALIZATION = 100;
const targetWeights = {
  relationshipHistory: 1,
  goalRelevance: 1.25,
  economicNeed: 1,
  personalityFit: 0.75,
  worldContext: 0.5,
} as const;

export type CanonicalSocialPlan = {
  readonly targetAgentId: AgentId;
  readonly topic: string;
  readonly planningContext: SocialPlanningContextTrace;
};

export function resolveCanonicalSocialPlan(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly configuredTargetAgentId?: AgentId;
  readonly configuredTopic?: string;
}): CanonicalSocialPlan | undefined {
  const observedTargetAgentIds = resolveObservedSocialTargetAgentIds(input.context);
  const directoryTargetAgentIds = resolveDirectoryCoLocatedAgentIds(input.context);
  const targetAgentIds =
    input.configuredTargetAgentId === undefined
      ? [...new Set([...observedTargetAgentIds, ...directoryTargetAgentIds])].sort((left, right) =>
          left.localeCompare(right),
        )
      : [input.configuredTargetAgentId];
  const candidates = targetAgentIds
    .map((agentId) =>
      scoreTargetCandidate({
        context: input.context,
        selectedSubtask: input.selectedSubtask,
        agentId,
        observed: observedTargetAgentIds.includes(agentId),
      }),
    )
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
    .sort(compareTargetCandidates);
  const selected = candidates[0];
  if (selected === undefined) {
    return undefined;
  }

  const topicSelection = resolveSocialTopic({
    context: input.context,
    selectedSubtask: input.selectedSubtask,
    ...(input.configuredTopic === undefined ? {} : { configuredTopic: input.configuredTopic }),
  });
  return {
    targetAgentId: selected.agentId,
    topic: topicSelection.topic,
    planningContext: {
      policyVersion: SOCIAL_PLANNING_POLICY_VERSION,
      targetSelection: {
        selectedAgentId: selected.agentId,
        candidates: candidates.map((candidate) => ({
          agentId: candidate.agentId,
          score: { ...candidate.score },
        })),
        tieBreak: 'agent-id-ascending',
      },
      topicSelection,
    },
  };
}

type CanonicalSocialDialogueVariant = {
  readonly opening: (topic: string) => string;
  readonly response: (topic: string) => string;
  readonly goalShare: (topic: string) => string;
  readonly continuation: (topic: string) => string;
};

/**
 * Phrasing variants all keep the signal-bearing fragments (compare notes, your perspective,
 * listen to you, keep each other informed / stay in touch) so the deterministic keyword
 * adjudicator keeps driving relation evolution when no LLM is involved. The variant is picked by
 * a deterministic hash of the participant pair and topic to avoid a town-wide monotone script.
 */
const CANONICAL_SOCIAL_DIALOGUE_VARIANTS: readonly CanonicalSocialDialogueVariant[] = [
  {
    opening: (topic) => `I'd like to compare notes about ${topic}.`,
    response: (topic) => `What part of ${topic} matters most to you right now? I want to hear your perspective.`,
    goalShare: (topic) =>
      `It connects to my current plans, and I want to understand your perspective on ${topic}.`,
    continuation: (topic) => `Let's keep each other informed as we learn more about ${topic}.`,
  },
  {
    opening: (topic) => `Could we compare notes about ${topic} today?`,
    response: (topic) => `Gladly — your perspective on ${topic} would help me too.`,
    goalShare: (topic) => `Here is how ${topic} fits my plans, but I would rather listen to you first.`,
    continuation: (topic) => `Let's stay in touch as ${topic} develops.`,
  },
  {
    opening: (topic) => `I hoped we could compare notes about ${topic}.`,
    response: (topic) => `Of course — I am curious about your perspective on ${topic}.`,
    goalShare: (topic) => `My plans touch ${topic}, and I want to listen to you before I decide.`,
    continuation: (topic) => `We should keep each other informed about ${topic}.`,
  },
] as const;

type CanonicalSocialDialogueArc = 'repair' | 'economic-need' | 'cooperation';

export function createCanonicalSocialDialogueTurns(input: {
  readonly agentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly topic: string;
  readonly openingUtterance?: string;
  readonly responseUtterance?: string;
  readonly context?: WorkerDomainRuntimeFactoryInput;
}): readonly SocialDialogueTurnProposal[] {
  const topic = formatTopicForSentence(input.topic);
  const variant = selectSocialDialogueVariant({
    agentId: input.agentId,
    targetAgentId: input.targetAgentId,
    topic,
  });
  const arc = resolveSocialDialogueArc(input);
  return [
    {
      speakerAgentId: input.agentId,
      utterance: input.openingUtterance ?? variant.opening(topic),
      intent: 'open-contextual-topic',
    },
    {
      speakerAgentId: input.targetAgentId,
      utterance: input.responseUtterance ?? variant.response(topic),
      intent: 'invite-perspective',
    },
    {
      speakerAgentId: input.agentId,
      utterance: variant.goalShare(topic),
      intent: 'share-goal-and-listen',
    },
    ...createSocialDialogueArcTurns({
      arc,
      topic,
      agentId: input.agentId,
      targetAgentId: input.targetAgentId,
    }),
    {
      speakerAgentId: input.targetAgentId,
      utterance: variant.continuation(topic),
      intent: 'continue-relationship',
    },
  ];
}

function resolveSocialDialogueArc(input: {
  readonly agentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly context?: WorkerDomainRuntimeFactoryInput;
}): CanonicalSocialDialogueArc {
  const context = input.context;
  if (context === undefined) {
    return 'cooperation';
  }
  const relationKey: SocialRelationKey = `${input.agentId}->${input.targetAgentId}`;
  const relation = context.projection.socialRelations[relationKey];
  if (
    relation !== undefined &&
    (relation.relationLabel === 'hostile' || relation.relationLabel === 'strained')
  ) {
    return 'repair';
  }
  if (context.agent.job === null || context.agent.balance < LOW_BALANCE_THRESHOLD) {
    return 'economic-need';
  }
  return 'cooperation';
}

function createSocialDialogueArcTurns(input: {
  readonly arc: CanonicalSocialDialogueArc;
  readonly topic: string;
  readonly agentId: AgentId;
  readonly targetAgentId: AgentId;
}): readonly SocialDialogueTurnProposal[] {
  switch (input.arc) {
    case 'repair':
      return [
        {
          speakerAgentId: input.targetAgentId,
          utterance: 'Things have been tense between us, so I appreciate you bringing this up.',
          intent: 'acknowledge-strain',
        },
        {
          speakerAgentId: input.agentId,
          utterance: 'I apologize for my part in it, and I want to make amends between us.',
          intent: 'apologize-make-amends',
        },
      ];
    case 'economic-need':
      return [
        {
          speakerAgentId: input.targetAgentId,
          utterance: `I can help you find steadier ground; let's work together on ${input.topic}.`,
          intent: 'offer-help',
        },
        {
          speakerAgentId: input.agentId,
          utterance: `Thank you — I will share with you every lead I find about ${input.topic}.`,
          intent: 'reciprocate-support',
        },
      ];
    case 'cooperation':
      return [
        {
          speakerAgentId: input.targetAgentId,
          utterance: `Let's work together on ${input.topic}.`,
          intent: 'cooperate',
        },
        {
          speakerAgentId: input.agentId,
          utterance: `I can help with what I know, and I will share with you whatever I learn about ${input.topic}.`,
          intent: 'coordinate',
        },
      ];
  }
}

function selectSocialDialogueVariant(input: {
  readonly agentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly topic: string;
}): CanonicalSocialDialogueVariant {
  let hash = 2_166_136_261;
  for (const character of `${input.agentId}|${input.targetAgentId}|${input.topic}`) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619) >>> 0;
  }
  return CANONICAL_SOCIAL_DIALOGUE_VARIANTS[hash % CANONICAL_SOCIAL_DIALOGUE_VARIANTS.length]!;
}

export function createSocialPlanningPolicyManifest() {
  return {
    policyVersion: SOCIAL_PLANNING_POLICY_VERSION,
    targetCandidateRule: 'latest-observed-or-society-directory-co-located-agents',
    targetWeights: { ...targetWeights },
    lowBalanceThreshold: LOW_BALANCE_THRESHOLD,
    educationGapNormalization: EDUCATION_GAP_NORMALIZATION,
    personalityRule: 'extroverted-or-sociable-prefers-novelty-introverted-prefers-familiarity',
    topicPrecedence: ['config', 'economic-need', 'goal', 'profile', 'world-context'],
    tieBreak: 'agent-id-ascending',
  } as const;
}

type ScoredTargetCandidate = {
  readonly agentId: AgentId;
  readonly score: SocialTargetScoreBreakdown;
};

/**
 * The scoring-relevant view of a social candidate. Local candidates come from
 * this partition's projection with full physiology; society-directory
 * candidates (possibly owned by another partition) only expose their public
 * state, so their physiology is unknown and scored conservatively as
 * unavailable rather than fabricated.
 */
type SocialCandidateView = {
  readonly agentId: AgentId;
  readonly job: string | null;
  readonly educationScore: number;
  readonly physiology?: WorldAgentState['physiology'];
};

function resolveSocialCandidateView(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly agentId: AgentId;
}): SocialCandidateView | undefined {
  const localCandidate = input.context.projection.agents[input.agentId];
  if (localCandidate !== undefined) {
    return localCandidate;
  }
  const directoryCandidate = input.context.worldDecisionContext?.society?.agents.find(
    (candidate) => candidate.agentId === input.agentId,
  );
  if (directoryCandidate === undefined) {
    return undefined;
  }
  return {
    agentId: directoryCandidate.agentId,
    job: directoryCandidate.job,
    educationScore: directoryCandidate.educationScore,
  };
}

function scoreTargetCandidate(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly agentId: AgentId;
  readonly observed: boolean;
}): ScoredTargetCandidate | undefined {
  const candidate = resolveSocialCandidateView(input);
  if (candidate === undefined || candidate.agentId === input.context.agentId) {
    return undefined;
  }
  const relationshipRecord = input.context.longTermProfile?.socialRecords.find(
    (entry) => entry.key === candidate.agentId,
  );
  const relationshipHistory = round(
    targetWeights.relationshipHistory *
      (relationshipRecord === undefined
        ? 0
        : relationshipRecord.confidence +
          (relationshipRecord.relationDelta ?? 0) +
          (relationshipRecord.attitudeDelta ?? 0)),
  );
  const goalRelevance = round(
    targetWeights.goalRelevance *
      scoreGoalRelevance(input.context, input.selectedSubtask, candidate),
  );
  const economicNeed = round(
    targetWeights.economicNeed * scoreEconomicComplementarity(input.context.agent, candidate),
  );
  const personalityFit = round(
    targetWeights.personalityFit *
      scorePersonalityFit(input.context, relationshipRecord !== undefined),
  );
  const worldContext = round(
    targetWeights.worldContext * scoreWorldContext(candidate, input.observed),
  );
  return {
    agentId: candidate.agentId,
    score: {
      relationshipHistory,
      goalRelevance,
      economicNeed,
      personalityFit,
      worldContext,
      total: round(
        relationshipHistory + goalRelevance + economicNeed + personalityFit + worldContext,
      ),
    },
  };
}

function scoreGoalRelevance(
  context: WorkerDomainRuntimeFactoryInput,
  selectedSubtask: PrioritizedSubtask,
  candidate: SocialCandidateView,
): number {
  const goalTokens = tokenize(
    `${context.activeObjective.statement} ${context.activeObjective.affinityTags.join(' ')} ${selectedSubtask.description}`,
  );
  let score = 0;
  const candidateJob = candidate.job?.toLowerCase();
  if (candidateJob !== undefined && [...goalTokens].some((token) => candidateJob.includes(token))) {
    score += 1;
  }
  if (hasAny(goalTokens, ['work', 'job', 'income', 'employ', 'occupation']) && candidate.job !== null) {
    score += 0.75;
  }
  if (hasAny(goalTokens, ['study', 'education', 'learn', 'school'])) {
    score += Math.min(
      1,
      Math.max(0, candidate.educationScore - context.agent.educationScore) /
        EDUCATION_GAP_NORMALIZATION,
    );
  }
  return Math.min(1.5, score);
}

function scoreEconomicComplementarity(
  actor: WorldAgentState,
  candidate: SocialCandidateView,
): number {
  let score = 0;
  if (actor.job === null && candidate.job !== null) {
    score += 1;
  }
  if (actor.balance < LOW_BALANCE_THRESHOLD && candidate.job !== null) {
    score += 0.5;
  }
  if (candidate.educationScore > actor.educationScore) {
    score += Math.min(
      0.5,
      (candidate.educationScore - actor.educationScore) / EDUCATION_GAP_NORMALIZATION,
    );
  }
  return Math.min(1.5, score);
}

function scorePersonalityFit(
  context: WorkerDomainRuntimeFactoryInput,
  hasRelationship: boolean,
): number {
  const personality = (context.longTermProfile?.personality ?? [])
    .map((entry) => `${entry.key} ${entry.statement}`)
    .join(' ')
    .toLowerCase();
  const extroverted = /\b(e[ns][tf][jp]|extrovert|sociable)\w*\b/u.test(personality);
  const introverted = /\b(i[ns][tf][jp]|introvert|reserved)\w*\b/u.test(personality);
  if (extroverted && !hasRelationship) {
    return 1;
  }
  if (introverted && hasRelationship) {
    return 1;
  }
  return 0;
}

function scoreWorldContext(candidate: SocialCandidateView, observed: boolean): number {
  const available =
    candidate.physiology !== undefined &&
    candidate.physiology.energy > 0 &&
    candidate.physiology.satiety > 0 &&
    candidate.physiology.health > 0;
  return (observed ? 0.5 : 0) + (available ? 0.5 : 0);
}

function resolveSocialTopic(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly configuredTopic?: string;
}): SocialPlanningContextTrace['topicSelection'] {
  if (input.configuredTopic !== undefined) {
    return {
      topic: input.configuredTopic,
      source: 'config',
      rationale: 'caller-supplied social topic',
    };
  }
  if (input.context.agent.job === null) {
    return {
      topic: 'employment opportunities and local application strategy',
      source: 'economic-need',
      rationale: 'agent is currently unemployed',
    };
  }
  if (input.context.agent.balance < LOW_BALANCE_THRESHOLD) {
    return {
      topic: 'income stability and local prices',
      source: 'economic-need',
      rationale: `agent balance is below ${LOW_BALANCE_THRESHOLD}`,
    };
  }
  const goalTopic = selectSpecificGoalTopic(input);
  if (goalTopic !== undefined) {
    return {
      topic: goalTopic,
      source: 'goal',
      rationale: 'selected subtask or active objective supplies a specific social purpose',
    };
  }
  const profileTopic = selectProfileTopic(input.context);
  if (profileTopic !== undefined) {
    return {
      topic: profileTopic,
      source: 'profile',
      rationale: 'highest-confidence value or personality entry supplies the topic',
    };
  }
  const observationFocus = latestObservationFocus(input.context);
  return {
    topic: observationFocus ?? 'current town conditions and mutual plans',
    source: 'world-context',
    rationale:
      observationFocus === undefined
        ? 'fallback topic for the current shared town context'
        : 'latest co-located observation focus supplies the topic',
  };
}

function selectSpecificGoalTopic(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
}): string | undefined {
  for (const text of [input.selectedSubtask.description, input.context.activeObjective.statement]) {
    const normalized = formatTopicForSentence(text);
    const meaningfulTokens = tokenize(normalized);
    for (const token of GENERIC_SOCIAL_TOKENS) {
      meaningfulTokens.delete(token);
    }
    if (meaningfulTokens.size >= 2) {
      return normalized;
    }
  }
  return undefined;
}

const GENERIC_SOCIAL_TOKENS = new Set([
  'attend',
  'planned',
  'activity',
  'social',
  'socialize',
  'conversation',
  'talk',
  'balanced',
  'day',
  'run',
]);

function selectProfileTopic(context: WorkerDomainRuntimeFactoryInput): string | undefined {
  const entry = [
    ...(context.longTermProfile?.values ?? []),
    ...(context.longTermProfile?.personality ?? []),
  ].sort(compareProfileEntries)[0];
  return entry === undefined ? undefined : humanizeKey(entry.key);
}

function compareProfileEntries(left: LongTermProfileEntry, right: LongTermProfileEntry): number {
  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  return left.key.localeCompare(right.key);
}

function resolveObservedSocialTargetAgentIds(
  context: WorkerDomainRuntimeFactoryInput,
): readonly AgentId[] {
  const locationId = context.agent.locationId;
  if (locationId === null) {
    return [];
  }
  const latestObservation = [...context.projection.locationObservations]
    .filter((observation) => observation.agentId === context.agentId)
    .filter((observation) => observation.locationId === locationId)
    .sort((left, right) => right.observedAt - left.observedAt)[0];
  if (latestObservation === undefined) {
    return [];
  }
  return latestObservation.observedAgentIds
    .filter((candidate) => candidate !== context.agentId)
    .filter((candidate) => context.projection.agents[candidate]?.locationId === locationId)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Simulation-level social seam: the society directory lists every Agent in the
 * town together with its publicly known location, regardless of which
 * partition owns it. Co-located directory entries are therefore legitimate
 * conversation candidates even when they are invisible in this partition's own
 * projection — authority settlement later verifies the same co-location
 * against the authoritative global state.
 */
function resolveDirectoryCoLocatedAgentIds(
  context: WorkerDomainRuntimeFactoryInput,
): readonly AgentId[] {
  const locationId = context.agent.locationId;
  const society = context.worldDecisionContext?.society;
  if (locationId === null || society === undefined) {
    return [];
  }
  return society.agents
    .filter((candidate) => candidate.agentId !== context.agentId)
    .filter((candidate) => candidate.locationId === locationId)
    .map((candidate) => candidate.agentId)
    .sort((left, right) => left.localeCompare(right));
}

function latestObservationFocus(context: WorkerDomainRuntimeFactoryInput): string | undefined {
  const locationId = context.agent.locationId;
  if (locationId === null) {
    return undefined;
  }
  return [...context.projection.locationObservations]
    .filter((observation) => observation.agentId === context.agentId)
    .filter((observation) => observation.locationId === locationId)
    .sort((left, right) => right.observedAt - left.observedAt)[0]?.focus;
}

function compareTargetCandidates(left: ScoredTargetCandidate, right: ScoredTargetCandidate): number {
  if (left.score.total !== right.score.total) {
    return right.score.total - left.score.total;
  }
  return left.agentId.localeCompare(right.agentId);
}

function hasAny(tokens: ReadonlySet<string>, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => tokens.has(candidate));
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/gu) ?? []);
}

function humanizeKey(key: string): string {
  return key
    .trim()
    .split(/[-_]+/u)
    .filter((token) => token.length > 0)
    .join(' ');
}

function formatTopicForSentence(topic: string): string {
  return topic.trim().replace(/[.!?]+$/u, '');
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
