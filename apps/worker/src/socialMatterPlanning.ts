import {
  sanitizeDecisionMatterText,
  type AtomicActionProposal,
  type PrioritizedSubtask,
  type WorldDecisionSocialMatterContext,
} from '@aivilization/agent-runtime';
import { commodities } from '@aivilization/content';
import { getInventoryQuantity } from '@aivilization/economy';
import type { AgentId } from '@aivilization/sim-core';
import type {
  AgentAssignMatterPayload,
  AgentCloseMatterPayload,
  AgentGiveResourcePayload,
  AgentRaiseMatterPayload,
  AgentRespondMatterPayload,
} from '@aivilization/world';
import type { WorkerDomainRuntimeFactoryInput } from './domainRuntimeRegistry';

export const SOCIAL_MATTER_ACTION_PROPOSER_POLICY_VERSION = 'social-matter-action-proposer-v1';

/**
 * Versioned application-layer rules for nominating social-matter commands.
 * World remains authoritative for lifecycle transitions and capability checks;
 * this policy only controls which already-visible fact is proposed next.
 */
export type SocialMatterActionProposerPolicy = {
  readonly policyVersion: string;
  readonly defaultRequestQuantity: number;
  readonly autoAcceptRule: 'commodity-capability-or-explicit-accept-intent';
  readonly assignmentSelection: 'visible-accepted-response-order';
  readonly deliveryRule: 'deliver-up-to-remaining-required-quantity';
  readonly deliveryLocationRule: 'known-agent-and-beneficiary-locations';
  readonly withdrawalRule: 'explicit-withdrawal-intent-only';
  readonly raiseRule: 'explicit-help-request-intent-with-visible-open-topic-deduplication';
};

export const DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY: SocialMatterActionProposerPolicy = {
  policyVersion: SOCIAL_MATTER_ACTION_PROPOSER_POLICY_VERSION,
  defaultRequestQuantity: 1,
  autoAcceptRule: 'commodity-capability-or-explicit-accept-intent',
  assignmentSelection: 'visible-accepted-response-order',
  deliveryRule: 'deliver-up-to-remaining-required-quantity',
  deliveryLocationRule: 'known-agent-and-beneficiary-locations',
  withdrawalRule: 'explicit-withdrawal-intent-only',
  raiseRule: 'explicit-help-request-intent-with-visible-open-topic-deduplication',
};

export function assertValidSocialMatterActionProposerPolicy(
  policy: SocialMatterActionProposerPolicy,
): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('social matter action proposer policyVersion must not be empty');
  }
  if (!Number.isFinite(policy.defaultRequestQuantity) || policy.defaultRequestQuantity <= 0) {
    throw new Error('social matter action proposer defaultRequestQuantity must be positive finite');
  }
}

export function createSocialMatterActionProposerPolicyManifest() {
  assertValidSocialMatterActionProposerPolicy(DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY);
  return { ...DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY };
}

export type SocialMatterActionProposal =
  | AtomicActionProposal<'AgentGiveResource', AgentGiveResourcePayload>
  | AtomicActionProposal<'AgentRaiseMatter', AgentRaiseMatterPayload>
  | AtomicActionProposal<'AgentRespondMatter', AgentRespondMatterPayload>
  | AtomicActionProposal<'AgentAssignMatter', AgentAssignMatterPayload>
  | AtomicActionProposal<'AgentCloseMatter', AgentCloseMatterPayload>;

/**
 * Deterministic social-matter proposal. It only nominates transitions grounded
 * in the bounded decision view; world handlers repeat authorization,
 * capability, status, and fulfillment checks against authoritative state.
 */
