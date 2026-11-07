import {
  assertPrincipalAuthorization,
  samePrincipal,
  type ResourcePrincipal,
} from '@aivilization/authority';
import {
  type PeriodicObligationsState,
  type PeriodicCommand,
  type PeriodicPorts,
  type PeriodicDecision,
  type PeriodicEvent,
  type PeriodicInstallment,
} from './periodicObligationModel';
import { decodePeriodicCommand, assertPeriodicTerms } from './periodicObligationCommand';
import { tradeMoneyMicros } from './tradeFacts';
import { applyPeriodicEvent, assertPeriodicPolicy } from './periodicObligationEvents';
import {
  readPeriodicAccounts,
  periodicRequest,
  periodicPaymentFailure,
  nextPeriodicDueAt,
  periodicTransactions,
} from './periodicObligationFacts';
const no = (reason: string): PeriodicDecision => ({ accepted: false, reason });
function yes(s: PeriodicObligationsState, e: PeriodicEvent): PeriodicDecision {
  applyPeriodicEvent(s, e);
  return { accepted: true, events: [e], transactions: periodicTransactions(s, e) };
}
/** Pure decisions for exact independent authorizations. No storage, clock, body, price inference or other debt aggregate. */
export function decidePeriodicObligation(
  s: PeriodicObligationsState,
  actorId: string,
  at: number,
  input: PeriodicCommand,
  p: PeriodicPorts,
): PeriodicDecision {
  try {
    assertPeriodicPolicy(s.policy);
    const c = decodePeriodicCommand(input);
    if (!p.exists(actorId) || !Number.isSafeInteger(at) || at < 0)
      return no('invalid-periodic-actor-or-time');
    if (c.type === 'offer') {
      assertPeriodicTerms(c, at);
      const r = readPeriodicAccounts(p, c);
      if (
        !r.payer ||
        !r.revenue ||
        r.payer.status !== 'open' ||
        r.revenue.status !== 'open' ||
        samePrincipal(r.payer.principal, r.revenue.principal)
      )
        return no('periodic-open-independent-accounts-required');
      const request = periodicRequest(s, c, r),
        proof = p.authorize(r.payer.principal, request);
      if (!proof) return no('periodic-payer-authority-required');
      assertPrincipalAuthorization(proof, r.payer.principal, request, actorId);
      const { type: operation, ...terms } = c;
      void operation;
      return yes(s, {
        type: 'PeriodicObligationOffered',
        actorId,
        sourceRead: r,
        obligation: {
          ...terms,
          payerPrincipal: r.payer.principal,
          revenuePrincipal: r.revenue.principal,
          offeredAuthorization: proof,
          createdAt: at,
          at,
          revision: 1,
          status: 'offered',
          cursor: 0,
          installments: {},
        },
      });
    }
    const old = s.contracts[c.id];
    if (!old) return no('periodic-obligation-not-found');
    if (old.revision !== c.expectedRevision) return no('periodic-revision-conflict');
    const request = periodicRequest(s, c);
    const parties: readonly ResourcePrincipal[] =
      c.type === 'terminate'
        ? [old.payerPrincipal, old.revenuePrincipal]
        : [
            c.type === 'accept' || c.type === 'decline' || c.type === 'waive'
              ? old.revenuePrincipal
              : old.payerPrincipal,
          ];
    const proof = parties.map((subject) => p.authorize(subject, request)).find(Boolean);
    if (!proof) return no('periodic-original-party-authority-required');
    const base = {
      type: 'PeriodicObligationChanged' as const,
      id: c.id,
      previousRevision: old.revision,
      actorId,
      at,
      command: c,
      authorization: proof,
    };
    if (c.type === 'accept' || c.type === 'withdraw' || c.type === 'decline')
      return yes(s, {
        ...base,
        status: c.type === 'accept' ? 'active' : c.type === 'withdraw' ? 'withdrawn' : 'declined',
        ...(c.type === 'accept' ? { sourceRead: readPeriodicAccounts(p, old) } : {}),
      });
    if (c.type === 'terminate') return yes(s, { ...base, status: 'terminated' });
    const i = old.installments[String(c.period)];
    if (!i || i.status !== 'unpaid') return no('periodic-unpaid-installment-required');
    const read = c.type === 'settle' ? readPeriodicAccounts(p, old) : undefined;
    if (read) {
      const reason = periodicPaymentFailure(old, read);
      if (reason) return no(reason);
    }
    return yes(s, {
      ...base,
      status: old.status,
      installment:
        c.type === 'settle'
          ? { ...i, status: 'paid', paidAt: at }
          : { ...i, status: 'waived', waivedAt: at },
      ...(read ? { sourceRead: read } : {}),
    });
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-periodic-obligation');
  }
}
/** One actual due boundary. The application must enumerate all chronological boundaries and apply each financial packet first. */
export function decidePeriodicDue(
  s: PeriodicObligationsState,
  id: string,
  at: number,
  p: PeriodicPorts,
): PeriodicDecision {
  try {
    assertPeriodicPolicy(s.policy);
    if (!Number.isSafeInteger(at) || at < 0) return no('invalid-periodic-time');
    const c = s.contracts[id];
    if (!c) return no('periodic-obligation-not-found');
    const due = nextPeriodicDueAt(c);
    if (due === undefined || at < due) return { accepted: true, events: [], transactions: [] };
    const r = readPeriodicAccounts(p, c),
      reason = periodicPaymentFailure(c, r);
    const installment: PeriodicInstallment = {
      period: c.cursor + 1,
      dueAt: due,
      amountMicros: tradeMoneyMicros(c.amount),
      recordedAt: at,
      status: reason ? 'unpaid' : 'paid',
      ...(reason ? { unpaidReason: reason } : { paidAt: at }),
    };
    return yes(s, {
      type: 'PeriodicInstallmentRecorded',
      id,
      previousRevision: c.revision,
      at,
      sourceRead: r,
      installment,
    });
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-periodic-due');
  }
}
export function expirePeriodicObligation(
  s: PeriodicObligationsState,
  id: string,
  at: number,
): PeriodicDecision {
  try {
    if (!Number.isSafeInteger(at) || at < 0) return no('invalid-periodic-time');
    const c = s.contracts[id];
    if (!c || c.status !== 'offered' || at < c.acceptBy)
      return { accepted: true, events: [], transactions: [] };
    return yes(s, { type: 'PeriodicObligationExpired', id, previousRevision: c.revision, at });
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-periodic-expiry');
  }
}
