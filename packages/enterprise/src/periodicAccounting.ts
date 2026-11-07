import {
  assertPrincipalAuthorization,
  principalId,
  type PrincipalValue,
} from '@aivilization/authority';
import type { EnterpriseState } from './model';
import {
  ENTERPRISE_PERIODIC_ACCOUNTING_POLICY as POLICY,
  type EnterprisePeriodicAccounting,
  type EnterprisePeriodicAccountingEvent,
  type EnterprisePeriodicPosition,
} from './periodicAccountingModel';
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const object = (
  v: PrincipalValue | undefined,
): Readonly<Record<string, PrincipalValue>> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Readonly<Record<string, PrincipalValue>>)
    : undefined;
const dueAt = (p: EnterprisePeriodicPosition, period: number) =>
  p.firstDueAt + (period - 1) * p.periodMs;
function assertPosition(p: EnterprisePeriodicPosition, enterpriseId: string) {
  const a = p.authorization,
    q = a.request,
    args = q.operation.arguments,
    terms = object(args.terms),
    account = object(terms?.[p.side]),
    party = object(args[p.side === 'payer' ? 'payerPrincipal' : 'revenuePrincipal']),
    command = object(args.command);
  assertPrincipalAuthorization(a, { kind: 'enterprise', id: enterpriseId }, q, a.actorId);
  if (
    !principalId(p.id) ||
    !['payer', 'revenue'].includes(p.side) ||
    !integer(p.amountMicros) ||
    p.amountMicros < 1 ||
    !integer(p.periods) ||
    p.periods < 1 ||
    p.periods > POLICY.maxPeriods ||
    p.amountMicros * p.periods > POLICY.maxTotalMicros ||
    !integer(p.firstDueAt) ||
    !integer(p.periodMs) ||
    p.periodMs < POLICY.minPeriodMs ||
    !integer(dueAt(p, p.periods)) ||
    !integer(p.acceptedAt) ||
    p.acceptedAt >= p.firstDueAt ||
    !integer(p.at) ||
    p.at < p.acceptedAt ||
    !integer(p.sourceRevision) ||
    p.sourceRevision < 2 ||
    !integer(p.cursor) ||
    p.cursor > p.periods ||
    Object.keys(p.installments).length !== p.cursor ||
    q.resourceKind !== 'periodic-obligation' ||
    q.resourceId !== p.id ||
    q.resourceRevision !== 1 ||
    q.controlVersion !== 1 ||
    q.operation.capability !== `obligations.${p.side === 'payer' ? 'offer' : 'accept'}` ||
    command?.type !== (p.side === 'payer' ? 'offer' : 'accept') ||
    command.id !== p.id ||
    args.policyVersion !== POLICY.sourcePolicyVersion ||
    args.maximumTotalMicros !== p.amountMicros * p.periods ||
    terms?.id !== p.id ||
    terms.amount !== p.amountMicros / POLICY.moneyScale ||
    terms.periods !== p.periods ||
    terms.firstDueAt !== p.firstDueAt ||
    terms.periodMs !== p.periodMs ||
    typeof terms.acceptBy !== 'number' ||
    p.acceptedAt >= terms.acceptBy ||
    party?.kind !== 'enterprise' ||
    party.id !== enterpriseId ||
    account?.sector !== 'enterprise' ||
    account.id !== enterpriseId
  )
    throw Error('enterprise-periodic-exact-source-required');
  if (
    p.side === 'payer'
      ? Object.keys(command).length !== Object.keys(terms).length + 1 ||
        Object.entries(terms).some(
          ([key, value]) => JSON.stringify(command[key]) !== JSON.stringify(value),
        )
      : Object.keys(command).length !== 3 || command.expectedRevision !== 1
  )
    throw Error('enterprise-periodic-command-terms-mismatch');
  for (let period = 1; period <= p.cursor; period++) {
    const i = p.installments[String(period)];
    if (
      !i ||
      !['paid', 'unpaid', 'waived'].includes(i.status) ||
      !integer(i.at) ||
      i.at < dueAt(p, period) ||
      i.at > p.at
    )
      throw Error('invalid-enterprise-periodic-installment');
  }
  if (
    p.futureStoppedAt !== undefined &&
    (!integer(p.futureStoppedAt) ||
      p.futureStoppedAt < p.acceptedAt ||
      p.futureStoppedAt > p.at ||
      (p.cursor < p.periods && p.futureStoppedAt >= dueAt(p, p.cursor + 1)))
  )
    throw Error('invalid-enterprise-periodic-stop');
  if (p.cursor === p.periods && p.futureStoppedAt === undefined)
    throw Error('enterprise-periodic-completion-required');
}
export function assertEnterprisePeriodicAccounting(s: EnterprisePeriodicAccounting, id: string) {
  if (s.policyVersion !== POLICY.version || Object.keys(s.positions).length > POLICY.maxPositions)
    throw Error('invalid-enterprise-periodic-accounting');
  for (const [key, p] of Object.entries(s.positions)) {
    if (key !== p.id) throw Error('enterprise-periodic-id-mismatch');
    assertPosition(p, id);
  }
}
export function enterprisePeriodicArrears(e: Pick<EnterpriseState, 'periodicAccounting'>) {
  return Object.values(e.periodicAccounting?.positions ?? {}).reduce(
    (total, p) =>
      total +
      (p.side === 'payer'
        ? (Object.values(p.installments).filter((i) => i.status === 'unpaid').length *
            p.amountMicros) /
          POLICY.moneyScale
        : 0),
    0,
  );
}
export function hasOpenEnterprisePeriodicPositions(e: Pick<EnterpriseState, 'periodicAccounting'>) {
  return Object.values(e.periodicAccounting?.positions ?? {}).some(
    (p) =>
      p.futureStoppedAt === undefined ||
      Object.values(p.installments).some((i) => i.status === 'unpaid'),
  );
}
/** Financial state transitions belong here. The world proves each incremental source against commerce and actual accounts. */
export function applyEnterprisePeriodicAccounting(
  e: EnterpriseState,
  input: EnterprisePeriodicAccountingEvent,
): EnterpriseState {
  const event = structuredClone(input);
  if (event.policyVersion !== POLICY.version || e.status === 'closed')
    throw Error('enterprise-periodic-accounting-unavailable');
  if (e.periodicAccounting)
    assertEnterprisePeriodicAccounting(e.periodicAccounting, e.enterpriseId);
  const positions = { ...e.periodicAccounting?.positions };
  let cash = 0,
    side: EnterprisePeriodicPosition['side'];
  if (event.type === 'EnterprisePeriodicPositionRegistered') {
    const p = event.position;
    if (
      e.status !== 'active' ||
      positions[p.id] ||
      Object.keys(positions).length >= POLICY.maxPositions ||
      p.acceptedAt < e.foundedAt ||
      p.at !== p.acceptedAt ||
      p.cursor !== 0 ||
      p.sourceRevision !== 2 ||
      p.futureStoppedAt !== undefined ||
      Object.keys(p.installments).length
    )
      throw Error('invalid-enterprise-periodic-registration');
    assertPosition(p, e.enterpriseId);
    positions[p.id] = p;
    side = p.side;
  } else {
    const p = positions[event.id],
      change = event.change;
    if (
      !p ||
      event.previousSourceRevision !== p.sourceRevision ||
      !integer(event.at) ||
      event.at < p.at ||
      !integer(p.sourceRevision + 1)
    )
      throw Error('enterprise-periodic-source-revision-conflict');
    side = p.side;
    let next: EnterprisePeriodicPosition = {
      ...p,
      sourceRevision: p.sourceRevision + 1,
      at: event.at,
    };
    if (change.type === 'stop') {
      if (
        p.futureStoppedAt !== undefined ||
        p.cursor >= p.periods ||
        event.at >= dueAt(p, p.cursor + 1)
      )
        throw Error('enterprise-periodic-due-before-stop');
      next = { ...next, futureStoppedAt: event.at };
    } else if (change.type === 'due') {
      if (
        p.futureStoppedAt !== undefined ||
        change.period !== p.cursor + 1 ||
        change.period > p.periods ||
        !['paid', 'unpaid'].includes(change.status) ||
        event.at < dueAt(p, change.period)
      )
        throw Error('enterprise-periodic-due-cursor-conflict');
      next = {
        ...next,
        cursor: change.period,
        installments: {
          ...p.installments,
          [String(change.period)]: { status: change.status, at: event.at },
        },
        ...(change.period === p.periods ? { futureStoppedAt: event.at } : {}),
      };
      if (change.status === 'paid') cash = p.amountMicros / POLICY.moneyScale;
    } else {
      if (
        p.installments[String(change.period)]?.status !== 'unpaid' ||
        !['settle', 'waive'].includes(change.type)
      )
        throw Error('enterprise-periodic-unpaid-position-required');
      next = {
        ...next,
        installments: {
          ...p.installments,
          [String(change.period)]: {
            status: change.type === 'settle' ? 'paid' : 'waived',
            at: event.at,
          },
        },
      };
      if (change.type === 'settle') cash = p.amountMicros / POLICY.moneyScale;
    }
    positions[p.id] = next;
  }
  const delta = side === 'payer' ? -cash : cash,
    balance = e.balance + delta,
    retainedEarnings =
      (e.retainedEarnings ??
        e.cumulativeSales -
          e.cumulativePurchases -
          e.cumulativeWages -
          (e.cumulativeDividends ?? 0)) + delta;
  if (
    !Number.isFinite(balance) ||
    balance < 0 ||
    !Number.isFinite(retainedEarnings) ||
    !Number.isFinite(e.cumulativeSales + cash) ||
    !Number.isFinite(e.cumulativePurchases + cash)
  )
    throw Error('enterprise-periodic-insufficient-cash-or-range');
  const periodicAccounting: EnterprisePeriodicAccounting = {
    policyVersion: POLICY.version,
    positions,
  };
  assertEnterprisePeriodicAccounting(periodicAccounting, e.enterpriseId);
  return {
    ...e,
    periodicAccounting,
    balance,
    retainedEarnings,
    cumulativeSales: e.cumulativeSales + (side === 'revenue' ? cash : 0),
    cumulativePurchases: e.cumulativePurchases + (side === 'payer' ? cash : 0),
  };
}
export function decideRecordEnterprisePeriodicAccounting(
  e: EnterpriseState,
  event: EnterprisePeriodicAccountingEvent,
) {
  try {
    applyEnterprisePeriodicAccounting(e, event);
    return { accepted: true as const, event: structuredClone(event) };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-enterprise-periodic-event',
    };
  }
}
