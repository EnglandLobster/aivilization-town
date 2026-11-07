/**
 * Who a resident's money came from, traced through intermediate accounts.
 *
 * Domains record money as double-entry accounting transactions. Many flows between residents do not
 * go account to account: an order's payment waits in an escrow (clearing) account, a collective
 * pays out of a pooled account, an enterprise pays wages out of what customers paid it. Labeling a
 * credit by the immediate payer would call all of those "not from residents", and labeling every
 * credit to a resident "from residents" would count escrow refunds of one's own money as income.
 *
 * So every account that can hold residents' money remembers whose money it holds. When it pays a
 * resident, their own money comes back first ("returned", not income); the rest is attributed to
 * the residents who funded it, and any remainder to the account's own sector. Public and external
 * sources (treasury, market maker, outside world, monetary authority) are origins, not traced.
 */
export type TracedTransaction = {
  readonly transactionId: string;
  readonly reason: string;
  readonly entries: readonly {
    readonly account: { readonly accountId: string; readonly sector: string };
    readonly amount: number;
  }[];
};
export type MoneySink = {
  inflow(residentId: string, label: string, amount: number): void;
  outflow(residentId: string, label: string, amount: number): void;
  /** Money moved from one resident to another, directly or through intermediate accounts. */
  link(fromResidentId: string, toResidentId: string): void;
};
/** Inflow label for a resident's own money coming back (an escrow refund, a withdrawal). */
export const RETURNED = 'returned';
const ORIGIN_SECTORS = new Set(['treasury', 'market', 'external', 'monetary-authority']);
const EPSILON = 1e-9;

/** Every accounting transaction nested anywhere in an event payload. */
export function accountingTransactions(payload: unknown): TracedTransaction[] {
  const found: TracedTransaction[] = [];
  const walk = (value: unknown, depth: number) => {
    if (value === null || typeof value !== 'object' || depth > 12) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const v = value as Record<string, unknown>;
    if (typeof v.transactionId === 'string' && Array.isArray(v.entries)) {
      const entries = v.entries.flatMap((entry: unknown) => {
        const e = entry as {
          account?: { accountId?: unknown; sector?: unknown };
          amount?: unknown;
        };
        return typeof e?.account?.accountId === 'string' &&
          typeof e.account.sector === 'string' &&
          typeof e.amount === 'number' &&
          Number.isFinite(e.amount)
          ? [
              {
                account: { accountId: e.account.accountId, sector: e.account.sector },
                amount: e.amount,
              },
            ]
          : [];
      });
      found.push({
        transactionId: v.transactionId,
        reason: typeof v.reason === 'string' ? v.reason : 'unspecified',
        entries,
      });
      return;
    }
    for (const item of Object.values(v)) walk(item, depth + 1);
  };
  walk(payload, 0);
  return found;
}

type Composition = Map<string, number>;
const addTo = (c: Composition, key: string, amount: number) => {
  const next = (c.get(key) ?? 0) + amount;
  if (Math.abs(next) < EPSILON) c.delete(key);
  else c.set(key, next);
};
const total = (c: Composition) => [...c.values()].reduce((a, b) => a + b, 0);

export function createMoneyTracer(residents: ReadonlySet<string>) {
  const holdings = new Map<string, Composition>();
  const seen = new Set<string>();
  const residentOf = (accountId: string, sector: string) => {
    if (sector !== 'agent' || !accountId.startsWith('agent:')) return undefined;
    const id = accountId.slice('agent:'.length);
    return residents.has(id) ? id : undefined;
  };
  /** Take `amount` out of a tracked account, the given resident's own money first. */
  const draw = (accountId: string, sector: string, amount: number, prefer?: string) => {
    const held = holdings.get(accountId) ?? new Map<string, number>();
    holdings.set(accountId, held);
    const taken: Composition = new Map();
    let remaining = amount;
    if (prefer !== undefined) {
      const own = Math.min(held.get(`agent:${prefer}`) ?? 0, remaining);
      if (own > EPSILON) {
        addTo(held, `agent:${prefer}`, -own);
        addTo(taken, `agent:${prefer}`, own);
        remaining -= own;
      }
    }
    const known = total(held);
    const fromKnown = Math.min(Math.max(known, 0), remaining);
    if (fromKnown > EPSILON)
      for (const [key, value] of [...held]) {
        const part = (value / known) * fromKnown;
        addTo(held, key, -part);
        addTo(taken, key, part);
      }
    // Money the account had before anything we saw (e.g. founding capital) is its own.
    if (remaining - fromKnown > EPSILON) addTo(taken, `sector:${sector}`, remaining - fromKnown);
    return taken;
  };
  return {
    transaction(tx: TracedTransaction, sink: MoneySink): void {
      if (seen.has(tx.transactionId)) return;
      seen.add(tx.transactionId);
      const debits = tx.entries.filter((e) => e.amount < -EPSILON);
      const credits = tx.entries.filter((e) => e.amount > EPSILON);
      const credited = credits.reduce((a, e) => a + e.amount, 0);
      if (!debits.length || credited <= EPSILON) return;
      const creditResidents = credits.map((e) => residentOf(e.account.accountId, e.account.sector));
      // A payout to one resident draws their own money first (a refund is not income).
      const prefer =
        creditResidents.length === 1 && creditResidents[0] !== undefined
          ? creditResidents[0]
          : undefined;
      const pool: Composition = new Map();
      for (const debit of debits) {
        const amount = -debit.amount;
        const { accountId, sector } = debit.account;
        const resident = residentOf(accountId, sector);
        if (resident !== undefined) {
          addTo(pool, `agent:${resident}`, amount);
          // The payer's outflow, split over who received it.
          for (const credit of credits) {
            const to = residentOf(credit.account.accountId, credit.account.sector);
            sink.outflow(
              resident,
              to !== undefined ? 'toResidents' : `${credit.account.sector}:${tx.reason}`,
              amount * (credit.amount / credited),
            );
          }
        } else if (sector === 'agent' || ORIGIN_SECTORS.has(sector))
          addTo(pool, `sector:${sector}`, amount);
        else
          for (const [key, value] of draw(accountId, sector, amount, prefer))
            addTo(pool, key, value);
      }
      const pooled = total(pool);
      for (const [index, credit] of credits.entries()) {
        const to = creditResidents[index];
        const { accountId, sector } = credit.account;
        if (to !== undefined) {
          for (const [key, value] of pool) {
            const amount = (value / pooled) * credit.amount;
            if (key === `agent:${to}`) sink.inflow(to, RETURNED, amount);
            else if (key.startsWith('agent:')) {
              sink.inflow(to, 'fromResidents', amount);
              sink.link(key.slice('agent:'.length), to);
            } else sink.inflow(to, `${key.slice('sector:'.length)}:${tx.reason}`, amount);
          }
        } else if (sector !== 'agent' && !ORIGIN_SECTORS.has(sector)) {
          // An intermediate account now holds this composition of other people's money.
          const held = holdings.get(accountId) ?? new Map<string, number>();
          holdings.set(accountId, held);
          for (const [key, value] of pool) addTo(held, key, (value / pooled) * credit.amount);
        }
      }
    },
  };
}
