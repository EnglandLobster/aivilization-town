import { applyPremisesProjection } from './premises';
import type { PrincipalCollectivePort } from '../principalCollectivePort';
import { applyMaterialsProjection } from './materials';
import { applyWorldPrincipalControl } from '../resourcePrincipals';
import { applyPublicHousingActivation, applyApprovedHousing } from '../publicHousing';
import {
  PUBLIC_GOVERNANCE_POLICY,
  createPublicGovernanceState,
  applyPublicGovernanceEvent,
  publicEqual,
} from '@aivilization/governance';
import { assertValidTownGovernancePolicy } from '@aivilization/society';
import type { WorldProjection } from '../projection';
import type { WorldEvent, GovernancePolicyChangedPayload } from '../events';
import { publicPolicyCommand } from '../publicPolicyAction';
import { applyEnactedGovernancePolicy } from './governance';
import { applyPublicEmploymentActivation, applyApprovedEmployment } from '../publicEmployment';

export function applyResidentPublicGovernanceProjection(
  w: WorldProjection,
  e: WorldEvent,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  const activation = applyPublicHousingActivation(w, e) ?? applyPublicEmploymentActivation(w, e);
  if (activation) return activation;
  if (e.type === 'ResidentPublicGovernanceEnabled') {
    if (
      w.publicGovernance ||
      !publicEqual(e.payload.policy, PUBLIC_GOVERNANCE_POLICY) ||
      e.payload.grant.residents.some((id) => !w.agents[id])
    )
      throw Error('invalid-public-governance-activation');
    assertValidTownGovernancePolicy(e.payload.institutionPolicy);
    return {
      ...w,
      publicGovernance: {
        authority: createPublicGovernanceState(e.payload.grant, e.payload.procedure),
        institutionPolicy: structuredClone(e.payload.institutionPolicy),
      },
    };
  }
  if (e.type !== 'ResidentPublicGovernanceCommitted') return undefined;
  const current = w.publicGovernance;
  if (
    !current ||
    e.payload.policyVersion !== PUBLIC_GOVERNANCE_POLICY.version ||
    !e.payload.events.length ||
    e.payload.events.length > 2
  )
    throw Error('invalid-public-governance-commit');
  const [first, second] = e.payload.events;
  if (!first) throw Error('empty-public-governance-commit');
  if (
    first.type !== 'PublicDecisionExecuted' &&
    (second ||
      e.payload.materialCommit ||
      e.payload.premisesCommit ||
      e.payload.principalChange ||
      e.payload.policyChange ||
      e.payload.employmentChange ||
      e.payload.housingChange)
  )
    throw Error('unapproved-public-effects');
  let next = w;
  if (first.type === 'PublicDecisionExecuted') {
    const p = current.authority.proposals[first.proposalId];
    if (e.payload.premisesCommit && p?.action.kind !== 'manage-resource')
      throw Error('unapproved-public-premises-effect');
    if (e.payload.materialCommit && p?.action.kind !== 'manage-resource')
      throw Error('unapproved-public-material-effect');
    if (e.payload.principalChange && p?.action.kind !== 'control-resource')
      throw Error('unapproved-public-principal-effect');
    if (e.payload.housingChange && p?.action.kind !== 'set-housing')
      throw Error('unapproved-public-housing-effect');
    if (e.payload.employmentChange && p?.action.kind !== 'set-employment')
      throw Error('unapproved-public-employment-effect');
    if (!p || first.at !== w.clock.now || !publicEqual(first.effectIds, [e.id]))
      throw Error('public-effect-proof-mismatch');
    const command = publicPolicyCommand(current.authority.grant.id, p, first.actorId);
    if (p.action.kind === 'manage-resource') {
      if (
        second ||
        e.payload.policyChange ||
        e.payload.housingChange ||
        e.payload.employmentChange ||
        e.payload.principalChange ||
        !e.payload.materialCommit === !e.payload.premisesCommit
      )
        throw Error('public-material-effect-mismatch');
      const execution = { proposalId: p.id, proposalRevision: p.revision };
      if (e.payload.premisesCommit) {
        const receipts = e.payload.premisesCommit.events.filter(
            (v) => v.type === 'PremisesPrincipalOperationRecorded',
          ),
          proof =
            receipts[0]?.type === 'PremisesPrincipalOperationRecorded'
              ? receipts[0].receipt.authorization
              : undefined;
        if (
          receipts.length !== 1 ||
          !proof ||
          proof.actorId !== first.actorId ||
          proof.source.kind !== 'public' ||
          proof.source.proposalId !== p.id ||
          !publicEqual(proof.request, p.action.request)
        )
          throw Error('public-premises-proof-mismatch');
        const applied = applyPremisesProjection(
          w,
          { ...e, type: 'ResidentPremisesCommitted', payload: e.payload.premisesCommit },
          execution,
          collective,
        );
        if (!applied) throw Error('missing-public-premises-effects');
        next = applied;
      } else if (e.payload.materialCommit) {
        const receipts = e.payload.materialCommit.events.filter(
          (v) => v.type === 'MaterialReceiptRecorded',
        );
        const proof =
          receipts[0]?.type === 'MaterialReceiptRecorded'
            ? receipts[0].receipt.principalAuthorization
            : undefined;
        if (
          receipts.length !== 1 ||
          !proof ||
          proof.actorId !== first.actorId ||
          proof.source.kind !== 'public' ||
          proof.source.proposalId !== p.id ||
          !publicEqual(proof.request, p.action.request)
        )
          throw Error('public-material-proof-mismatch');
        const applied = applyMaterialsProjection(
          w,
          { ...e, type: 'ResidentMaterialsCommitted', payload: e.payload.materialCommit },
          execution,
          collective,
        );
        if (!applied) throw Error('missing-public-material-effects');
        next = applied;
      }
    } else if (p.action.kind === 'control-resource') {
      if (
        second ||
        e.payload.policyChange ||
        e.payload.housingChange ||
        e.payload.employmentChange ||
        !e.payload.principalChange ||
        !publicEqual(e.payload.principalChange.request, p.action.request)
      )
        throw Error('public-principal-effect-mismatch');
      next = applyWorldPrincipalControl(
        w,
        first.actorId,
        e.payload.principalChange,
        {
          proposalId: p.id,
          proposalRevision: p.revision,
        },
        collective,
      );
    } else if (p.action.kind === 'set-housing') {
      if (
        second ||
        e.payload.policyChange ||
        e.payload.employmentChange ||
        !e.payload.housingChange
      )
        throw Error('public-housing-effect-mismatch');
      next = applyApprovedHousing(w, p, first.actorId, e.payload.housingChange);
    } else if (p.action.kind === 'set-employment') {
      if (second || e.payload.policyChange || !e.payload.employmentChange)
        throw Error('public-employment-effect-mismatch');
      next = applyApprovedEmployment(w, p, first.actorId, e.payload.employmentChange);
    } else if (command) {
      const common = {
        governancePolicyVersion: current.institutionPolicy.policyVersion,
        governanceRevision: p.action.expectedRevision + 1,
        reason: command.reason,
        authority: command.authority,
        changedAt: first.at,
      };
      const expected: GovernancePolicyChangedPayload =
        command.type === 'SetTaxPolicy'
          ? { ...common, policyKind: 'tax', taxPolicy: command.policy }
          : command.type === 'SetPublicBudget'
            ? { ...common, policyKind: 'public-budget', publicBudgetPolicy: command.policy }
            : { ...common, policyKind: 'subsidy', subsidyPolicy: command.policy };
      if (second || !publicEqual(e.payload.policyChange, expected))
        throw Error('public-policy-terms-do-not-match-approved-proposal');
      next = applyEnactedGovernancePolicy(w, expected);
    } else {
      if (e.payload.policyChange || !second) throw Error('missing-public-procedure-effect');
      if (
        (second.type === 'PublicProcedureChanged' && second.proposalId !== p.id) ||
        (second.type === 'PublicDecisionInvalidated' && second.byProposalId !== p.id)
      )
        throw Error('public-procedure-effect-source-mismatch');
      if (
        (p.action.kind === 'set-procedure' && second.type !== 'PublicProcedureChanged') ||
        (p.action.kind === 'invalidate-decision' && second.type !== 'PublicDecisionInvalidated')
      )
        throw Error('public-procedure-effect-kind-mismatch');
    }
  } else if (first.type === 'PublicProcedureChanged' || first.type === 'PublicDecisionInvalidated')
    throw Error('public-procedure-effect-needs-execution');
  // Attribution must refer to a real resident, and direct commits cannot invent other clock instants.
  for (const event of e.payload.events) {
    const actor =
      event.type === 'PublicProposalOpened'
        ? event.proposal.authorId
        : event.type === 'PublicVoteRecorded'
          ? event.vote.actorId
          : event.type === 'PublicObjectionRecorded'
            ? event.objection.actorId
            : 'actorId' in event
              ? event.actorId
              : undefined;
    const at =
      event.type === 'PublicProposalOpened'
        ? event.proposal.createdAt
        : event.type === 'PublicVoteRecorded'
          ? event.vote.at
          : event.type === 'PublicObjectionRecorded'
            ? event.objection.at
            : 'at' in event
              ? event.at
              : undefined;
    if ((actor && !w.agents[actor]) || (at !== undefined && at !== w.clock.now))
      throw Error('public-event-world-facts-mismatch');
  }
  const authority = e.payload.events.reduce(applyPublicGovernanceEvent, current.authority);
  return { ...next, publicGovernance: { ...current, authority } };
}
