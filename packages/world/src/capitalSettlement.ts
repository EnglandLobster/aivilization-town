import type { ResidentEstateCashEffects } from './residentEstateCashEffects';
import {
  prepareCapitalEstateCash,
  capitalEstateCashSource,
  CAPITAL_ESTATE_CONTINUITY_POLICY,
} from './capitalEstateContinuity';
import { hasEnterprisePrincipalAssets } from './principalResourceObligations';
import { assertEnterpriseServiceClosure } from './servicePrincipalEstate';
import type { ServicesState } from '@aivilization/services';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  CAPITAL_AGREEMENTS_POLICY,
  applyEnterpriseDomainEvent,
  capitalFactsEqual,
  type EnterpriseCapitalEvent,
} from '@aivilization/enterprise';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { CapitalInvocation, CapitalCommittedPayload } from './capitalModel';
import {
  capitalTransactions,
  CAPITAL_ESCROW_ACCOUNT,
  worldCapitalEscrowBalance,
} from './capitalAccounting';
import { assertCapitalInvocation } from './capitalAuthority';
import {
  prepareEscrowCommonTransfers,
  applyEscrowAccounting,
  residentEscrowIncoming,
} from './residentEscrowAccounting';
export function enableResidentCapitalEvent(input: {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  if (input.projection.capitalAgreements) throw Error('capital-agreements-already-enabled');
  return createEventEnvelope({
    id: input.requestId,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    type: 'ResidentCapitalEnabled',
    occurredAt: input.projection.clock.now,
    payload: { policy: CAPITAL_AGREEMENTS_POLICY, enabledAt: input.projection.clock.now },
  });
}
type Context = {
  projection: WorldProjection;
  actorId: string;
  enterpriseId: string;
  requestId: string;
  simulationId: string;
  nextSequence: number;
};
export function capitalCommit(
  input: Context & {
    events: readonly EnterpriseCapitalEvent[];
    directory?: ServicesState;
    invocation: CapitalInvocation;
    at?: number;
  },
) {
  const w = input.projection,
    at = input.at ?? w.clock.now,
    eventId = input.requestId;
  if (!w.capitalAgreements || !input.events.length)
    return { accepted: false as const, reason: 'capital-agreements-not-enabled' };
  const originalTransactions = capitalTransactions(input.enterpriseId, input.events, eventId);
  let estateCashEffects: ResidentEstateCashEffects | undefined;
  try {
    estateCashEffects = prepareCapitalEstateCash(
      w,
      input.enterpriseId,
      input.events,
      originalTransactions,
      at,
    );
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'capital-estate-source-invalid',
    };
  }
  const transactions = estateCashEffects?.resolution.transactions ?? originalTransactions;
  const referenceIds = input.events.map((e) =>
    e.type === 'EnterpriseCapitalAgreementCommitted' ? e.event.agreement.id : input.enterpriseId,
  );
  if (new Set(referenceIds).size !== 1)
    return { accepted: false as const, reason: 'one-capital-source-per-commit' };
  const common = prepareEscrowCommonTransfers({
    state: w.commonAccounts,
    context: 'capital',
    referenceId: referenceIds[0]!,
    actorId: input.actorId,
    at,
    requestId: eventId,
    transactions,
  });
  if (!common.accepted) return common;
  const payload: CapitalCommittedPayload = {
    policyVersion: CAPITAL_AGREEMENTS_POLICY.version,
    actorId: input.actorId,
    enterpriseId: input.enterpriseId,
    invocation: input.invocation,
    events: input.events,
    transactions,
    commonAccountEvents: common.events,
    settledAt: at,
    ...(estateCashEffects
      ? { estateCashEffects, estateCashPolicyVersion: CAPITAL_ESTATE_CONTINUITY_POLICY.version }
      : {}),
  };
  const event = createEventEnvelope({
    id: eventId,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    type: 'ResidentCapitalCommitted' as const,
    occurredAt: at,
    payload,
  });
  try {
    assertEnterpriseServiceClosure(w, event, input.directory);
    applyResidentCapitalProjection(w, event);
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-capital-settlement',
    };
  }
  return { accepted: true as const, events: [event] };
}
export function applyResidentCapitalProjection(
  w: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  if (event.type === 'ResidentCapitalEnabled') {
    if (
      w.capitalAgreements ||
      event.occurredAt !== w.clock.now ||
      event.payload.enabledAt !== w.clock.now ||
      !capitalFactsEqual(event.payload.policy, CAPITAL_AGREEMENTS_POLICY)
    )
      throw Error('invalid-capital-activation');
    return { ...w, capitalAgreements: structuredClone(event.payload) };
  }
  if (event.type === 'ResidentCapitalDistributionDeferred') {
    const p = event.payload,
      e = w.enterprises[p.enterpriseId];
    if (
      !w.capitalAgreements ||
      !e?.capital ||
      p.equityVersion !== e.capital.equityVersion ||
      p.at !== event.occurredAt ||
      p.at > w.clock.now ||
      !Number.isSafeInteger(p.at) ||
      p.at < e.foundedAt ||
      !Number.isFinite(p.amount) ||
      p.amount <= 0 ||
      !p.reason.trim()
    )
      throw Error('invalid-capital-distribution-deferral');
    return {
      ...w,
      capitalAgreements: {
        ...w.capitalAgreements,
        deferredDistributions: {
          ...w.capitalAgreements.deferredDistributions,
          [p.enterpriseId]: structuredClone(p),
        },
      },
    };
  }
  if (event.type !== 'ResidentCapitalCommitted') return undefined;
  const p = event.payload,
    e = w.enterprises[p.enterpriseId];
  const originalTransactions = capitalTransactions(p.enterpriseId, p.events, event.id);
  if (
    !w.capitalAgreements ||
    !e ||
    p.policyVersion !== CAPITAL_AGREEMENTS_POLICY.version ||
    !p.events.length ||
    p.settledAt !== event.occurredAt ||
    p.settledAt > w.clock.now ||
    (p.actorId !== 'system' && p.settledAt !== w.clock.now) ||
    !capitalFactsEqual(
      p.transactions,
      p.estateCashEffects?.resolution.transactions ?? originalTransactions,
    )
  )
    throw Error('invalid-capital-commit-source');
  let working = e;
  for (const d of p.events) {
    if (d.type === 'EnterpriseCapitalClosed' && hasEnterprisePrincipalAssets(w, e.enterpriseId))
      throw Error('enterprise-resource-estate-unsettled');
    assertCapitalInvocation(w, working, p.actorId, p.invocation, d);
    const at =
      d.type === 'EnterpriseCapitalEnabled' || d.type === 'EnterpriseCapitalClosed'
        ? d.at
        : d.type === 'EnterpriseCapitalAgreementCommitted'
          ? d.event.at
          : d.paidAt;
    if (
      at !== p.settledAt ||
      (d.type === 'EnterpriseCapitalAgreementCommitted' && d.event.actorId !== p.actorId)
    )
      throw Error('capital-event-time-or-actor-mismatch');
    working = applyEnterpriseDomainEvent(working, d);
  }
  const needsEstate = originalTransactions.some((t) =>
    t.entries.some(
      (entry) =>
        entry.account.sector === 'agent' &&
        !!w.residentExits?.records[entry.account.accountId.slice('agent:'.length)],
    ),
  );
  if (
    needsEstate !== !!p.estateCashEffects ||
    (p.estateCashEffects
      ? p.estateCashPolicyVersion !== CAPITAL_ESTATE_CONTINUITY_POLICY.version
      : p.estateCashPolicyVersion !== undefined) ||
    (p.estateCashEffects &&
      (!p.estateCashEffects.resolution.mappings.length ||
        p.estateCashEffects.resolution.transactions.some((t) =>
          t.entries.some((entry) => entry.account.sector === 'estate' && entry.amount < 0),
        )))
  )
    throw Error('capital-estate-owning-cash-coverage-required');
  const nextEnterprises = { ...w.enterprises, [e.enterpriseId]: working };
  const result = applyEscrowAccounting({
    world: w,
    context: 'capital',
    referenceIds: p.events.map((d) =>
      d.type === 'EnterpriseCapitalAgreementCommitted' ? d.event.agreement.id : p.enterpriseId,
    ),
    actorId: p.actorId,
    transactions: p.transactions,
    commonEvents: p.commonAccountEvents,
    escrowAccount: CAPITAL_ESCROW_ACCOUNT,
    beforeEscrow: worldCapitalEscrowBalance(w.enterprises),
    afterEscrow: worldCapitalEscrowBalance(nextEnterprises),
    settlementAt: p.settledAt,
    capitalEnterpriseEvents: p.events.map((event) => ({ enterpriseId: p.enterpriseId, event })),
    ...(p.estateCashEffects
      ? {
          estateCashSettlement: {
            source: capitalEstateCashSource(p.enterpriseId, p.events),
            originalTransactions,
            effects: p.estateCashEffects,
          },
        }
      : {}),
  });
  if (p.events.some((d) => d.type === 'EnterpriseCapitalClosed'))
    for (const id of e.employeeAgentIds) {
      const a = result.agents[id];
      if (a?.job === e.occupationName) result.agents[id] = { ...a, job: null };
    }
  const next = {
    ...w,
    agents: result.agents,
    enterprises: result.enterprises,
    ...(result.common ? { commonAccounts: result.common } : {}),
    ...(result.residentExits ? { residentExits: result.residentExits } : {}),
  };
  for (const account of Object.values(next.commonAccounts?.accounts ?? {}))
    if (
      account.balance + residentEscrowIncoming(next, account.id) >
      next.commonAccounts!.policy.maxBalance + 1e-8
    )
      throw Error('capital-refund-or-receipt-headroom-required');
  return next;
}
