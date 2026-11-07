import {
  samePrincipal,
  validResourcePrincipal,
  type PrincipalOperationRequest,
  type ResourcePrincipal,
} from '@aivilization/authority';
import {
  createMoneyTransfer,
  economicAccount,
  commonAccountNextBalance,
} from '@aivilization/economy';
import { decodePeriodicAccount } from './periodicObligationCommand';
import { tradeFactsEqual, tradeMoneyMicros } from './tradeFacts';
import {
  PERIODIC_OBLIGATIONS_POLICY as POLICY,
  type PeriodicAccountFacts,
  type PeriodicSourceRead,
  type PeriodicTerms,
  type PeriodicObligation,
  type PeriodicCommand,
  type PeriodicObligationsState,
  type PeriodicPorts,
  type PeriodicEvent,
  type PeriodicFailure,
} from './periodicObligationModel';
export const PERIODIC_OBLIGATIONS_CLEARING = economicAccount(
  'public-service',
  'resident-periodic-obligations',
);
export const periodicDueAt = (c: PeriodicTerms, period: number) =>
  c.firstDueAt + (period - 1) * c.periodMs;
export const nextPeriodicDueAt = (c: PeriodicObligation) =>
  c.status === 'active' && c.cursor < c.periods ? periodicDueAt(c, c.cursor + 1) : undefined;
