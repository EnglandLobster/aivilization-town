import {
  assertPrincipalAuthorization,
  validResourcePrincipal,
  samePrincipal,
} from '@aivilization/authority';
import {
  PERIODIC_OBLIGATIONS_POLICY as POLICY,
  type PeriodicObligation,
  type PeriodicObligationsState,
  type PeriodicInstallment,
  type PeriodicFailure,
} from './periodicObligationModel';
import { decodePeriodicCommand, assertPeriodicTerms } from './periodicObligationCommand';
import { tradeFactsEqual, tradeMoneyMicros } from './tradeFacts';
import {
  periodicDueAt,
  periodicRequest,
  assertPeriodicSourceRead,
} from './periodicObligationFacts';
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const failures: readonly PeriodicFailure[] = [
  'periodic-payer-unavailable',
  'periodic-revenue-unavailable',
  'periodic-account-principal-changed',
  'periodic-insufficient-funds',
  'periodic-revenue-capacity',
  'periodic-money-range',
];
export function assertPeriodicInstallment(
  c: PeriodicObligation,
  i: PeriodicInstallment,
  at: number,
) {
  if (
    !Number.isSafeInteger(i.period) ||
    i.period < 1 ||
    i.period > c.periods ||
    i.dueAt !== periodicDueAt(c, i.period) ||
    i.amountMicros !== tradeMoneyMicros(c.amount) ||
    !time(i.recordedAt) ||
    i.recordedAt < i.dueAt ||
    i.recordedAt > at ||
    (i.status === 'paid'
      ? !time(i.paidAt!) || i.paidAt! < i.recordedAt || i.paidAt! > at || i.waivedAt !== undefined
      : i.paidAt !== undefined) ||
    (i.status === 'waived'
      ? !time(i.waivedAt!) || i.waivedAt! < i.recordedAt || i.waivedAt! > at
      : i.waivedAt !== undefined) ||
    !['paid', 'unpaid', 'waived'].includes(i.status) ||
    (i.status === 'unpaid' && !i.unpaidReason) ||
    (i.status === 'waived' && !i.unpaidReason) ||
    (i.unpaidReason !== undefined && !failures.includes(i.unpaidReason))
  )
    throw Error('invalid-periodic-installment');
}
/** Snapshot validation retains historical approvals; current managers cannot rewrite their original parties or terms. */
export function assertPeriodicObligation(c: PeriodicObligation) {
  const command = decodePeriodicCommand({
    type: 'offer',
    id: c.id,
    title: c.title,
    terms: c.terms,
    payer: c.payer,
    revenue: c.revenue,
    amount: c.amount,
    firstDueAt: c.firstDueAt,
    periodMs: c.periodMs,
    periods: c.periods,
    acceptBy: c.acceptBy,
  });
  if (command.type !== 'offer') throw Error('invalid-periodic-record');
  assertPeriodicTerms(command, c.createdAt);
  if (
    !validResourcePrincipal(c.payerPrincipal) ||
    !validResourcePrincipal(c.revenuePrincipal) ||
    samePrincipal(c.payerPrincipal, c.revenuePrincipal) ||
    !time(c.createdAt) ||
    !time(c.at) ||
    c.at < c.createdAt ||
    !Number.isSafeInteger(c.revision) ||
    c.revision < 1 ||
    !Number.isSafeInteger(c.cursor) ||
    c.cursor < 0 ||
    c.cursor > c.periods ||
    Object.keys(c.installments).length !== c.cursor ||
    !['offered', 'active', 'ended', 'terminated', 'withdrawn', 'declined', 'expired'].includes(
      c.status,
    )
  )
    throw Error('invalid-periodic-record');
  for (let period = 1; period <= c.cursor; period++) {
    const i = c.installments[String(period)];
    if (!i || i.period !== period) throw Error('periodic-installment-history-gap');
    assertPeriodicInstallment(c, i, c.at);
    if (
      i.recordedAt < (c.acceptedAt ?? c.createdAt) ||
      (period > 1 && i.recordedAt < c.installments[String(period - 1)]!.recordedAt)
    )
      throw Error('periodic-installment-time-order');
  }
  const accepted = ['active', 'ended', 'terminated'].includes(c.status);
  if (
    accepted
      ? !time(c.acceptedAt!) ||
        c.acceptedAt! < c.createdAt ||
        c.acceptedAt! >= c.acceptBy ||
        c.acceptedAt! > c.at
      : c.acceptedAt !== undefined
  )
    throw Error('periodic-acceptance-time-mismatch');
  const stopped = c.status === 'ended' || c.status === 'terminated';
  if (
    stopped
      ? !time(c.futureStoppedAt!) ||
        c.futureStoppedAt! < c.acceptedAt! ||
        c.futureStoppedAt! > c.at ||
        (c.cursor > 0 && c.futureStoppedAt! < c.installments[String(c.cursor)]!.recordedAt) ||
        (c.status === 'terminated' && c.futureStoppedAt! >= periodicDueAt(c, c.cursor + 1)) ||
        (c.status === 'ended' &&
          c.futureStoppedAt !== c.installments[String(c.periods)]?.recordedAt)
      : c.futureStoppedAt !== undefined
  )
    throw Error('periodic-future-stop-time-mismatch');
  if (
    accepted !== !!c.acceptedAuthorization ||
    (!accepted && c.cursor !== 0) ||
    (c.status === 'active' && c.cursor >= c.periods) ||
    (c.status === 'ended' && c.cursor !== c.periods) ||
    (c.status === 'terminated' && c.cursor >= c.periods)
  )
    throw Error('periodic-status-history-mismatch');
  const empty: PeriodicObligationsState = { policy: POLICY, contracts: {} };
  const source = {
    payer: {
      account: c.payer,
      principal: c.payerPrincipal,
      status: 'open' as const,
      balance: 0,
      maximumBalance: 0,
    },
    revenue: {
      account: c.revenue,
      principal: c.revenuePrincipal,
      status: 'open' as const,
      balance: 0,
      maximumBalance: 0,
    },
  };
  assertPeriodicSourceRead(c, source);
  assertPrincipalAuthorization(
    c.offeredAuthorization,
    c.payerPrincipal,
    periodicRequest(empty, command, source),
    c.offeredAuthorization.actorId,
  );
  if (c.acceptedAuthorization)
    assertPrincipalAuthorization(
      c.acceptedAuthorization,
      c.revenuePrincipal,
      periodicRequest(
        { ...empty, contracts: { [c.id]: c } },
        { type: 'accept', id: c.id, expectedRevision: 1 },
      ),
      c.acceptedAuthorization.actorId,
    );
}
export function assertPeriodicObligationsState(s: PeriodicObligationsState) {
  if (!tradeFactsEqual(s.policy, POLICY) || Object.keys(s.contracts).length > POLICY.maxContracts)
    throw Error('invalid-periodic-obligations-state');
  const counts = new Map<string, number>();
  for (const [id, c] of Object.entries(s.contracts)) {
    if (id !== c.id) throw Error('periodic-contract-id-mismatch');
    assertPeriodicObligation(c);
    const key = `${c.payerPrincipal.kind}:${c.payerPrincipal.id}`;
    const count = (counts.get(key) ?? 0) + 1;
    if (count > POLICY.maxPerPayer) throw Error('periodic-payer-contract-limit');
    counts.set(key, count);
  }
}
