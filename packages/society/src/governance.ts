import { assertValidPublicBudgetPolicy, type PublicBudgetPolicy } from './publicBudget';
import { assertValidTaxPolicy, type TaxPolicy } from './tax';
import type { SafetyNetSubsidyPolicy } from './welfare';

export const TOWN_GOVERNANCE_POLICY_VERSION = 'town-governance-v1';
export const TOWN_GOVERNANCE_TAX_POLICY_VERSION = 'town-governance-tax-v1';
export const TOWN_GOVERNANCE_PUBLIC_BUDGET_POLICY_VERSION =
  'town-governance-public-budget-v1';
export const TOWN_GOVERNANCE_SUBSIDY_POLICY_VERSION = 'town-governance-subsidy-v1';
export const TOWN_GOVERNANCE_ENACTED_POLICY_SOURCE = 'town-governance-command';

export type TownGovernancePolicy = {
  readonly policyVersion: string;
  readonly allowedBudgetServices: readonly string[];
  readonly maximumAllocationPerCadence: number;
  readonly maximumTreasuryReserve: number;
  readonly maximumSubsidyBalanceFloor: number;
  readonly maximumSubsidyPerCadence: number;
  readonly source?: string;
};

export type GovernedSubsidyPolicy = SafetyNetSubsidyPolicy & {
  readonly policyVersion: string;
  readonly source: string;
};

export type GovernanceChangeAuthority =
  | {
      readonly kind: 'operator';
      readonly subjectId: string;
    }
  | {
      readonly kind: 'threshold-petition';
      readonly agentId: string;
      readonly petitionId: string;
    };

export type TownGovernanceState = {
  readonly revision: number;
  readonly tax?: TaxPolicy;
  readonly publicBudget?: PublicBudgetPolicy;
  readonly subsidy?: GovernedSubsidyPolicy;
  readonly consumedPetitionIds: readonly string[];
};

export type GovernanceChangeCommand =
  | {
      readonly type: 'SetTaxPolicy';
      readonly policy: TaxPolicy;
      readonly reason: string;
      readonly authority: GovernanceChangeAuthority;
      readonly expectedRevision?: number;
    }
  | {
      readonly type: 'SetPublicBudget';
      readonly policy: PublicBudgetPolicy;
      readonly reason: string;
      readonly authority: GovernanceChangeAuthority;
      readonly expectedRevision?: number;
    }
  | {
      readonly type: 'SetSubsidyPolicy';
      readonly policy: GovernedSubsidyPolicy;
      readonly reason: string;
      readonly authority: GovernanceChangeAuthority;
      readonly expectedRevision?: number;
    };

export type GovernancePolicyChangedDomainEvent = {
  readonly type: 'GovernancePolicyChanged';
  readonly policyKind: 'tax' | 'public-budget' | 'subsidy';
  readonly governancePolicyVersion: string;
  readonly governanceRevision: number;
  readonly reason: string;
  readonly authority: GovernanceChangeAuthority;
  readonly taxPolicy?: TaxPolicy;
  readonly publicBudgetPolicy?: PublicBudgetPolicy;
  readonly subsidyPolicy?: GovernedSubsidyPolicy;
};

export type GovernanceChangeRejectionReason =
  | 'governance-revision-conflict'
  | 'petition-already-consumed'
  | 'invalid-policy'
  | 'policy-unchanged';

export type GovernanceChangeDecision =
  | {
      readonly status: 'accepted';
      readonly event: GovernancePolicyChangedDomainEvent;
    }
  | {
      readonly status: 'rejected';
      readonly reason: GovernanceChangeRejectionReason;
      readonly detail: string;
    };

export function createInitialTownGovernanceState(): TownGovernanceState {
  return { revision: 0, consumedPetitionIds: [] };
}