export function readPeriodicAccounts(p: PeriodicPorts, t: PeriodicTerms): PeriodicSourceRead {
  return structuredClone({
    payer: p.account(t.payer) ?? null,
    revenue: p.account(t.revenue) ?? null,
  });
}
function assertAccountFacts(f: PeriodicAccountFacts) {
  decodePeriodicAccount(f.account);
  if (
    !validResourcePrincipal(f.principal) ||
    !['open', 'settling', 'closed', 'unavailable'].includes(f.status) ||
    !Number.isFinite(f.balance) ||
    f.balance < 0 ||
    !Number.isFinite(f.maximumBalance) ||
    f.maximumBalance < 0 ||
    (f.account.sector === 'agent' &&
      (f.principal.kind !== 'resident' || f.principal.id !== f.account.id)) ||
    (f.account.sector === 'enterprise' &&
      (f.principal.kind !== 'enterprise' || f.principal.id !== f.account.id)) ||
    (f.account.sector === 'collective' && f.principal.kind !== 'collective') ||
    (f.account.sector === 'treasury' && f.principal.kind !== 'public')
  )
    throw Error('invalid-periodic-account-facts');
}
export function assertPeriodicSourceRead(t: PeriodicTerms, r: PeriodicSourceRead) {
  for (const side of ['payer', 'revenue'] as const) {
    const f = r[side];
    if (f) {
      assertAccountFacts(f);
      if (!tradeFactsEqual(f.account, t[side])) throw Error('periodic-account-source-mismatch');
    }
  }
}
/** Versioned factual outcome of an already authorized installment; no prices, interest, interpretation or new borrowing. */
export function periodicPaymentFailure(
  c: PeriodicObligation,
  r: PeriodicSourceRead,
): PeriodicFailure | undefined {
  assertPeriodicSourceRead(c, r);
  const p = r.payer,
    revenue = r.revenue;
  if (!p || p.status === 'closed' || p.status === 'unavailable')
    return 'periodic-payer-unavailable';
  if (!revenue || revenue.status === 'closed' || revenue.status === 'unavailable')
    return 'periodic-revenue-unavailable';
  if (
    !samePrincipal(p.principal, c.payerPrincipal) ||
    !samePrincipal(revenue.principal, c.revenuePrincipal)
  )
    return 'periodic-account-principal-changed';
  if (p.balance < c.amount) return 'periodic-insufficient-funds';
  if (revenue.balance + c.amount > revenue.maximumBalance) return 'periodic-revenue-capacity';
  if (
    commonAccountNextBalance(p.balance, -c.amount, Number.MAX_VALUE) === undefined ||
    commonAccountNextBalance(revenue.balance, c.amount, revenue.maximumBalance) === undefined
  )
    return 'periodic-money-range';
  return undefined;
}
export function periodicRequest(
  s: PeriodicObligationsState,
  c: PeriodicCommand,
  r?: PeriodicSourceRead,
): PrincipalOperationRequest {
  const old = s.contracts[c.id];
  let terms: PeriodicTerms, payerPrincipal: ResourcePrincipal, revenuePrincipal: ResourcePrincipal;
  if (c.type === 'offer') {
    if (!r?.payer || !r.revenue) throw Error('periodic-actual-account-source-required');
    const { type: operation, ...t } = c;
    void operation;
    terms = t;
    payerPrincipal = r.payer.principal;
    revenuePrincipal = r.revenue.principal;
  } else {
    if (!old) throw Error('periodic-obligation-not-found');
    terms = {
      id: old.id,
      title: old.title,
      terms: old.terms,
      payer: old.payer,
      revenue: old.revenue,
      amount: old.amount,
      firstDueAt: old.firstDueAt,
      periodMs: old.periodMs,
      periods: old.periods,
      acceptBy: old.acceptBy,
    };
    payerPrincipal = old.payerPrincipal;
    revenuePrincipal = old.revenuePrincipal;
  }
  return {
    resourceKind: 'periodic-obligation',
    resourceId: c.id,
    resourceRevision: c.type === 'offer' ? 1 : c.expectedRevision,
    controlVersion: 1,
    operation: {
      capability: `obligations.${c.type}`,
      arguments: {
        command: structuredClone(c),
        terms: structuredClone(terms),
        payerPrincipal: structuredClone(payerPrincipal),
        revenuePrincipal: structuredClone(revenuePrincipal),
        policyVersion: POLICY.version,
        maximumTotalMicros: tradeMoneyMicros(terms.amount) * terms.periods,
      },
    },
  };
}
/** Original party roles are frozen. Either can stop future periods; neither may erase the other's accrued claim. */
export function periodicSubjects(
  s: PeriodicObligationsState,
  c: PeriodicCommand,
  r?: PeriodicSourceRead,
): readonly ResourcePrincipal[] {
  if (c.type === 'offer') {
    if (!r?.payer) throw Error('periodic-actual-account-source-required');
    return [r.payer.principal];
  }
  const old = s.contracts[c.id];
  if (!old) throw Error('periodic-obligation-not-found');
  return c.type === 'terminate'
    ? [old.payerPrincipal, old.revenuePrincipal]
    : [
        c.type === 'accept' || c.type === 'decline' || c.type === 'waive'
          ? old.revenuePrincipal
          : old.payerPrincipal,
      ];
}
export function periodicTransactions(s: PeriodicObligationsState | undefined, e: PeriodicEvent) {
  if (e.type !== 'PeriodicInstallmentRecorded' && e.type !== 'PeriodicObligationChanged') return [];
  const i = e.installment,
    c = s?.contracts[e.id];
  if (!i || i.status !== 'paid' || !c) return [];
  const prefix = `periodic-${c.id}-${e.previousRevision + 1}-${i.period}`;
  return [
    createMoneyTransfer({
      transactionId: `${prefix}-pay`,
      reason: 'periodic-obligation-paid',
      from: economicAccount(c.payer.sector, c.payer.id),
      to: PERIODIC_OBLIGATIONS_CLEARING,
      amount: i.amountMicros / POLICY.moneyScale,
    }),
    createMoneyTransfer({
      transactionId: `${prefix}-receive`,
      reason: 'periodic-obligation-paid',
      from: PERIODIC_OBLIGATIONS_CLEARING,
      to: economicAccount(c.revenue.sector, c.revenue.id),
      amount: i.amountMicros / POLICY.moneyScale,
    }),
  ];
}
/** Future accepted commitments and actual unpaid periods remain separate from balances and original loan/lease debt. */
export function periodicAccountObligations(
  s: PeriodicObligationsState | undefined,
  account: PeriodicTerms['payer'],
) {
  return Object.values(s?.contracts ?? {})
    .filter(
      (c) =>
        (tradeFactsEqual(c.payer, account) || tradeFactsEqual(c.revenue, account)) &&
        (c.status === 'active' || Object.values(c.installments).some((i) => i.status === 'unpaid')),
    )
    .map((c) => c.id)
    .sort();
}
export function periodicUnpaidMicros(c: PeriodicObligation) {
  return Object.values(c.installments)
    .filter((i) => i.status === 'unpaid')
    .reduce((n, i) => n + i.amountMicros, 0);
}
