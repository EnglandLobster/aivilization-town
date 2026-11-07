import type { WorldEvent } from '@aivilization/world';
import type { OpenSocietyCommit } from './types';
import { ToolRefusal } from './arguments';

export const FISCAL_OBSERVATION_VERSION = 'resident-fiscal-observation-v1';
const MAX_COMMITS = 128;
const MAX_EVENTS = 2048;
const SUPPORTED = [
  'IncomeTaxCharged',
  'TradeTaxCharged',
  'DividendTaxCharged',
  'SubsidyPaid',
] as const;
type Receipt = {
  category: string;
  source: 'treasury' | 'mint';
  direction: 'inflow' | 'outflow';
  amount: number;
};

/** Copies recorded amounts, never evaluates taxes, subsidy eligibility or settlement formulas. */
function receipt(event: WorldEvent): Receipt | undefined {
  switch (event.type) {
    case 'IncomeTaxCharged':
    case 'TradeTaxCharged':
    case 'DividendTaxCharged':
      return {
        category: event.type,
        source: 'treasury',
        direction: 'inflow',
        amount: event.payload.amount,
      };
    case 'SubsidyPaid':
      return {
        category: event.type,
        source: event.payload.fundingSource ?? 'mint',
        direction: 'outflow',
        amount: event.payload.amount,
      };
    default:
      return undefined;
  }
}

/** A bounded read over already committed facts. No journal writes, private fields or state projection. */
export function readFiscalObservation(input: {
  treasury: number | undefined;
  revision: number;
  /** Commit history by 0-based index; an array works, and so does a journal reading on demand. */
  commits: {
    readonly length: number;
    at(index: number): Pick<OpenSocietyCommit, 'sequence' | 'worldEvents'> | undefined;
  };
  cursor?: string;
}) {
  const history = input.commits;
  // Out-of-range indexes read as absent (Array.prototype.at would wrap negative ones).
  const commits = {
    length: history.length,
    at: (index: number) => (index >= 0 && index < history.length ? history.at(index) : undefined),
  };
  let anchor = commits.length;
  let index = anchor - 1;
  let remaining = commits.at(index)?.worldEvents?.length ?? 0;
  if (input.cursor !== undefined) {
    const match = /^f1:(\d+):(\d+):(\d+)$/.exec(input.cursor);
    if (!match) throw new ToolRefusal('invalid-fiscal-cursor');
    const numbers = match.slice(1).map(Number);
    const [a, revision, events] = numbers as [number, number, number];
    if (
      numbers.some((n) => !Number.isSafeInteger(n)) ||
      a < 1 ||
      a > commits.length ||
      revision < 1 ||
      revision > a ||
      events > (commits.at(revision - 1)?.worldEvents?.length ?? 0)
    )
      throw new ToolRefusal('invalid-fiscal-cursor');
    anchor = a;
    index = revision - 1;
    remaining = events;
  }
  const groups = new Map<string, Receipt & { count: number }>();
  let commitsScanned = 0;
  let eventsScanned = 0;
  let oldestOccurredAt: number | null = null;
  let newestOccurredAt: number | null = null;
  while (index >= 0 && commitsScanned < MAX_COMMITS && eventsScanned < MAX_EVENTS) {
    const commit = commits.at(index)!;
    if (commit.sequence !== index + 1) throw new ToolRefusal('invalid-fiscal-journal-sequence');
    commitsScanned++;
    while (remaining > 0 && eventsScanned < MAX_EVENTS) {
      const event = commit.worldEvents![--remaining]!;
      eventsScanned++;
      oldestOccurredAt = Math.min(oldestOccurredAt ?? event.occurredAt, event.occurredAt);
      newestOccurredAt = Math.max(newestOccurredAt ?? event.occurredAt, event.occurredAt);
      const fact = receipt(event);
      if (!fact) continue;
      if (!Number.isFinite(fact.amount) || fact.amount < 0)
        throw new ToolRefusal('invalid-fiscal-source-amount');
      const key = `${fact.category}:${fact.source}`;
      const previous = groups.get(key);
      const amount = (previous?.amount ?? 0) + fact.amount;
      if (!Number.isFinite(amount)) throw new ToolRefusal('fiscal-aggregate-overflow');
      groups.set(key, { ...fact, amount, count: (previous?.count ?? 0) + 1 });
    }
    if (remaining === 0) {
      index--;
      remaining = commits.at(index)?.worldEvents?.length ?? 0;
    }
  }
  const nextCursor = index < 0 ? null : `f1:${anchor}:${index + 1}:${remaining}`;
  return {
    version: FISCAL_OBSERVATION_VERSION,
    provenance: 'committed-world-facts',
    scope: 'recorded-tax-and-subsidy-event-types-only',
    supportedEventTypes: SUPPORTED,
    currentTreasury: { amount: input.treasury ?? null, observedAtRevision: input.revision },
    historyThroughRevision: anchor,
    groups: [...groups.values()].sort(
      (a, b) =>
        a.category.localeCompare(b.category, 'en') || a.source.localeCompare(b.source, 'en'),
    ),
    coverage: {
      commitsScanned,
      eventsScanned,
      oldestOccurredAt,
      newestOccurredAt,
      reachedHistoryStart: nextCursor === null,
      maxCommits: MAX_COMMITS,
      maxEvents: MAX_EVENTS,
    },
    nextCursor,
    readWith: 'town city observe --view fiscal',
    notes: [
      'Amounts and counts cover this page only. A zero current balance does not describe past receipts or payments.',
      'Not a complete treasury ledger: wages, budgets, escrow and tax within other composite settlements are excluded. Do not reconcile this subset against the balance.',
      'No matching group means none in this scanned page, not none in the entire history. Follow nextCursor even when the page is empty.',
      'Individual identities, private balances and agreement text are not exposed. Mint subsidies are separate from treasury payments.',
    ],
  };
}