export function resolveSocialMatterActionProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly actionId: string;
  readonly proposerPolicy?: SocialMatterActionProposerPolicy;
}): SocialMatterActionProposal | undefined {
  const policy = input.proposerPolicy ?? DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY;
  assertValidSocialMatterActionProposerPolicy(policy);
  const matters = input.context.worldDecisionContext?.matters ?? [];
  const agent = input.context.agent;

  const delivery = matters.find(
    (matter) =>
      matter.role === 'assignee' &&
      (matter.status === 'assigned' || matter.status === 'executing') &&
      matter.requiredCommodity !== undefined &&
      agent.locationId !== null &&
      resolveKnownAgentLocationId(input.context, matter.initiatorAgentId) != null,
  );
  if (delivery?.requiredCommodity !== undefined) {
    const remainingQuantity = Math.max(
      0,
      delivery.requiredCommodity.quantity - (delivery.deliveredQuantity ?? 0),
    );
    const availableQuantity = getInventoryQuantity(
      agent.inventory,
      delivery.requiredCommodity.commodityName,
    );
    const quantity = Math.min(remainingQuantity, availableQuantity);
    if (quantity > 0) {
      return {
        id: `${input.actionId}-matter-delivery`,
        description: `Deliver ${quantity} ${delivery.requiredCommodity.commodityName} for matter ${delivery.matterId}.`,
        commandType: 'AgentGiveResource',
        priority: input.selectedSubtask.score,
        payload: {
          targetAgentId: delivery.initiatorAgentId,
          commodityName: delivery.requiredCommodity.commodityName,
          quantity,
          note: `Fulfillment delivery for social matter ${delivery.matterId}.`,
        },
        resourceEstimate: {
          inventoryCosts: { [delivery.requiredCommodity.commodityName]: quantity },
        },
      };
    }
  }

  const selectedText = input.selectedSubtask.description;
  if (hasExplicitMatterWithdrawalIntent(selectedText)) {
    const owned = matters.filter((matter) => matter.role === 'initiator');
    const matter = selectReferencedMatter(owned, selectedText);
    if (matter !== undefined) {
      return {
        id: `${input.actionId}-withdraw-matter`,
        description: `Withdraw social matter ${matter.matterId}.`,
        commandType: 'AgentCloseMatter',
        priority: input.selectedSubtask.score,
        payload: { matterId: matter.matterId, outcome: 'withdrawn' },
      };
    }
  }

  const assignable = matters.find(
    (matter) =>
      matter.role === 'initiator' &&
      (matter.status === 'open' || matter.status === 'collecting') &&
      matter.responses.some((response) => response.decision === 'accept'),
  );
  const acceptedResponse = assignable?.responses.find((response) => response.decision === 'accept');
  if (assignable !== undefined && acceptedResponse !== undefined) {
    return {
      id: `${input.actionId}-assign-matter`,
      description: `Assign social matter ${assignable.matterId} to ${acceptedResponse.responderAgentId}.`,
      commandType: 'AgentAssignMatter',
      priority: input.selectedSubtask.score,
      payload: {
        matterId: assignable.matterId,
        assigneeAgentId: acceptedResponse.responderAgentId,
      },
    };
  }

  const responseCandidate = matters.find((matter) => {
    if (
      (matter.role !== 'available' && matter.role !== 'responder') ||
      (matter.status !== 'open' && matter.status !== 'collecting') ||
      matter.myResponse === 'accept'
    ) {
      return false;
    }
    if (matter.requiredCommodity !== undefined) {
      return (
        getInventoryQuantity(agent.inventory, matter.requiredCommodity.commodityName) >=
        matter.requiredCommodity.quantity
      );
    }
    return (
      hasExplicitMatterAcceptIntent(selectedText) &&
      (matters.length === 1 || matterTextMatches(matter, selectedText))
    );
  });
  if (responseCandidate !== undefined) {
    return {
      id: `${input.actionId}-accept-matter`,
      description: `Accept social matter ${responseCandidate.matterId}.`,
      commandType: 'AgentRespondMatter',
      priority: input.selectedSubtask.score,
      payload: { matterId: responseCandidate.matterId, decision: 'accept' },
    };
  }

  if (!hasExplicitMatterRaiseIntent(selectedText)) {
    return undefined;
  }
  const commodityName = findCommodityNameInText(selectedText);
  const requiredCommodity =
    commodityName === undefined ||
    getInventoryQuantity(agent.inventory, commodityName) >= policy.defaultRequestQuantity
      ? undefined
      : { commodityName, quantity: policy.defaultRequestQuantity };
  const topic =
    commodityName === undefined
      ? 'help-request'
      : sanitizeDecisionMatterText(`help-${commodityName}`, 200);
  const duplicate = matters.some(
    (matter) => matter.role === 'initiator' && matter.topic.toLowerCase() === topic.toLowerCase(),
  );
  if (duplicate) {
    return undefined;
  }
  const statement =
    sanitizeDecisionMatterText(selectedText, 2_000) || 'Request help with a current town need.';
  return {
    id: `${input.actionId}-raise-matter`,
    description: `Raise social matter ${topic}.`,
    commandType: 'AgentRaiseMatter',
    priority: input.selectedSubtask.score,
    payload: {
      topic,
      statement,
      ...(requiredCommodity === undefined ? {} : { requiredCommodity }),
    },
  };
}

