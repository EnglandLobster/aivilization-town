import { applyConstructionTradeProjection } from '../residentConstructionTrade';
import { applyResourceSalesProjection } from '../resourceSales';
import { applyPeriodicObligationsProjection } from '../periodicObligations';
import { applyPublicServiceDirectoryEffects } from '../publicServiceDirectoryEffects';
import type { ServicesState } from '@aivilization/services';
import { applyVehiclePrincipalsProjection } from '../vehiclePrincipals';
import { applyPrincipalEvidenceTradeProjection } from '../principalEvidenceTrade';
import { applyPrincipalPremisesRightsProjection } from '../principalPremisesRights';
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
import { applyPublicProcurementActivation } from './publicProcurement';
import { publicServiceFundingFailure } from '../publicServiceProcurement';
import { applyServiceEngagementsProjection } from './serviceEngagements';
import { applyEvidenceTradeProjection } from './evidenceTrade';
import { applyPublicEmploymentActivation, applyApprovedEmployment } from '../publicEmployment';
import { publicGoodsFundingFailure } from '../publicGoodsProcurement';

export function applyResidentPublicGovernanceProjection(
  w: WorldProjection,
  e: WorldEvent,
  collective?: PrincipalCollectivePort,
  directory?: ServicesState,
): WorldProjection | undefined {
  const activation =
    applyPublicHousingActivation(w, e) ??
    applyPublicEmploymentActivation(w, e) ??
    applyPublicProcurementActivation(w, e);
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
      e.payload.serviceDirectoryCommit ||
      e.payload.serviceSupplyCommit ||
      e.payload.serviceAffiliationCommit ||
      e.payload.serviceSupplyRelationsCommit ||
      e.payload.vehicleCommit ||
      e.payload.materialCommit ||
      e.payload.premisesCommit ||
      e.payload.resourceSalesCommit ||
      e.payload.periodicObligationsCommit ||
      e.payload.constructionTradeCommit ||
      e.payload.principalTradeCommit ||
      e.payload.principalPermitsCommit ||
      e.payload.principalChange ||
      e.payload.policyChange ||
      e.payload.serviceCommit ||
      e.payload.goodsCommit ||
      e.payload.employmentChange ||
      e.payload.housingChange)
  )
    throw Error('unapproved-public-effects');
  let next = w;
  if (first.type === 'PublicDecisionExecuted') {
    const p = current.authority.proposals[first.proposalId];
    if (
      e.payload.serviceDirectoryCommit &&
      ((p?.action.kind !== 'manage-resource' && p?.action.kind !== 'control-resource') ||
        p.action.request.resourceKind !== 'service')
    )
      throw Error('unapproved-public-service-directory-effect');
    if (
      e.payload.serviceAffiliationCommit &&
      (p?.action.kind !== 'control-resource' || p.action.request.resourceKind !== 'service')
    )
      throw Error('unapproved-public-service-affiliation-effect');
    if (
      e.payload.serviceSupplyRelationsCommit &&
      ((p?.action.kind !== 'manage-resource' && p?.action.kind !== 'control-resource') ||
        p.action.request.resourceKind !== 'service')
    )
      throw Error('unapproved-public-service-supply-relations-effect');
    if (e.payload.vehicleCommit && p?.action.kind !== 'manage-resource')
      throw Error('unapproved-public-vehicle-principal-effect');
    if (
      e.payload.resourceSalesCommit &&
      (p?.action.kind !== 'manage-resource' || p.action.request.resourceKind !== 'resource-sale')
    )
      throw Error('unapproved-public-resource-sale-effect');
    if (
      e.payload.constructionTradeCommit &&
      (p?.action.kind !== 'manage-resource' ||
        !p.action.request.operation.capability.startsWith('construction-trades.'))
    )
      throw Error('unapproved-public-construction-trade-effect');
    if (e.payload.principalTradeCommit && p?.action.kind !== 'manage-resource')
      throw Error('unapproved-public-principal-trade-effect');
    if (
      e.payload.periodicObligationsCommit &&
      (p?.action.kind !== 'manage-resource' ||
        p.action.request.resourceKind !== 'periodic-obligation')
    )
      throw Error('unapproved-public-periodic-effect');
    if (e.payload.principalPermitsCommit && p?.action.kind !== 'manage-resource')
      throw Error('unapproved-public-principal-permits-effect');
    if (e.payload.premisesCommit && p?.action.kind !== 'manage-resource')
      throw Error('unapproved-public-premises-effect');
    if (e.payload.materialCommit && p?.action.kind !== 'manage-resource')
      throw Error('unapproved-public-material-effect');
    if (e.payload.serviceSupplyCommit && p?.action.kind !== 'manage-resource')
      throw Error('unapproved-public-service-supply-effect');
    if (e.payload.principalChange && p?.action.kind !== 'control-resource')
      throw Error('unapproved-public-principal-effect');
    if (e.payload.housingChange && p?.action.kind !== 'set-housing')
      throw Error('unapproved-public-housing-effect');
    if (e.payload.employmentChange && p?.action.kind !== 'set-employment')
      throw Error('unapproved-public-employment-effect');
    if (!p || first.at !== w.clock.now || !publicEqual(first.effectIds, [e.id]))
      throw Error('public-effect-proof-mismatch');
    const applyDirectory = () => {
      const applied = applyPublicServiceDirectoryEffects(w, e, directory, collective);
      if (!applied) throw Error('missing-public-service-directory-effects');
      return applied;
    };
    const command = publicPolicyCommand(current.authority.grant.id, p, first.actorId);
    if (p.action.kind === 'manage-resource') {
      if (
        second ||
        e.payload.policyChange ||
        e.payload.serviceCommit ||
        e.payload.goodsCommit ||
        e.payload.housingChange ||
        e.payload.employmentChange ||
        e.payload.principalChange ||
        [
          e.payload.serviceDirectoryCommit,
          e.payload.serviceSupplyCommit,
          e.payload.serviceAffiliationCommit,
          e.payload.serviceSupplyRelationsCommit,
          e.payload.vehicleCommit,
          e.payload.materialCommit,
          e.payload.premisesCommit,
          e.payload.principalPermitsCommit,
          e.payload.resourceSalesCommit,
          e.payload.periodicObligationsCommit,
          e.payload.constructionTradeCommit,
          e.payload.principalTradeCommit,
        ].filter(Boolean).length !== 1
      )
        throw Error('public-material-effect-mismatch');
      const execution = { proposalId: p.id, proposalRevision: p.revision };
      if (
        e.payload.serviceDirectoryCommit ||
        e.payload.serviceSupplyCommit ||
        e.payload.serviceAffiliationCommit ||
        e.payload.serviceSupplyRelationsCommit
      ) {
        next = applyDirectory();
      } else if (e.payload.vehicleCommit) {
        const commit = e.payload.vehicleCommit,
          v = commit.events[0];
        if (
          commit.actorId !== first.actorId ||
          commit.events.length !== 1 ||
          v?.type !== 'VehiclePrincipalDriversChanged' ||
          v.authorization.source.kind !== 'public' ||
          v.authorization.source.proposalId !== p.id ||
          !publicEqual(v.authorization.request, p.action.request)
        )
          throw Error('public-vehicle-principal-proof-mismatch');
        const applied = applyVehiclePrincipalsProjection(
          w,
          { ...e, type: 'ResidentVehiclePrincipalsCommitted', payload: commit },
          execution,
          collective,
        );
        if (!applied) throw Error('missing-public-vehicle-principal-effects');
        next = applied;
      } else if (e.payload.resourceSalesCommit) {
        const commit = e.payload.resourceSalesCommit,
          v = commit.event;
        if (
          commit.actorId !== first.actorId ||
          v.type !== 'ResourceSaleCommitted' ||
          v.authorization?.source.kind !== 'public' ||
          v.authorization.source.proposalId !== p.id ||
          !publicEqual(v.authorization.request, p.action.request)
        )
          throw Error('public-resource-sale-proof-mismatch');
        const applied = applyResourceSalesProjection(
          w,
          { ...e, type: 'ResidentResourceSalesCommitted', payload: commit },
          execution,
          collective,
        );
        if (!applied) throw Error('missing-public-resource-sale-effects');
        next = applied;
      } else if (e.payload.periodicObligationsCommit) {
        const commit = e.payload.periodicObligationsCommit,
          v = commit.event,
          proof =
            v.type === 'PeriodicObligationOffered'
              ? v.obligation.offeredAuthorization
              : v.type === 'PeriodicObligationChanged'
                ? v.authorization
                : undefined;
        if (
          commit.actorId !== first.actorId ||
          proof?.source.kind !== 'public' ||
          proof.source.proposalId !== p.id ||
          !publicEqual(proof.request, p.action.request)
        )
          throw Error('public-periodic-proof-mismatch');
        const applied = applyPeriodicObligationsProjection(
          w,
          { ...e, type: 'ResidentPeriodicObligationsCommitted', payload: commit },
          execution,
          collective,
        );
        if (!applied) throw Error('missing-public-periodic-effects');
        next = applied;
      } else if (e.payload.constructionTradeCommit) {
        const commit = e.payload.constructionTradeCommit,
          v = commit.events[0];
        if (
          commit.actorId !== first.actorId ||
          commit.events.length !== 1 ||
          v?.type !== 'ConstructionTradeCommitted' ||
          v.authorization?.source.kind !== 'public' ||
          v.authorization.source.proposalId !== p.id ||
          !publicEqual(v.authorization.request, p.action.request)
        )
          throw Error('public-construction-trade-proof-mismatch');
        const applied = applyConstructionTradeProjection(
          w,
          { ...e, type: 'ResidentConstructionTradeCommitted', payload: commit },
          execution,
          collective,
        );
        if (!applied) throw Error('missing-public-construction-trade-effects');
        next = applied;
      } else if (e.payload.principalTradeCommit) {
        const commit = e.payload.principalTradeCommit,
          v = commit.events[0];
        if (
          commit.actorId !== first.actorId ||
          commit.events.length !== 1 ||
          v?.type !== 'PrincipalTradeCommitted' ||
          v.receipt.authorization?.source.kind !== 'public' ||
          v.receipt.authorization.source.proposalId !== p.id ||
          !publicEqual(v.receipt.authorization.request, p.action.request)
        )
          throw Error('public-principal-trade-proof-mismatch');
        const applied = applyPrincipalEvidenceTradeProjection(
          w,
          { ...e, type: 'ResidentPrincipalEvidenceTradeCommitted', payload: commit },
          execution,
          collective,
        );
        if (!applied) throw Error('missing-public-principal-trade-effects');
        next = applied;
      } else if (e.payload.principalPermitsCommit) {
        const commit = e.payload.principalPermitsCommit,
          v = commit.events[0];
        if (
          commit.actorId !== first.actorId ||
          commit.events.length !== 1 ||
          !v ||
          v.type === 'PrincipalPremisesRightsEnabled' ||
          v.authorization.source.kind !== 'public' ||
          v.authorization.source.proposalId !== p.id ||
          !publicEqual(v.authorization.request, p.action.request)
        )
          throw Error('public-principal-permits-proof-mismatch');
        const applied = applyPrincipalPremisesRightsProjection(
          w,
          { ...e, type: 'ResidentPrincipalPremisesRightsCommitted', payload: commit },
          execution,
          collective,
        );
        if (!applied) throw Error('missing-public-principal-permits-effects');
        next = applied;
      } else if (e.payload.premisesCommit) {
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
    } else if (
      p.action.kind === 'control-resource' &&
      p.action.request.resourceKind === 'service'
    ) {
      if (
        second ||
        e.payload.principalChange ||
        e.payload.materialCommit ||
        e.payload.premisesCommit ||
        e.payload.vehicleCommit ||
        e.payload.principalPermitsCommit ||
        e.payload.resourceSalesCommit ||
        e.payload.constructionTradeCommit ||
        e.payload.principalTradeCommit ||
        e.payload.serviceCommit ||
        e.payload.goodsCommit ||
        e.payload.policyChange ||
        e.payload.housingChange ||
        e.payload.employmentChange
      )
        throw Error('public-service-directory-extra-effects');
      if (
        e.payload.serviceSupplyCommit ||
        [
          e.payload.serviceDirectoryCommit,
          e.payload.serviceAffiliationCommit,
          e.payload.serviceSupplyRelationsCommit,
        ].filter(Boolean).length !== 1
      )
        throw Error('public-service-directory-extra-effects');
      next = applyDirectory();
    } else if (p.action.kind === 'control-resource') {
      if (
        second ||
        e.payload.policyChange ||
        e.payload.serviceCommit ||
        e.payload.goodsCommit ||
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
        e.payload.serviceCommit ||
        e.payload.goodsCommit ||
        e.payload.employmentChange ||
        !e.payload.housingChange
      )
        throw Error('public-housing-effect-mismatch');
      next = applyApprovedHousing(w, p, first.actorId, e.payload.housingChange);
    } else if (p.action.kind === 'set-employment') {
      if (
        second ||
        e.payload.policyChange ||
        e.payload.serviceCommit ||
        e.payload.goodsCommit ||
        !e.payload.employmentChange
      )
        throw Error('public-employment-effect-mismatch');
      next = applyApprovedEmployment(w, p, first.actorId, e.payload.employmentChange);
    } else if (p.action.kind === 'fund-goods') {
      if (
        second ||
        e.payload.policyChange ||
        e.payload.serviceCommit ||
        !e.payload.goodsCommit ||
        publicGoodsFundingFailure(w, p)
      )
        throw Error('public-goods-effect-mismatch');
      const nextGoods = applyEvidenceTradeProjection(
        w,
        { ...e, type: 'ResidentEvidenceTradeCommitted', payload: e.payload.goodsCommit },
        {
          proposalId: p.id,
          orderId: p.action.orderId,
          expectedRevision: p.action.expectedRevision,
          amount: p.action.amount,
          actorId: first.actorId,
        },
      );
      if (!nextGoods) throw Error('missing-public-goods-effect');
      next = nextGoods;
    } else if (p.action.kind === 'fund-service') {
      if (
        second ||
        e.payload.policyChange ||
        e.payload.goodsCommit ||
        !e.payload.serviceCommit ||
        publicServiceFundingFailure(w, p)
      )
        throw Error('public-service-effect-mismatch');
      const nextServices = applyServiceEngagementsProjection(
        w,
        {
          ...e,
          type: 'ResidentServiceEngagementsCommitted',
          payload: e.payload.serviceCommit,
        },
        {
          proposalId: p.id,
          engagementId: p.action.engagementId,
          expectedRevision: p.action.expectedRevision,
          maximumCharge: p.action.maximumCharge,
          actorId: first.actorId,
        },
      );
      if (!nextServices) throw Error('missing-public-service-effect');
      next = nextServices;
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
      if (
        second ||
        e.payload.serviceCommit ||
        e.payload.goodsCommit ||
        !publicEqual(e.payload.policyChange, expected)
      )
        throw Error('public-policy-terms-do-not-match-approved-proposal');
      next = applyEnactedGovernancePolicy(w, expected);
    } else {
      if (e.payload.policyChange || e.payload.serviceCommit || e.payload.goodsCommit || !second)
        throw Error('missing-public-procedure-effect');
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