export function decideGovernanceChange(input: {
  readonly state: TownGovernanceState;
  readonly command: GovernanceChangeCommand;
  readonly policy: TownGovernancePolicy;
}): GovernanceChangeDecision {
  assertValidTownGovernancePolicy(input.policy);
  assertValidGovernanceState(input.state);
  assertValidChangeMetadata(input.command);

  if (
    input.command.expectedRevision !== undefined &&
    input.command.expectedRevision !== input.state.revision
  ) {
    return {
      status: 'rejected',
      reason: 'governance-revision-conflict',
      detail: `expected governance revision ${input.command.expectedRevision}, current revision is ${input.state.revision}`,
    };
  }
  if (
    input.command.authority.kind === 'threshold-petition' &&
    input.state.consumedPetitionIds.includes(input.command.authority.petitionId)
  ) {
    return {
      status: 'rejected',
      reason: 'petition-already-consumed',
      detail: `petition ${input.command.authority.petitionId} already authorized a governance change`,
    };
  }

  const invalidDetail = validateProposedPolicy(input.command, input.policy);
  if (invalidDetail !== undefined) {
    return { status: 'rejected', reason: 'invalid-policy', detail: invalidDetail };
  }

  const current = currentPolicyForCommand(input.state, input.command.type);
  const proposed = proposedPolicyForCommand(input.command);
  if (JSON.stringify(current) === JSON.stringify(proposed)) {
    return {
      status: 'rejected',
      reason: 'policy-unchanged',
      detail: `${input.command.type} did not change the current policy`,
    };
  }

  const common = {
    type: 'GovernancePolicyChanged' as const,
    governancePolicyVersion: input.policy.policyVersion,
    governanceRevision: input.state.revision + 1,
    reason: input.command.reason.trim(),
    authority: cloneAuthority(input.command.authority),
  };
  const event: GovernancePolicyChangedDomainEvent =
    input.command.type === 'SetTaxPolicy'
      ? {
          ...common,
          policyKind: 'tax',
          taxPolicy: cloneTaxPolicy(input.command.policy),
        }
      : input.command.type === 'SetPublicBudget'
        ? {
            ...common,
            policyKind: 'public-budget',
            publicBudgetPolicy: clonePublicBudgetPolicy(input.command.policy),
          }
        : {
            ...common,
            policyKind: 'subsidy',
            subsidyPolicy: { ...input.command.policy },
          };
  return { status: 'accepted', event };
}

export function applyGovernanceDomainEvent(
  state: TownGovernanceState,
  event: GovernancePolicyChangedDomainEvent,
): TownGovernanceState {
  if (event.governanceRevision !== state.revision + 1) {
    throw new Error(
      `governance event revision ${event.governanceRevision} does not follow state revision ${state.revision}`,
    );
  }
  const consumedPetitionIds =
    event.authority.kind === 'threshold-petition'
      ? [...state.consumedPetitionIds, event.authority.petitionId]
      : [...state.consumedPetitionIds];
  if (event.policyKind === 'tax') {
    if (event.taxPolicy === undefined) throw new Error('tax governance event requires taxPolicy');
    return {
      ...state,
      revision: event.governanceRevision,
      tax: cloneTaxPolicy(event.taxPolicy),
      consumedPetitionIds,
    };
  }
  if (event.policyKind === 'public-budget') {
    if (event.publicBudgetPolicy === undefined) {
      throw new Error('public-budget governance event requires publicBudgetPolicy');
    }
    return {
      ...state,
      revision: event.governanceRevision,
      publicBudget: clonePublicBudgetPolicy(event.publicBudgetPolicy),
      consumedPetitionIds,
    };
  }
  if (event.subsidyPolicy === undefined) {
    throw new Error('subsidy governance event requires subsidyPolicy');
  }
  return {
    ...state,
    revision: event.governanceRevision,
    subsidy: { ...event.subsidyPolicy },
    consumedPetitionIds,
  };
}

export function assertValidTownGovernancePolicy(policy: TownGovernancePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('town governance policyVersion must not be empty');
  }
  if (policy.allowedBudgetServices.length === 0) {
    throw new Error('town governance allowedBudgetServices must not be empty');
  }
  const services = new Set<string>();
  for (const service of policy.allowedBudgetServices) {
    if (service.trim().length === 0 || services.has(service)) {
      throw new Error('town governance allowedBudgetServices must be unique non-empty strings');
    }
    services.add(service);
  }
  assertNonNegativeFinite(policy.maximumAllocationPerCadence, 'maximumAllocationPerCadence');
  assertNonNegativeFinite(policy.maximumTreasuryReserve, 'maximumTreasuryReserve');
  assertNonNegativeFinite(policy.maximumSubsidyBalanceFloor, 'maximumSubsidyBalanceFloor');
  assertNonNegativeFinite(policy.maximumSubsidyPerCadence, 'maximumSubsidyPerCadence');
}

