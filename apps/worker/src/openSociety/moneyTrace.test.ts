import { expect, test } from 'vitest';
import { accountingTransactions, createMoneyTracer, RETURNED } from './moneyTrace';
import type { TracedTransaction } from './moneyTrace';

const agent = (id: string) => ({ accountId: `agent:${id}`, sector: 'agent' });
const pool = { accountId: 'collective:club', sector: 'collective' };
const tx = (id: string, entries: [typeof pool, number][]): TracedTransaction => ({
  transactionId: id,
  reason: 'test',
  entries: entries.map(([account, amount]) => ({ account, amount })),
});
function record() {
  const inflow: Record<string, Record<string, number>> = {};
  const outflow: Record<string, Record<string, number>> = {};
  const links: [string, string][] = [];
  const bump = (side: typeof inflow, id: string, label: string, amount: number) => {
    const bag = (side[id] ??= {});
    bag[label] = (bag[label] ?? 0) + amount;
  };
  return {
    inflow,
    outflow,
    links,
    sink: {
      inflow: (id: string, label: string, amount: number) => bump(inflow, id, label, amount),
      outflow: (id: string, label: string, amount: number) => bump(outflow, id, label, amount),
      link: (from: string, to: string) => links.push([from, to]),
    },
  };
}

test('a pooled account pays out the money of the residents who funded it', () => {
  const tracer = createMoneyTracer(new Set(['a', 'b', 'c']));
  const r = record();
  tracer.transaction(
    tx('t1', [
      [agent('a'), -30],
      [pool, 30],
    ]),
    r.sink,
  );
  tracer.transaction(
    tx('t2', [
      [agent('b'), -10],
      [pool, 10],
    ]),
    r.sink,
  );
  // The same transaction seen twice (e.g. nested in two events) counts once.
  tracer.transaction(
    tx('t2', [
      [agent('b'), -10],
      [pool, 10],
    ]),
    r.sink,
  );
  tracer.transaction(
    tx('t3', [
      [pool, -20],
      [agent('c'), 20],
    ]),
    r.sink,
  );
  expect(r.outflow).toEqual({ a: { 'collective:test': 30 }, b: { 'collective:test': 10 } });
  expect(r.inflow.c).toEqual({ fromResidents: 20 });
  expect(r.links).toEqual([
    ['a', 'c'],
    ['b', 'c'],
  ]);
  // a takes back what is left of their own money first; the rest is b's.
  tracer.transaction(
    tx('t4', [
      [pool, -20],
      [agent('a'), 20],
    ]),
    r.sink,
  );
  expect(r.inflow.a).toEqual({ [RETURNED]: 15, fromResidents: 5 });
  // Beyond anything traced, the account's own money is labeled by its sector.
  tracer.transaction(
    tx('t5', [
      [pool, -7],
      [agent('c'), 7],
    ]),
    r.sink,
  );
  expect(r.inflow.c).toEqual({ fromResidents: 20, 'collective:test': 7 });
});

test('public sources are origins and transactions are found anywhere in a payload', () => {
  const tracer = createMoneyTracer(new Set(['a']));
  const r = record();
  const treasury = { accountId: 'treasury:public-treasury', sector: 'treasury' };
  const clearing = { accountId: 'public-service:labor', sector: 'public-service' };
  const payload = {
    events: [
      {
        receipt: {
          transactions: [
            tx('reserve', [
              [treasury, -5],
              [clearing, 5],
            ]),
          ],
        },
      },
      {
        transactionId: 'pay',
        reason: 'wage',
        entries: [
          { account: clearing, amount: -5 },
          { account: agent('a'), amount: 5 },
        ],
      },
    ],
  };
  const found = accountingTransactions(payload);
  expect(found.map((t) => t.transactionId)).toEqual(['reserve', 'pay']);
  for (const t of found) tracer.transaction(t, r.sink);
  expect(r.inflow.a).toEqual({ 'treasury:wage': 5 });
});
