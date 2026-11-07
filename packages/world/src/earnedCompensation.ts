import {
  applyEnterpriseDomainEvent,
  decideEnableEarnedPayroll,
  decideStartEarnedLabor,
  decideAccrueEarnedLabor,
  decidePayEarnedWage,
  type EarnedPayrollEvent,
  type EnterpriseState,
} from '@aivilization/enterprise';
import { earnedLaborWithholding, type EarnedLaborCompensation } from '@aivilization/society';
import { asAgentId } from '@aivilization/sim-core';
import { laborPaymentTransaction } from './residentLaborAccounting';
import { assertMoneySupplyDelta, type AccountingTransaction } from '@aivilization/economy';

export type EarnedWorkFact = {
  readonly actorId: string;
  readonly startedAt: number;
  readonly plannedMs: number;
  readonly settledAt: number;
  readonly elapsedMs: number;
  readonly ended: boolean;
};
export type EarnedCompensationPayload = {
  readonly payroll: readonly EarnedPayrollEvent[];
  readonly withheldMicros: number;
  readonly transactions: readonly AccountingTransaction[];
};

/** Check persisted facts against the caller's source proof; never requote historical wages or tax. */
export function applyEarnedCompensationProof(input: {
  readonly enterprise: EnterpriseState;
  readonly claimId: string;
  readonly actorId: string;
  readonly terms: EarnedLaborCompensation;
  readonly previousWithheldMicros: number;
  readonly payload: EarnedCompensationPayload;
  readonly transactionId: string;
  readonly work?: EarnedWorkFact;
}) {
  let enterprise = input.enterprise,
    paidMicros = 0,
    recorded = 0;
  const existing = enterprise.earnedPayroll?.claims[input.claimId];
  if (!input.payload.payroll.length || input.payload.payroll.length > 3)
    throw Error('invalid-earned-compensation-events');
  for (const event of input.payload.payroll) {
    if (event.type === 'EnterpriseEarnedPayrollEnabled') {
      if (existing || enterprise.earnedPayroll || !input.work)
        throw Error('labor-payroll-activation-mismatch');
    } else if (event.type === 'EnterpriseEarnedWageRecorded') {
      recorded++;
      const c = event.claim,
        w = input.work;
      if (
        !w ||
        c.id !== input.claimId ||
        c.actorId !== input.actorId ||
        c.actorId !== w.actorId ||
        c.laborId !== input.claimId ||
        c.startedAt !== w.startedAt ||
        c.plannedMs !== w.plannedMs ||
        c.totalWageMicros !== input.terms.grossMicros ||
        c.elapsedMs !== w.elapsedMs ||
        c.settledAt !== w.settledAt ||
        c.status !== (w.ended ? 'ended' : 'active')
      )
        throw Error('labor-earned-claim-proof-mismatch');
    } else {
      if (event.claimId !== input.claimId || event.actorId !== input.actorId || !existing)
        throw Error('labor-creditor-proof-mismatch');
      paidMicros += event.amountMicros;
    }
    enterprise = applyEnterpriseDomainEvent(enterprise, event);
  }
  if (recorded !== (input.work ? 1 : 0)) throw Error('labor-earned-progress-required');
  const claim = enterprise.earnedPayroll!.claims[input.claimId];
  if (!claim || claim.actorId !== input.actorId) throw Error('labor-creditor-proof-mismatch');
  const withheld = earnedLaborWithholding(input.terms, claim.paidMicros);
  if (input.payload.withheldMicros !== withheld || withheld < input.previousWithheldMicros)
    throw Error('labor-withholding-proof-mismatch');
  const tax = withheld - input.previousWithheldMicros;
  const expected = laborPaymentTransaction({
    transactionId: input.transactionId,
    enterpriseId: enterprise.enterpriseId,
    actorId: input.actorId,
    paidMicros,
    taxMicros: tax,
  });
  const actual = input.payload.transactions;
  if (
    actual.length !== expected.length ||
    actual.some((t, i) => {
      const x = expected[i]!;
      return (
        t.transactionId !== x.transactionId ||
        t.reason !== x.reason ||
        t.entries.length !== x.entries.length ||
        t.entries.some(
          (entry, j) =>
            entry.amount !== x.entries[j]!.amount ||
            entry.account.accountId !== x.entries[j]!.account.accountId ||
            entry.account.sector !== x.entries[j]!.account.sector,
        )
      );
    })
  )
    throw Error('labor-accounting-proof-mismatch');
  for (const transaction of actual) assertMoneySupplyDelta({ transaction, moneySupplyDelta: 0 });
  return { enterprise, paidMicros, withheld, tax };
}
/** Shared financial orchestration; each caller must supply its own authoritative body/source proof. */
export function decideEarnedCompensation(input: {
  readonly enterprise: EnterpriseState;
  readonly claimId: string;
  readonly terms: EarnedLaborCompensation;
  readonly previouslyWithheldMicros: number;
  readonly pay: boolean;
  readonly transactionId: string;
  readonly work?: EarnedWorkFact;
}) {
  let enterprise = input.enterprise;
  const payroll: EarnedPayrollEvent[] = [];
  const apply = (d: ReturnType<typeof decideEnableEarnedPayroll>) => {
    if (!d.accepted) throw Error(d.reason);
    enterprise = applyEnterpriseDomainEvent(enterprise, d.event);
    payroll.push(d.event);
  };
  if (!enterprise.earnedPayroll) apply(decideEnableEarnedPayroll(enterprise));
  if (input.work) {
    const c = enterprise.earnedPayroll!.claims[input.claimId],
      w = input.work;
    apply(
      c
        ? decideAccrueEarnedLabor({
            enterprise,
            claimId: c.id,
            expectedRevision: c.revision,
            through: w.settledAt,
            elapsedMs: w.elapsedMs,
            ended: w.ended,
          })
        : decideStartEarnedLabor({
            enterprise,
            actorId: asAgentId(w.actorId),
            id: input.claimId,
            laborId: input.claimId,
            at: w.startedAt,
            plannedMs: w.plannedMs,
            totalWageMicros: input.terms.grossMicros,
          }),
    );
  }
  let paidMicros = 0;
  if (input.pay) {
    const c = enterprise.earnedPayroll!.claims[input.claimId];
    if (!c) throw Error('earned-wage-claim-missing');
    const paid = decidePayEarnedWage({
      enterprise,
      actorId: c.actorId,
      claimId: c.id,
      expectedRevision: c.revision,
    });
    if (paid.accepted) {
      if (paid.event.type !== 'EnterpriseEarnedWagePaid') throw Error('invalid-payroll-decision');
      paidMicros = paid.event.amountMicros;
      apply(paid);
    } else if (!input.work || paid.reason !== 'no-payable-earned-wage') throw Error(paid.reason);
  }
  const claim = enterprise.earnedPayroll!.claims[input.claimId];
  if (!claim) throw Error('earned-wage-claim-missing');
  const withheldMicros = earnedLaborWithholding(input.terms, claim.paidMicros);
  const taxMicros = withheldMicros - input.previouslyWithheldMicros;
  return {
    payroll,
    withheldMicros,
    transactions: laborPaymentTransaction({
      transactionId: input.transactionId,
      enterpriseId: enterprise.enterpriseId,
      actorId: claim.actorId,
      paidMicros,
      taxMicros,
    }),
  };
}
