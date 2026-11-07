import { createHash } from 'node:crypto';
import type { EnterpriseCapitalEvent } from '@aivilization/enterprise';
import { CAPITAL_AGREEMENTS_POLICY } from '@aivilization/enterprise';
import type { EstateCashSourceReference, AccountingTransaction } from '@aivilization/economy';
import type { WorldProjection } from './projection';
import { prepareResidentEstateCashEffects } from './residentEstateCashEffects';
export const CAPITAL_ESTATE_CONTINUITY_POLICY = {
  version: 'capital-estate-cash-ledger-v1',
  sourceKey: 'sha256-structured-owning-capital-reference-v1',
  settlementTime: 'actual-owning-fact-boundary-v1',
} as const;
/** A stable owning capital fact, never a guessed global projection revision or beneficiary identity. */
export function capitalEstateCashSource(
  enterpriseId: string,
  events: readonly EnterpriseCapitalEvent[],
): EstateCashSourceReference {
  if (events.length !== 1) throw Error('capital-estate-single-owning-source-required');
  const event = events[0]!;
  const source =
    event.type === 'EnterpriseCapitalAgreementCommitted'
      ? {
          id: `capital-agreement:${enterpriseId}:${event.event.agreement.id}`,
          revision: event.event.agreement.revision,
        }
      : event.type === 'EnterpriseCapitalDividendPaid'
        ? { id: `capital-dividend:${enterpriseId}`, revision: event.paidAt + 1 }
        : event.type === 'EnterpriseCapitalClosed'
          ? { id: `capital-close:${enterpriseId}`, revision: event.at + 1 }
          : { id: `capital-origin:${enterpriseId}`, revision: event.at + 1 };
  const id = `capital-source-${createHash('sha256')
    .update(JSON.stringify([CAPITAL_ESTATE_CONTINUITY_POLICY.version, enterpriseId, source.id]))
    .digest('hex')}`;
  return { context: 'capital', ...source, id, policyVersion: CAPITAL_AGREEMENTS_POLICY.version };
}
export function prepareCapitalEstateCash(
  w: WorldProjection,
  enterpriseId: string,
  events: readonly EnterpriseCapitalEvent[],
  transactions: readonly AccountingTransaction[],
  at: number,
) {
  if (!w.residentExits) return undefined;
  // Purely living payments do not acquire a new receipt/channel or new durable interpretation.
  if (
    !transactions.some((t) =>
      t.entries.some(
        (e) =>
          e.account.sector === 'agent' &&
          !!w.residentExits!.records[e.account.accountId.slice('agent:'.length)],
      ),
    )
  )
    return undefined;
  const effects = prepareResidentEstateCashEffects(
    w,
    capitalEstateCashSource(enterpriseId, events),
    transactions,
    at,
  );
  if (!effects.resolution.mappings.length) throw Error('capital-estate-actual-source-required');
  // New commitments cannot debit departed subjects through another living participant.
  if (
    effects.resolution.transactions.some((t) =>
      t.entries.some((e) => e.account.sector === 'estate' && e.amount < 0),
    )
  )
    throw Error('capital-estate-new-outgoing-commitment-forbidden');
  return effects;
}
