import { assertPeriodicInstallment, assertPeriodicObligation } from './periodicObligationRecords';
import {
  assertPrincipalAuthorization,
  samePrincipal,
  type ResourcePrincipal,
} from '@aivilization/authority';
import {
  PERIODIC_OBLIGATIONS_POLICY as POLICY,
  type PeriodicObligationsState,
  type PeriodicEvent,
  type PeriodicObligation,
  type PeriodicInstallment,
} from './periodicObligationModel';
import { decodePeriodicCommand, assertPeriodicTerms } from './periodicObligationCommand';
import { tradeFactsEqual, tradeMoneyMicros } from './tradeFacts';
import {
  periodicRequest,
  nextPeriodicDueAt,
  periodicPaymentFailure,
  assertPeriodicSourceRead,
} from './periodicObligationFacts';
const fail = (reason = 'invalid-periodic-event'): never => {
  throw Error(reason);
};
const time = (t: number) => Number.isSafeInteger(t) && t >= 0;
export function assertPeriodicPolicy(p: typeof POLICY) {
  if (!tradeFactsEqual(p, POLICY)) fail('unsupported-periodic-policy');
}
function terms(c: PeriodicObligation) {
  return {
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
  };
}
/** Applies recorded contract and installment facts; never consults money, real time or an external current authority. */
export function applyPeriodicEvent(
  s: PeriodicObligationsState | undefined,
  input: PeriodicEvent,
): PeriodicObligationsState {
  const e = structuredClone(input);
  if (e.type === 'PeriodicObligationsEnabled') {
    assertPeriodicPolicy(e.policy);
    if (s) fail('periodic-obligations-already-enabled');
    return { policy: structuredClone(e.policy), contracts: {} };
  }
  if (!s) return fail('periodic-obligations-not-enabled');
  assertPeriodicPolicy(s.policy);
  if (e.type === 'PeriodicObligationOffered') {
    const c = e.obligation,
      command = decodePeriodicCommand({ type: 'offer', ...terms(c) });
    if (command.type !== 'offer') return fail();
    assertPeriodicTerms(command, c.createdAt);
    assertPeriodicSourceRead(command, e.sourceRead);
    const read = e.sourceRead;
    if (
      s.contracts[c.id] ||
      Object.keys(s.contracts).length >= POLICY.maxContracts ||
      !read.payer ||
      !read.revenue ||
      read.payer.status !== 'open' ||
      read.revenue.status !== 'open' ||
      samePrincipal(read.payer.principal, read.revenue.principal) ||
      Object.values(s.contracts).filter((x) =>
        samePrincipal(x.payerPrincipal, read.payer!.principal),
      ).length >= POLICY.maxPerPayer
    )
      return fail('invalid-periodic-offer-source-or-limit');
    const authorization = c.offeredAuthorization;
    assertPrincipalAuthorization(
      authorization,
      read.payer.principal,
      periodicRequest(s, command, read),
      e.actorId,
    );
    const expected: PeriodicObligation = {
      ...terms(c),
      payerPrincipal: structuredClone(read.payer.principal),
      revenuePrincipal: structuredClone(read.revenue.principal),
      offeredAuthorization: structuredClone(authorization),
      createdAt: c.createdAt,
      at: c.createdAt,
      revision: 1,
      status: 'offered',
      cursor: 0,
      installments: {},
    };
    if (!time(c.createdAt) || !tradeFactsEqual(c, expected))
      return fail('periodic-offer-facts-mismatch');
    assertPeriodicObligation(expected);
    return { ...s, contracts: { ...s.contracts, [c.id]: expected } };
  }
  const c = s.contracts[e.id];
  if (
    !c ||
    c.revision !== e.previousRevision ||
    !Number.isSafeInteger(c.revision + 1) ||
    !time(e.at) ||
    e.at < c.at
  )
    return fail('periodic-revision-or-time-conflict');
  assertPeriodicObligation(c);
  let next: PeriodicObligation;
  if (e.type === 'PeriodicObligationExpired') {
    if (c.status !== 'offered' || e.at < c.acceptBy) return fail('invalid-periodic-expiry');
    next = { ...c, status: 'expired' };
  } else if (e.type === 'PeriodicInstallmentRecorded') {
    const i = e.installment,
      due = nextPeriodicDueAt(c);
    if (
      due === undefined ||
      e.at < due ||
      i.period !== c.cursor + 1 ||
      c.installments[String(i.period)] ||
      i.recordedAt !== e.at
    )
      return fail('periodic-due-cursor-conflict');
    assertPeriodicInstallment(c, i, e.at);
    const reason = periodicPaymentFailure(c, e.sourceRead),
      expected: PeriodicInstallment = {
        period: c.cursor + 1,
        dueAt: due,
        amountMicros: tradeMoneyMicros(c.amount),
        recordedAt: e.at,
        status: reason ? 'unpaid' : 'paid',
        ...(reason ? { unpaidReason: reason } : { paidAt: e.at }),
      };
    if (!tradeFactsEqual(i, expected)) return fail('periodic-due-payment-source-mismatch');
    next = {
      ...c,
      cursor: c.cursor + 1,
      status: c.cursor + 1 === c.periods ? 'ended' : 'active',
      ...(c.cursor + 1 === c.periods ? { futureStoppedAt: e.at } : {}),
      installments: { ...c.installments, [String(i.period)]: i },
    };
  } else {
    const command = decodePeriodicCommand(e.command);
    if (command.type === 'offer' || command.id !== c.id || command.expectedRevision !== c.revision)
      return fail('periodic-command-version-mismatch');
    const request = periodicRequest(s, command),
      a = e.authorization;
    const subject: ResourcePrincipal =
      command.type === 'accept' || command.type === 'decline' || command.type === 'waive'
        ? c.revenuePrincipal
        : command.type === 'terminate'
          ? a.principal
          : c.payerPrincipal;
    if (
      command.type === 'terminate' &&
      !samePrincipal(subject, c.payerPrincipal) &&
      !samePrincipal(subject, c.revenuePrincipal)
    )
      return fail('periodic-original-party-required');
    assertPrincipalAuthorization(a, subject, request, e.actorId);
    if (command.type === 'accept' || command.type === 'withdraw' || command.type === 'decline') {
      if (c.status !== 'offered' || e.at >= c.acceptBy || e.installment)
        return fail('periodic-obligation-not-offered');
      if (command.type === 'accept') {
        const r = e.sourceRead;
        if (!r?.payer || !r.revenue) return fail('periodic-current-account-source-required');
        assertPeriodicSourceRead(c, r);
        if (
          r.payer.status !== 'open' ||
          r.revenue.status !== 'open' ||
          !samePrincipal(r.payer.principal, c.payerPrincipal) ||
          !samePrincipal(r.revenue.principal, c.revenuePrincipal) ||
          e.at >= c.firstDueAt
        )
          return fail('periodic-accept-account-or-time-conflict');
      } else if (e.sourceRead) return fail('periodic-unrelated-account-source');
      const status =
        command.type === 'accept'
          ? 'active'
          : command.type === 'withdraw'
            ? 'withdrawn'
            : 'declined';
      if (e.status !== status) return fail('periodic-command-status-mismatch');
      next = {
        ...c,
        status,
        ...(command.type === 'accept' ? { acceptedAuthorization: a, acceptedAt: e.at } : {}),
      };
    } else if (command.type === 'terminate') {
      if (
        c.status !== 'active' ||
        nextPeriodicDueAt(c)! <= e.at ||
        e.status !== 'terminated' ||
        e.sourceRead ||
        e.installment
      )
        return fail('periodic-due-must-settle-before-termination');
      next = { ...c, status: 'terminated', futureStoppedAt: e.at };
    } else {
      const old = c.installments[String(command.period)],
        i = e.installment;
      if (
        !old ||
        old.status !== 'unpaid' ||
        !i ||
        e.status !== c.status ||
        !c.acceptedAuthorization
      )
        return fail('periodic-unpaid-installment-required');
      assertPeriodicInstallment(c, i, e.at);
      if (command.type === 'settle') {
        if (!e.sourceRead || periodicPaymentFailure(c, e.sourceRead))
          return fail('periodic-actual-payment-required');
      } else if (e.sourceRead) return fail('periodic-waiver-cannot-transfer-money');
      const expected: PeriodicInstallment =
        command.type === 'settle'
          ? { ...old, status: 'paid', paidAt: e.at }
          : { ...old, status: 'waived', waivedAt: e.at };
      if (!tradeFactsEqual(i, expected)) return fail('periodic-unrelated-installment-change');
      next = { ...c, installments: { ...c.installments, [String(i.period)]: i } };
    }
  }
  const recorded = { ...next, at: e.at, revision: c.revision + 1 };
  assertPeriodicObligation(recorded);
  return { ...s, contracts: { ...s.contracts, [c.id]: recorded } };
}
