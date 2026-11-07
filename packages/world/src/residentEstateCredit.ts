import {
  ESTATE_CREDIT_CONTINUITY_POLICY as POLICY,
  applyEstateCreditEvent,
  assertEstateCreditState,
  assertEstateCreditBankCoverage,
  recordEstateCreditCustomer,
  settleEstateCreditCadence,
  applyCreditDomainEvent,
  estateCreditBankSource,
  TOWN_BANK_ACCOUNT_OWNER_ID,
  type EstateCreditEvent,
  type EstateCreditState,
  type CreditPolicy,
  type EstateCreditBankEvent,
} from '@aivilization/credit';
import {
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
} from '@aivilization/economy';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import {
  RESIDENT_EXIT_BANK_PRESERVATION_POLICY,
  assertResidentExitSnapshot,
  residentPhysicalFinancialAccount,
} from './residentExitPreservation';
import {
  prepareResidentEstateCashEffects,
  applyResidentEstateCashEffects,
  type ResidentEstateCashEffects,
} from './residentEstateCashEffects';
import type { ResidentPopulationDeparture } from './residentExitCapture';
export type ResidentEstateCreditPayload = {
  readonly policyVersion: typeof POLICY.version;
  readonly actorId: 'system';
  readonly event: EstateCreditEvent;
  readonly cashEffects: readonly ResidentEstateCashEffects[];
};
type Context = {
  readonly projection: WorldProjection;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
};
function assertCreditMode(w: WorldProjection) {
  if (
    !w.residentExits ||
    w.residentExits.policy.version !== RESIDENT_EXIT_BANK_PRESERVATION_POLICY.version ||
    !w.bank
  )
    throw Error('estate-credit-explicit-bank-preservation-required');
  assertResidentExitSnapshot(w);
}
export function assertResidentEstateCreditSnapshot(w: WorldProjection) {
  if (!w.estateCredit) return;
  assertCreditMode(w);
  assertEstateCreditState(w.estateCredit);
  const owners = new Set<string>();
  for (const c of Object.values(w.estateCredit.customers)) {
    const r = w.residentExits!.records[c.departure.ownerId];
    if (
      !r ||
      !equal(c.departure, {
        ownerId: r.residentId,
        eventId: r.populationEventId,
        at: r.at,
        cause: r.cause,
        populationPolicyVersion: r.populationPolicyVersion,
      })
    )
      throw Error('estate-credit-actual-population-reference-mismatch');
    owners.add(r.residentId);
  }
  if (Object.keys(w.residentExits!.records).some((id) => !owners.has(id)))
    throw Error('estate-credit-customer-coverage-incomplete');
  assertEstateCreditBankCoverage(w.bank!, (id) => !!w.agents[id] || owners.has(id));
}
function assertActivation(w: WorldProjection) {
  assertCreditMode(w);
  if (w.estateCredit || Object.keys(w.residentExits!.records).length)
    throw Error('estate-credit-existing-customer-import-required');
  if (Object.keys(w.agents).length > POLICY.maxCustomers)
    throw Error('estate-credit-admission-capacity-unreserved');
  assertEstateCreditBankCoverage(w.bank!, (id) => !!w.agents[id]);
}
export function prepareEstateCreditDeparture(w: WorldProjection, e: ResidentPopulationDeparture) {
  if (!w.estateCredit) return undefined;
  assertResidentEstateCreditSnapshot(w);
  const d = recordEstateCreditCustomer(w.estateCredit, `estate-credit-${e.sequence}`, {
    ownerId: e.payload.agentId,
    eventId: e.id,
    at: e.type === 'AgentDied' ? e.payload.diedAt : e.payload.emigratedAt,
    cause: e.type === 'AgentDied' ? 'death' : 'emigration',
    populationPolicyVersion: e.payload.policyVersion,
  });
  if (!d.accepted) throw Error(d.reason);
  return d.events;
}
export function applyEstateCreditDeparture(
  w: WorldProjection,
  e: ResidentPopulationDeparture,
  events: readonly EstateCreditEvent[] | undefined,
): EstateCreditState | undefined {
  if (!w.estateCredit) {
    if (events) throw Error('estate-credit-not-enabled');
    return undefined;
  }
  if (events?.length !== 1) throw Error('estate-credit-single-customer-capture-required');
  const event = events[0]!;
  if (
    event.type !== 'EstateCreditCustomerRecorded' ||
    event.customer.id !== `estate-credit-${e.sequence}` ||
    !equal(event.customer.departure, {
      ownerId: e.payload.agentId,
      eventId: e.id,
      at: e.type === 'AgentDied' ? e.payload.diedAt : e.payload.emigratedAt,
      cause: e.type === 'AgentDied' ? 'death' : 'emigration',
      populationPolicyVersion: e.payload.policyVersion,
    })
  )
    throw Error('estate-credit-departure-source-mismatch');
  return applyEstateCreditEvent(w.estateCredit, event);
}
function rawCashTransactions(
  customerId: string,
  ownerId: string,
  previousSerial: number,
  events: readonly EstateCreditBankEvent[],
): readonly AccountingTransaction[] {
  let serial = previousSerial;
  const tx: AccountingTransaction[] = [];
  const move = (amount: number, fromBank: boolean) => {
    if (amount === 0) return;
    serial++;
    tx.push(
      createMoneyTransfer({
        transactionId: `${customerId}-cash-${serial}`,
        reason: 'original-estate-bank-position-settled',
        from: economicAccount(
          fromBank ? 'bank' : 'agent',
          fromBank ? TOWN_BANK_ACCOUNT_OWNER_ID : ownerId,
        ),
        to: economicAccount(
          fromBank ? 'agent' : 'bank',
          fromBank ? ownerId : TOWN_BANK_ACCOUNT_OWNER_ID,
        ),
        amount,
      }),
    );
  };
  for (const e of events)
    if (e.type === 'DepositInterestPaid') for (const p of e.payments) move(p.amount, true);
    else move(e.paidAmount, false);
  return tx;
}
const cashSource = (id: string, revision: number) => ({
  context: 'credit' as const,
  id,
  revision,
  policyVersion: POLICY.settlementPolicyVersion,
});
function wrap(
  input: Context,
  event: EstateCreditEvent,
  cashEffects: readonly ResidentEstateCashEffects[] = [],
) {
  const e = createEventEnvelope({
    id: `${input.requestId}:estate-credit`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentEstateCreditCommitted' as const,
    payload: { policyVersion: POLICY.version, actorId: 'system' as const, event, cashEffects },
  });
  applyResidentEstateCreditProjection(input.projection, e);
  return e;
}
/** Composition/operator API only; no resident CLI or legacy manifest activation. */
export function enableResidentEstateCreditEvent(
  input: Context & { readonly creditPolicy: CreditPolicy },
) {
  assertActivation(input.projection);
  return wrap(input, {
    type: 'EstateCreditEnabled',
    policy: POLICY,
    creditPolicy: input.creditPolicy,
  });
}
export const nextResidentEstateCreditDueAt = (w: WorldProjection) => {
  const dates = Object.values(w.estateCredit?.customers ?? {}).map((c) => c.nextCadenceAt);
  return dates.length ? Math.min(...dates) : undefined;
};
/** Must be called at each exact boundary after living-customer bank settlement and before population terminal events. */
export function residentEstateCreditDueEvent(
  input: Context & { readonly customerId: string },
): WorldEvent {
  const w = input.projection;
  assertResidentEstateCreditSnapshot(w);
  const s = w.estateCredit,
    c = s?.customers[input.customerId];
  if (!s || !c || !w.bank) throw Error('estate-credit-customer-unavailable');
  const account = residentPhysicalFinancialAccount(w, c.departure.ownerId);
  if (!account || account.kind !== 'estate-custody')
    throw Error('estate-credit-actual-cash-custody-unavailable');
  const d = settleEstateCreditCadence(s, w.bank, c.id, w.clock.now, account.balance);
  if (!d.accepted) throw Error(d.reason);
  const event = d.events[0]!;
  if (event.type !== 'EstateCreditCadenceRecorded')
    throw Error('estate-credit-single-cadence-required');
  let working = w;
  const effects: ResidentEstateCashEffects[] = [];
  for (const [i, t] of rawCashTransactions(
    c.id,
    c.departure.ownerId,
    c.cashReceiptSerial,
    event.bankEvents,
  ).entries()) {
    const source = cashSource(c.id, c.cashReceiptSerial + i + 1),
      p = prepareResidentEstateCashEffects(working, source, [t]);
    const residentExits = applyResidentEstateCashEffects(working, source, [t], p);
    if (!residentExits) throw Error('estate-credit-owning-cash-required');
    working = { ...working, residentExits };
    effects.push(p);
  }
  return wrap(input, event, effects);
}
/** Cross-aggregate fact validation and owning reducers only, no lending decision or body reconstruction. */
export function applyResidentEstateCreditProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentEstateCreditCommitted') return undefined;
  const p = e.payload;
  if (p.policyVersion !== POLICY.version || p.actorId !== 'system' || e.occurredAt !== w.clock.now)
    throw Error('invalid-estate-credit-world-packet');
  if (p.event.type === 'EstateCreditEnabled') {
    assertActivation(w);
    if (p.cashEffects.length) throw Error('estate-credit-activation-cannot-move-money');
    const next = { ...w, estateCredit: applyEstateCreditEvent(undefined, p.event) };
    assertResidentEstateCreditSnapshot(next);
    return next;
  }
  if (p.event.type !== 'EstateCreditCadenceRecorded')
    throw Error('estate-credit-departure-must-share-population-event');
  assertResidentEstateCreditSnapshot(w);
  const s = w.estateCredit,
    c = s?.customers[p.event.id];
  if (!s || !c || !w.bank || p.event.at !== w.clock.now)
    throw Error('estate-credit-actual-cadence-required');
  const estateCredit = applyEstateCreditEvent(s, p.event);
  if (!equal(p.event.bankSource, estateCreditBankSource(w.bank, c.departure.ownerId)))
    throw Error('estate-credit-current-bank-source-mismatch');
  const account = residentPhysicalFinancialAccount(w, c.departure.ownerId);
  if (!account || account.kind !== 'estate-custody' || p.event.availableCash !== account.balance)
    throw Error('estate-credit-owning-cash-source-mismatch');
  const bank = p.event.bankEvents.reduce(applyCreditDomainEvent, w.bank),
    transactions = rawCashTransactions(
      c.id,
      c.departure.ownerId,
      c.cashReceiptSerial,
      p.event.bankEvents,
    );
  if (transactions.length !== p.cashEffects.length)
    throw Error('estate-credit-gross-cash-coverage-mismatch');
  let working = w;
  for (const [i, t] of transactions.entries()) {
    const residentExits = applyResidentEstateCashEffects(
      working,
      cashSource(c.id, c.cashReceiptSerial + i + 1),
      [t],
      p.cashEffects[i]!,
    );
    if (!residentExits) throw Error('estate-credit-owning-cash-required');
    working = { ...working, residentExits };
  }
  const bankDelta = transactions.reduce(
    (n, t) =>
      n + t.entries.filter((x) => x.account.sector === 'bank').reduce((n, x) => n + x.amount, 0),
    0,
  );
  if (Math.abs(bank.balance - w.bank.balance - bankDelta) > 1e-8)
    throw Error('estate-credit-bank-cash-ledger-mismatch');
  const next = { ...working, bank, estateCredit };
  assertResidentEstateCreditSnapshot(next);
  return next;
}
