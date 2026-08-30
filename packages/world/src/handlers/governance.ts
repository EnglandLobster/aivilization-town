import type { AgentId, CommandEnvelope, CoreCommandType } from '@aivilization/sim-core';
import {
  TOWN_GOVERNANCE_ENACTED_POLICY_SOURCE,
  TOWN_GOVERNANCE_PUBLIC_BUDGET_POLICY_VERSION,
  TOWN_GOVERNANCE_SUBSIDY_POLICY_VERSION,
  TOWN_GOVERNANCE_TAX_POLICY_VERSION,
  createInitialTownGovernanceState,
  decideGovernanceChange,
  type GovernanceChangeAuthority,
  type GovernanceChangeCommand,
  type TownGovernancePolicy,
} from '@aivilization/society';
import {
  assertSetPublicBudgetPayload,
  assertSetSubsidyPolicyPayload,
  assertSetTaxPolicyPayload,
  type GovernanceCommandMetadataPayload,
} from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import { copyHumanAttribution, makeEvent, parsePayload } from './shared';

type GovernanceCommandType = 'SetTaxPolicy' | 'SetPublicBudget' | 'SetSubsidyPolicy';

export function handleSetTaxPolicyCommand(input: {
  readonly command: CommandEnvelope<'SetTaxPolicy', unknown>;
  readonly projection: WorldProjection;
  readonly governance?: TownGovernancePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  return handleGovernanceCommand(input, assertSetTaxPolicyPayload, (payload, authority) => ({
    type: 'SetTaxPolicy',
    reason: payload.reason,
    authority,
    ...(payload.expectedGovernanceRevision === undefined
      ? {}
      : { expectedRevision: payload.expectedGovernanceRevision }),
    policy: {
      policyVersion: TOWN_GOVERNANCE_TAX_POLICY_VERSION,
      neutralRate: payload.neutralRate,
      incomeTaxBrackets: payload.incomeTaxBrackets.map((bracket) => ({ ...bracket })),
      tradeTaxRate: payload.tradeTaxRate,
      ...(payload.dividendTaxRate === undefined
        ? {}
        : { dividendTaxRate: payload.dividendTaxRate }),
      source: TOWN_GOVERNANCE_ENACTED_POLICY_SOURCE,
    },
  }));
}

export function handleSetPublicBudgetCommand(input: {
  readonly command: CommandEnvelope<'SetPublicBudget', unknown>;
  readonly projection: WorldProjection;
  readonly governance?: TownGovernancePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  return handleGovernanceCommand(input, assertSetPublicBudgetPayload, (payload, authority) => ({
    type: 'SetPublicBudget',
    reason: payload.reason,
    authority,
    ...(payload.expectedGovernanceRevision === undefined
      ? {}
      : { expectedRevision: payload.expectedGovernanceRevision }),
    policy: {
      policyVersion: TOWN_GOVERNANCE_PUBLIC_BUDGET_POLICY_VERSION,
      cadenceMs: payload.cadenceMs,
      minimumTreasuryReserve: payload.minimumTreasuryReserve,
      allocations: payload.allocations.map((allocation) => ({ ...allocation })),
    },
  }));
}

export function handleSetSubsidyPolicyCommand(input: {
  readonly command: CommandEnvelope<'SetSubsidyPolicy', unknown>;
  readonly projection: WorldProjection;
  readonly governance?: TownGovernancePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  return handleGovernanceCommand(input, assertSetSubsidyPolicyPayload, (payload, authority) => ({
    type: 'SetSubsidyPolicy',
    reason: payload.reason,
    authority,
    ...(payload.expectedGovernanceRevision === undefined
      ? {}
      : { expectedRevision: payload.expectedGovernanceRevision }),
    policy: {
      policyVersion: TOWN_GOVERNANCE_SUBSIDY_POLICY_VERSION,
      minimumBalance: payload.minimumBalance,
      maxSubsidy: payload.maxSubsidy,
      source: TOWN_GOVERNANCE_ENACTED_POLICY_SOURCE,
    },
  }));
}

function handleGovernanceCommand<TPayload extends GovernanceCommandMetadataPayload>(
  input: {
    readonly command: CommandEnvelope<GovernanceCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly governance?: TownGovernancePolicy;
    readonly nextSequence: number;
  },
  parse: (payload: unknown) => TPayload,
  toDomainCommand: (
    payload: TPayload,
    authority: GovernanceChangeAuthority,
  ) => GovernanceChangeCommand,
): WorldEvent[] {
  if (input.governance === undefined) {
    return rejectGovernanceCommand(input, 'missing-governance-policy', 'town governance is disabled');
  }
  const parsed = parsePayload(() => parse(input.command.payload));
  if (parsed.status === 'invalid') {
    return rejectGovernanceCommand(input, 'invalid-command-payload', parsed.reason);
  }
  const authority = resolveGovernanceAuthority({
    command: input.command,
    projection: input.projection,
    payload: parsed.payload,
  });
  if (authority.status === 'rejected') {
    return rejectGovernanceCommand(
      input,
      'governance-authorization-rejected',
      authority.detail,
    );
  }
  const decision = decideGovernanceChange({
    state: input.projection.governance ?? createInitialTownGovernanceState(),
    command: toDomainCommand(parsed.payload, authority.authority),
    policy: input.governance,
  });
  if (decision.status === 'rejected') {
    return rejectGovernanceCommand(input, decision.reason, decision.detail);
  }
  return [
    makeEvent(input, 0, 'GovernancePolicyChanged', {
      policyKind: decision.event.policyKind,
      governancePolicyVersion: decision.event.governancePolicyVersion,
      governanceRevision: decision.event.governanceRevision,
      reason: decision.event.reason,
      authority: { ...decision.event.authority },
      ...(decision.event.taxPolicy === undefined
        ? {}
        : {
            taxPolicy: {
              ...decision.event.taxPolicy,
              incomeTaxBrackets: decision.event.taxPolicy.incomeTaxBrackets.map((bracket) => ({
                ...bracket,
              })),
            },
          }),
      ...(decision.event.publicBudgetPolicy === undefined
        ? {}
        : {
            publicBudgetPolicy: {
              ...decision.event.publicBudgetPolicy,
              allocations: decision.event.publicBudgetPolicy.allocations.map((allocation) => ({
                ...allocation,
              })),
            },
          }),
      ...(decision.event.subsidyPolicy === undefined
        ? {}
        : { subsidyPolicy: { ...decision.event.subsidyPolicy } }),
      changedAt: input.projection.clock.now,
    }),
  ];
}

function resolveGovernanceAuthority(input: {
  readonly command: CommandEnvelope<GovernanceCommandType, unknown>;
  readonly projection: WorldProjection;
  readonly payload: GovernanceCommandMetadataPayload;
}):
  | { readonly status: 'accepted'; readonly authority: GovernanceChangeAuthority }
  | { readonly status: 'rejected'; readonly detail: string } {
  const attribution = input.command.humanAttribution;
  if (
    input.command.source === 'human' &&
    attribution !== undefined &&
    attribution.principalRoles.includes('operator')
  ) {
    return {
      status: 'accepted',
      authority: { kind: 'operator', subjectId: attribution.principalSubjectId },
    };
  }
  const actorId = input.command.actorId;
  if (actorId === undefined || input.projection.agents[actorId] === undefined) {
    return { status: 'rejected', detail: 'resident governance requires a known actorId' };
  }
  if (input.command.source !== 'agent-runtime' && input.command.source !== 'human') {
    return {
      status: 'rejected',
      detail: 'resident governance requires an agent-runtime or attributed human command',
    };
  }
  if (input.payload.petitionId === undefined) {
    return { status: 'rejected', detail: 'resident governance requires petitionId' };
  }
  const petition = (input.projection.petitions ?? []).find(
    (candidate) => candidate.petitionId === input.payload.petitionId,
  );
  if (petition === undefined || petition.status !== 'threshold-reached') {
    return {
      status: 'rejected',
      detail: `petition ${input.payload.petitionId} has not reached its threshold`,
    };
  }
  const requiredTopic = governanceTopicForCommand(input.command.type);
  if (normalizeTopic(petition.topic) !== requiredTopic) {
    return {
      status: 'rejected',
      detail: `petition ${petition.petitionId} topic must be ${requiredTopic}`,
    };
  }
  if (!petition.signatureAgentIds.includes(actorId)) {
    return {
      status: 'rejected',
      detail: `agent ${actorId} did not sign petition ${petition.petitionId}`,
    };
  }
  return {
    status: 'accepted',
    authority: { kind: 'threshold-petition', agentId: actorId, petitionId: petition.petitionId },
  };
}

function rejectGovernanceCommand(
  input: {
    readonly command: CommandEnvelope<GovernanceCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly governance?: TownGovernancePolicy;
    readonly nextSequence: number;
  },
  reason: Extract<
    WorldEvent,
    { readonly type: 'GovernanceChangeRejected' }
  >['payload']['reason'],
  detail: string,
): WorldEvent[] {
  return [
    makeEvent(input, 0, 'GovernanceChangeRejected', {
      commandType: input.command.type,
      governancePolicyVersion: input.governance?.policyVersion ?? 'town-governance-disabled',
      reason,
      detail,
      ...(input.command.actorId === undefined
        ? {}
        : { actorAgentId: input.command.actorId as AgentId }),
      ...copyHumanAttribution(input.command as CommandEnvelope<CoreCommandType, unknown>),
      rejectedAt: input.projection.clock.now,
    }),
  ];
}

function governanceTopicForCommand(commandType: GovernanceCommandType): string {
  return commandType === 'SetTaxPolicy'
    ? 'tax-policy'
    : commandType === 'SetPublicBudget'
      ? 'public-budget'
      : 'subsidy-policy';
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}
