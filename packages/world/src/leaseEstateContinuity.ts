import {
  createMoneyTransfer,
  economicAccount,
  assertMoneySupplyDelta,
  type AccountingTransaction,
} from '@aivilization/economy';
import {
  applyCommerceEvent,
  commerceEscrowBalance,
  tradeFactsEqual as equal,
  type CommerceEvent,
} from '@aivilization/commerce';
import {
  validateLeaseContinuityTransition,
  type LeaseContinuitySource,
  type ResidentLease,
} from '@aivilization/society';
import type { WorldProjection } from './projection';
import { residentPhysicalFinancialAccount } from './residentExitPreservation';
import {
  prepareResidentEstateCashEffects,
  applyResidentEstateCashEffects,
  type ResidentEstateCashEffects,
} from './residentEstateCashEffects';
export const LEASE_CONTINUITY_VERSION = 'resident-lease-continuity-v1' as const;
export type LeaseContinuity = {
  readonly version: typeof LEASE_CONTINUITY_VERSION;
  readonly source: LeaseContinuitySource;
  readonly paidRent: number;
  readonly transactions: readonly AccountingTransaction[];
  readonly commerceEvents: readonly CommerceEvent[];
  readonly cash: ResidentEstateCashEffects;
};
export const leaseHasDepartedParty = (w: WorldProjection, l: ResidentLease) =>
  !!w.residentExits && [l.hostId, l.tenantId].some((id) => !!w.residentExits!.records[id]);
const cashSource = (l: ResidentLease) => ({
  context: 'leases' as const,
  id: l.id,
  revision: l.revision,
  policyVersion: LEASE_CONTINUITY_VERSION,
});
/** Exact ledger derived from original owning facts and recorded effects, not from an actor's assertion. */
function facts(
  w: WorldProjection,
  after: ResidentLease,
  source: LeaseContinuitySource,
  paidRent: number,
) {
  const before = w.residentLeases?.leases[after.id];
  if (
    !before ||
    !w.residentCommerce ||
    !leaseHasDepartedParty(w, before) ||
    source.at > w.clock.now
  )
    throw Error('lease-continuity-source-unavailable');
  if (source.kind === 'resident' && (!w.agents[source.actorId] || source.at !== w.clock.now))
    throw Error('lease-continuity-living-actor-required');
  const { returnDeposit } = validateLeaseContinuityTransition(before, after, source, paidRent);
  const payer = residentPhysicalFinancialAccount(w, before.tenantId),
    host = residentPhysicalFinancialAccount(w, before.hostId);
  if (!payer || !host) throw Error('lease-continuity-financial-subject-unavailable');
  if (paidRent > payer.balance) throw Error('lease-continuity-insufficient-balance');
  if (
    source.kind === 'boundary' &&
    source.at < before.expiresAt &&
    paidRent !== (payer.balance >= before.rent ? before.rent : 0)
  )
    throw Error('lease-continuity-rent-funding-mismatch');
  const escrow = economicAccount('public-service', 'resident-commerce');
  const transactions: AccountingTransaction[] = [];
  const commerceEvents: CommerceEvent[] = [];
  const move = (
    suffix: string,
    from: ReturnType<typeof economicAccount>,
    to: ReturnType<typeof economicAccount>,
    amount: number,
  ) =>
    transactions.push(
      createMoneyTransfer({
        transactionId: `lease:${after.id}:${after.revision}:${suffix}`,
        reason: `Original lease ${after.id}`,
        from,
        to,
        amount,
      }),
    );
  if (paidRent > 0) {
    move('rent-in', economicAccount('agent', before.tenantId), escrow, paidRent);
    move('rent-out', escrow, economicAccount('agent', before.hostId), paidRent);
  }
  if (returnDeposit) {
    const deposit = w.residentCommerce.deposits[before.depositId];
    if (
      !deposit ||
      deposit.status !== 'held' ||
      deposit.payerId !== before.tenantId ||
      deposit.beneficiaryId !== before.hostId ||
      deposit.held !== before.deposit ||
      deposit.amount !== before.deposit
    )
      throw Error('lease-continuity-deposit-source-mismatch');
    commerceEvents.push({
      type: 'DepositChanged',
      deposit: { ...deposit, held: 0, status: 'returned', revision: deposit.revision + 1 },
    });
    move('deposit-return', escrow, economicAccount('agent', before.tenantId), deposit.held);
  }
  return { transactions, commerceEvents };
}
export function prepareLeaseContinuity(
  w: WorldProjection,
  after: ResidentLease,
  source: LeaseContinuitySource,
  paidRent: number,
): LeaseContinuity {
  const f = facts(w, after, source, paidRent);
  return {
    version: LEASE_CONTINUITY_VERSION,
    source,
    paidRent,
    ...f,
    cash: prepareResidentEstateCashEffects(w, cashSource(after), f.transactions, source.at),
  };
}
export function applyLeaseContinuity(
  w: WorldProjection,
  after: ResidentLease,
  c: LeaseContinuity,
): WorldProjection {
  if (c.version !== LEASE_CONTINUITY_VERSION) throw Error('unsupported-lease-continuity-version');
  const f = facts(w, after, c.source, c.paidRent);
  if (!equal(f.transactions, c.transactions) || !equal(f.commerceEvents, c.commerceEvents))
    throw Error('lease-continuity-recorded-effects-mismatch');
  const residentExits = applyResidentEstateCashEffects(
    w,
    cashSource(after),
    f.transactions,
    c.cash,
    c.source.at,
  );
  if (!residentExits) throw Error('lease-continuity-estate-required');
  const agents = { ...w.agents };
  let escrowDelta = 0;
  for (const t of c.cash.resolution.transactions) {
    assertMoneySupplyDelta({ transaction: t, moneySupplyDelta: 0 });
    for (const entry of t.entries) {
      if (entry.account.sector === 'estate') continue;
      if (entry.account.accountId === 'public-service:resident-commerce') {
        escrowDelta += entry.amount;
        continue;
      }
      if (entry.account.sector !== 'agent') throw Error('invalid-lease-continuity-account');
      const id = entry.account.accountId.slice(6),
        a = agents[id];
      if (!a || !Number.isFinite(a.balance + entry.amount) || a.balance + entry.amount < 0)
        throw Error('invalid-lease-continuity-balance');
      agents[id] = { ...a, balance: a.balance + entry.amount };
    }
  }
  let commerce = w.residentCommerce!;
  for (const e of f.commerceEvents) commerce = applyCommerceEvent(commerce, e);
  if (
    Math.abs(
      commerceEscrowBalance(commerce) - commerceEscrowBalance(w.residentCommerce!) - escrowDelta,
    ) > 1e-8
  )
    throw Error('lease-continuity-escrow-mismatch');
  return { ...w, agents, residentCommerce: commerce, residentExits };
}
