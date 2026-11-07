import {
  PUBLIC_PROCUREMENT_GRANT,
  PUBLIC_GOODS_PROCUREMENT_GRANT,
  enablePublicProcurementAuthority,
  enablePublicGoodsProcurementAuthority,
  publicEqual,
} from '@aivilization/governance';
import { applyServiceEngagementEvent } from '@aivilization/services';
import { applyEvidenceTradeCommit } from '@aivilization/commerce';
import type { WorldProjection } from '../projection';
import type { WorldEvent, GovernancePolicyChangedPayload } from '../events';
import { publicProcurementBudgetCommand } from '../publicServiceProcurement';
import { applyEnactedGovernancePolicy } from './governance';

export function applyPublicProcurementActivation(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type === 'ResidentPublicGoodsProcurementEnabled') {
    if (
      !w.publicGovernance ||
      !w.residentTrade ||
      !w.logistics ||
      e.occurredAt !== w.clock.now ||
      e.payload.policyVersion !== PUBLIC_GOODS_PROCUREMENT_GRANT.version ||
      e.payload.tradeFunding.type !== 'TradePublicFundingEnabled'
    )
      throw Error('invalid-public-goods-procurement-activation');
    const authority = enablePublicGoodsProcurementAuthority(w.publicGovernance.authority);
    const residentTrade = applyEvidenceTradeCommit(w.residentTrade, [e.payload.tradeFunding]);
    return { ...w, publicGovernance: { ...w.publicGovernance, authority }, residentTrade };
  }
  if (e.type !== 'ResidentPublicProcurementEnabled') return undefined;
  const current = w.publicGovernance;
  if (
    !current ||
    !w.serviceEngagements ||
    e.payload.policyVersion !== PUBLIC_PROCUREMENT_GRANT.version ||
    e.occurredAt !== w.clock.now ||
    e.payload.serviceFunding.type !== 'ServicePublicFundingEnabled'
  )
    throw Error('invalid-public-procurement-activation');
  const command = publicProcurementBudgetCommand(w);
  if (command.type !== 'SetPublicBudget') throw Error('invalid-procurement-budget-command');
  const expected: GovernancePolicyChangedPayload = {
    policyKind: 'public-budget',
    governancePolicyVersion: current.institutionPolicy.policyVersion,
    governanceRevision: (w.governance?.revision ?? 0) + 1,
    reason: command.reason,
    authority: command.authority,
    publicBudgetPolicy: command.policy,
    changedAt: w.clock.now,
  };
  if (!publicEqual(e.payload.policyChange, expected))
    throw Error('invalid-public-procurement-budget-change');
  const authority = enablePublicProcurementAuthority(current.authority);
  const services = applyServiceEngagementEvent(w.serviceEngagements, e.payload.serviceFunding);
  const next = applyEnactedGovernancePolicy(w, e.payload.policyChange);
  return { ...next, publicGovernance: { ...current, authority }, serviceEngagements: services };
}
