import { createEventEnvelope } from '@aivilization/sim-core';
import {
  PUBLIC_PROCUREMENT_GRANT,
  enablePublicProcurementAuthority,
  type PublicProposal,
} from '@aivilization/governance';
import { SERVICE_PUBLIC_FUNDING_POLICY } from '@aivilization/services';
import {
  createInitialTownGovernanceState,
  decideGovernanceChange,
  type GovernanceChangeCommand,
} from '@aivilization/society';
import type { WorldProjection } from './projection';
import type { WorldEvent, GovernancePolicyChangedPayload } from './events';
import { residentServiceEngagementEvent } from './residentServiceEngagements';

export type PublicServiceFundingProof = {
  readonly proposalId: string;
  readonly engagementId: string;
  readonly expectedRevision: number;
  readonly maximumCharge: number;
  readonly actorId: string;
};
export function publicProcurementBudgetCommand(w: WorldProjection): GovernanceChangeCommand {
  return {
    type: 'SetPublicBudget',
    expectedRevision: w.governance?.revision ?? 0,
    authority: { kind: 'operator', subjectId: 'explicit-public-procurement-activation' },
    reason:
      'Explicitly replace abstract automatic budget allocations with actual public service procurement.',
    policy: {
      policyVersion: 'resident-public-procurement-budget-v1',
      cadenceMs: w.governance?.publicBudget?.cadenceMs ?? 86400000,
      minimumTreasuryReserve: w.governance?.publicBudget?.minimumTreasuryReserve ?? 0,
      allocations: [],
    },
  };
}
export function enableResidentPublicProcurementEvent(input: {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const w = input.projection,
    p = w.publicGovernance;
  if (!p || !w.serviceEngagements)
    throw Error('public-procurement-requires-governance-and-services');
  enablePublicProcurementAuthority(p.authority);
  if (w.serviceEngagements.publicFunding) throw Error('public-procurement-inconsistent-activation');
  const d = decideGovernanceChange({
    state: w.governance ?? createInitialTownGovernanceState(),
    command: publicProcurementBudgetCommand(w),
    policy: p.institutionPolicy,
  });
  if (d.status === 'rejected') throw Error(d.reason);
  const { type, ...fact } = d.event;
  void type;
  const policyChange: GovernancePolicyChangedPayload = { ...fact, changedAt: w.clock.now };
  return createEventEnvelope({
    id: `${input.requestId}:public-procurement`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentPublicProcurementEnabled',
    payload: {
      policyVersion: PUBLIC_PROCUREMENT_GRANT.version,
      serviceFunding: {
        type: 'ServicePublicFundingEnabled' as const,
        policy: SERVICE_PUBLIC_FUNDING_POLICY,
      },
      policyChange,
    },
  });
}
export function publicServiceFundingFailure(w: WorldProjection, p: PublicProposal) {
  const a = p.action;
  if (
    a.kind !== 'fund-service' ||
    !w.publicGovernance?.authority.grant.procurement ||
    !w.serviceEngagements?.publicFunding
  )
    return 'public-procurement-not-enabled';
  const e = w.serviceEngagements.engagements[a.engagementId];
  if (!e || e.revision !== a.expectedRevision) return 'public-service-revision-conflict';
  if (
    e.status !== 'accepted' ||
    e.payer.sector !== 'treasury' ||
    e.maximumCharge !== a.maximumCharge
  )
    return 'public-service-terms-or-consent-mismatch';
  return undefined;
}
export function fundPublicService(input: {
  projection: WorldProjection;
  proposal: PublicProposal;
  actorId: string;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}) {
  const reason = publicServiceFundingFailure(input.projection, input.proposal),
    a = input.proposal.action;
  if (reason || a.kind !== 'fund-service')
    return { accepted: false as const, reason: reason ?? 'invalid-public-service-action' };
  return residentServiceEngagementEvent({
    ...input,
    command: { type: 'fund', id: a.engagementId, expectedRevision: a.expectedRevision },
    authorization: {
      authorize: () => undefined,
      controllerAvailable: () => false,
      authorizePublicFunding: (e, actorId) =>
        e.id === a.engagementId &&
        e.revision === a.expectedRevision &&
        e.maximumCharge === a.maximumCharge &&
        actorId === input.actorId
          ? { decisionId: input.proposal.id }
          : undefined,
    },
  });
}
