import {
  ENTERPRISE_PERIODIC_ACCOUNTING_POLICY as POLICY,
  decideRecordEnterprisePeriodicAccounting,
  applyEnterpriseDomainEvent,
  type EnterprisePeriodicAccountingEvent,
  type EnterprisePeriodicPosition,
} from '@aivilization/enterprise';
import {
  tradeMoneyMicros,
  tradeFactsEqual,
  type PeriodicEvent,
  type PeriodicObligationsState,
} from '@aivilization/commerce';
import type { WorldProjection } from './projection';
export type PeriodicEnterpriseEffect = {
  readonly enterpriseId: string;
  readonly event: EnterprisePeriodicAccountingEvent;
};
/** No enterprise finance is derived from a resident label; every record follows a validated commerce transition. */
export function preparePeriodicEnterpriseEffects(
  w: WorldProjection,
  after: PeriodicObligationsState,
  event: PeriodicEvent,
): readonly PeriodicEnterpriseEffect[] {
  if (event.type !== 'PeriodicObligationChanged' && event.type !== 'PeriodicInstallmentRecorded')
    return [];
  const c = after.contracts[event.id];
  if (!c?.acceptedAuthorization || c.acceptedAt === undefined) return [];
  const effects: PeriodicEnterpriseEffect[] = [];
  let enterprises = w.enterprises;
  for (const side of ['payer', 'revenue'] as const) {
    const account = c[side];
    if (account.sector !== 'enterprise') continue;
    const e = enterprises[account.id];
    if (!e) throw Error('periodic-enterprise-owning-account-required');
    let source: EnterprisePeriodicAccountingEvent;
    if (event.type === 'PeriodicObligationChanged' && event.command.type === 'accept') {
      source = {
        type: 'EnterprisePeriodicPositionRegistered',
        policyVersion: POLICY.version,
        position: {
          id: c.id,
          side,
          amountMicros: tradeMoneyMicros(c.amount),
          periods: c.periods,
          firstDueAt: c.firstDueAt,
          periodMs: c.periodMs,
          acceptedAt: c.acceptedAt,
          at: c.acceptedAt,
          sourceRevision: c.revision,
          cursor: 0,
          installments: {},
          authorization: side === 'payer' ? c.offeredAuthorization : c.acceptedAuthorization,
        },
      };
    } else {
      const change =
        event.type === 'PeriodicInstallmentRecorded'
          ? {
              type: 'due' as const,
              period: event.installment.period,
              status: event.installment.status,
            }
          : event.command.type === 'terminate'
            ? { type: 'stop' as const }
            : event.command.type === 'settle' || event.command.type === 'waive'
              ? { type: event.command.type, period: event.command.period }
              : undefined;
      if (!change) throw Error('periodic-enterprise-unrelated-change');
      if (change.type === 'due' && change.status === 'waived')
        throw Error('periodic-enterprise-invalid-due');
      source = {
        type: 'EnterprisePeriodicPositionChanged',
        policyVersion: POLICY.version,
        id: c.id,
        previousSourceRevision: event.previousRevision,
        at: event.at,
        change:
          change.type === 'due'
            ? {
                type: 'due',
                period: change.period,
                status: change.status === 'paid' ? 'paid' : 'unpaid',
              }
            : change,
      };
    }
    const d = decideRecordEnterprisePeriodicAccounting(e, source);
    if (!d.accepted) throw Error(d.reason);
    effects.push({ enterpriseId: account.id, event: d.event });
    enterprises = { ...enterprises, [account.id]: applyEnterpriseDomainEvent(e, d.event) };
  }
  return effects;
}
/** A snapshot may not detach an enterprise financial position from its unique accepted agreement. No balances are recalculated. */
export function assertPeriodicEnterpriseProjection(w: WorldProjection) {
  const expectedByEnterprise: Record<string, Record<string, EnterprisePeriodicPosition>> = {};
  for (const c of Object.values(w.periodicObligations?.contracts ?? {})) {
    if (!c.acceptedAuthorization || c.acceptedAt === undefined) continue;
    for (const side of ['payer', 'revenue'] as const) {
      const account = c[side];
      if (account.sector !== 'enterprise') continue;
      if (!w.enterprises[account.id]) throw Error('periodic-enterprise-snapshot-source-mismatch');
      const expected = (expectedByEnterprise[account.id] ??= {});
      expected[c.id] = {
        id: c.id,
        side,
        amountMicros: tradeMoneyMicros(c.amount),
        periods: c.periods,
        firstDueAt: c.firstDueAt,
        periodMs: c.periodMs,
        acceptedAt: c.acceptedAt,
        at: c.at,
        sourceRevision: c.revision,
        cursor: c.cursor,
        authorization: side === 'payer' ? c.offeredAuthorization : c.acceptedAuthorization,
        ...(c.futureStoppedAt === undefined ? {} : { futureStoppedAt: c.futureStoppedAt }),
        installments: Object.fromEntries(
          Object.values(c.installments).map((i) => [
            String(i.period),
            {
              status: i.status,
              at:
                i.status === 'paid'
                  ? i.paidAt!
                  : i.status === 'waived'
                    ? i.waivedAt!
                    : i.recordedAt,
            },
          ]),
        ),
      };
    }
  }
  for (const e of Object.values(w.enterprises)) {
    if (
      !tradeFactsEqual(
        expectedByEnterprise[e.enterpriseId] ?? {},
        e.periodicAccounting?.positions ?? {},
      )
    )
      throw Error('periodic-enterprise-snapshot-source-mismatch');
  }
}