export function resolveSocialMatterTargetAgentId(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
}): AgentId | undefined {
  const matters = input.context.worldDecisionContext?.matters ?? [];
  const delivery = matters.find(
    (matter) =>
      matter.role === 'assignee' &&
      (matter.status === 'assigned' || matter.status === 'executing') &&
      matter.requiredCommodity !== undefined &&
      getInventoryQuantity(input.context.agent.inventory, matter.requiredCommodity.commodityName) >
        0,
  );
  if (delivery !== undefined) return delivery.initiatorAgentId;
  const explicit = selectReferencedMatter(matters, input.selectedSubtask.description);
  return explicit?.initiatorAgentId;
}

function resolveKnownAgentLocationId(
  context: WorkerDomainRuntimeFactoryInput,
  agentId: AgentId,
): string | null | undefined {
  const localAgent = context.projection.agents[agentId];
  if (localAgent !== undefined) return localAgent.locationId;
  return context.worldDecisionContext?.society?.agents.find((agent) => agent.agentId === agentId)
    ?.locationId;
}

function selectReferencedMatter(
  matters: readonly WorldDecisionSocialMatterContext[],
  text: string,
): WorldDecisionSocialMatterContext | undefined {
  const matched = matters.find((matter) => matterTextMatches(matter, text));
  return matched ?? (matters.length === 1 ? matters[0] : undefined);
}

function matterTextMatches(matter: WorldDecisionSocialMatterContext, text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    normalized.includes(matter.matterId.toLowerCase()) ||
    normalized.includes(matter.topic.toLowerCase())
  );
}

function findCommodityNameInText(text: string): string | undefined {
  const normalizedTokens = tokenizeText(text);
  return commodities
    .map((commodity) => ({ name: commodity.name, tokens: tokenizeText(commodity.name) }))
    .filter((candidate) => candidate.tokens.length > 0)
    .sort(
      (left, right) =>
        right.tokens.length - left.tokens.length ||
        right.name.length - left.name.length ||
        left.name.localeCompare(right.name),
    )
    .find((candidate) => containsTokenPhrase(normalizedTokens, candidate.tokens))?.name;
}

function tokenizeText(text: string): readonly string[] {
  return text.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
}

function containsTokenPhrase(tokens: readonly string[], phrase: readonly string[]): boolean {
  if (phrase.length === 0 || phrase.length > tokens.length) return false;
  return tokens.some((_, start) =>
    phrase.every((token, offset) => tokens[start + offset] === token),
  );
}

function hasExplicitMatterRaiseIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return ['raise matter', 'request help', 'seek help', 'ask for help', '求助', '请求帮助'].some(
    (phrase) => normalized.includes(phrase),
  );
}

function hasExplicitMatterAcceptIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return ['accept matter', 'accept help request', 'volunteer to help', '接受事项', '接受求助'].some(
    (phrase) => normalized.includes(phrase),
  );
}

function hasExplicitMatterWithdrawalIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return ['withdraw matter', 'cancel matter', 'withdraw help request', '撤回事项', '取消求助'].some(
    (phrase) => normalized.includes(phrase),
  );
}