function validateProposedPolicy(
  command: GovernanceChangeCommand,
  governancePolicy: TownGovernancePolicy,
): string | undefined {
  try {
    if (command.type === 'SetTaxPolicy') {
      assertValidTaxPolicy(command.policy);
      return undefined;
    }
    if (command.type === 'SetPublicBudget') {
      assertValidPublicBudgetPolicy(command.policy);
      if (command.policy.minimumTreasuryReserve > governancePolicy.maximumTreasuryReserve) {
        throw new Error(
          `minimumTreasuryReserve exceeds ${governancePolicy.maximumTreasuryReserve}`,
        );
      }
      const allowed = new Set(governancePolicy.allowedBudgetServices);
      for (const allocation of command.policy.allocations) {
        if (!allowed.has(allocation.service)) {
          throw new Error(`public budget service ${allocation.service} is not governable`);
        }
        if (allocation.amountPerCadence > governancePolicy.maximumAllocationPerCadence) {
          throw new Error(
            `${allocation.service} amountPerCadence exceeds ${governancePolicy.maximumAllocationPerCadence}`,
          );
        }
      }
      return undefined;
    }
    if (command.policy.policyVersion.trim().length === 0 || command.policy.source.trim().length === 0) {
      throw new Error('subsidy policyVersion and source must not be empty');
    }
    assertNonNegativeFinite(command.policy.minimumBalance, 'subsidy minimumBalance');
    assertNonNegativeFinite(command.policy.maxSubsidy, 'subsidy maxSubsidy');
    if (command.policy.minimumBalance > governancePolicy.maximumSubsidyBalanceFloor) {
      throw new Error(
        `subsidy minimumBalance exceeds ${governancePolicy.maximumSubsidyBalanceFloor}`,
      );
    }
    if (command.policy.maxSubsidy > governancePolicy.maximumSubsidyPerCadence) {
      throw new Error(`subsidy maxSubsidy exceeds ${governancePolicy.maximumSubsidyPerCadence}`);
    }
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function assertValidGovernanceState(state: TownGovernanceState): void {
  if (!Number.isInteger(state.revision) || state.revision < 0) {
    throw new Error('town governance revision must be a non-negative integer');
  }
  if (new Set(state.consumedPetitionIds).size !== state.consumedPetitionIds.length) {
    throw new Error('town governance consumedPetitionIds must be unique');
  }
}

function assertValidChangeMetadata(command: GovernanceChangeCommand): void {
  if (command.reason.trim().length === 0 || command.reason.length > 500) {
    throw new Error('governance change reason must be 1..500 characters');
  }
  if (
    command.expectedRevision !== undefined &&
    (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 0)
  ) {
    throw new Error('expected governance revision must be a non-negative integer');
  }
  if (command.authority.kind === 'operator') {
    if (command.authority.subjectId.trim().length === 0) {
      throw new Error('governance operator subjectId must not be empty');
    }
  } else if (
    command.authority.agentId.trim().length === 0 ||
    command.authority.petitionId.trim().length === 0
  ) {
    throw new Error('governance petition authority ids must not be empty');
  }
}

function currentPolicyForCommand(
  state: TownGovernanceState,
  type: GovernanceChangeCommand['type'],
): TaxPolicy | PublicBudgetPolicy | GovernedSubsidyPolicy | undefined {
  return type === 'SetTaxPolicy'
    ? state.tax
    : type === 'SetPublicBudget'
      ? state.publicBudget
      : state.subsidy;
}

function proposedPolicyForCommand(
  command: GovernanceChangeCommand,
): TaxPolicy | PublicBudgetPolicy | GovernedSubsidyPolicy {
  return command.policy;
}

function cloneAuthority(authority: GovernanceChangeAuthority): GovernanceChangeAuthority {
  return authority.kind === 'operator' ? { ...authority } : { ...authority };
}

function cloneTaxPolicy(policy: TaxPolicy): TaxPolicy {
  return {
    ...policy,
    incomeTaxBrackets: policy.incomeTaxBrackets.map((bracket) => ({ ...bracket })),
  };
}

function clonePublicBudgetPolicy(policy: PublicBudgetPolicy): PublicBudgetPolicy {
  return {
    ...policy,
    allocations: policy.allocations.map((allocation) => ({ ...allocation })),
  };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}
