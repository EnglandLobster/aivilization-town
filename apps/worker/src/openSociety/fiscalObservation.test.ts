import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import type { WorldEvent } from '@aivilization/world';
import { readFiscalObservation } from './fiscalObservation';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';

function tax(sequence = 1, amount = 5, actor = 'private-person'): WorldEvent {
  return createEventEnvelope({
    id: `tax-${sequence}`,
    simulationId: 'fiscal-test',
    type: 'TradeTaxCharged',
    sequence,
    occurredAt: sequence,
    payload: {
      agentId: asAgentId(actor),
      commodityName: 'private-product',
      saleProceeds: 100,
      amount,
      previousBalance: 100,
      nextBalance: 100 - amount,
    },
  });
}
function subsidy(source?: 'treasury' | 'mint'): WorldEvent {
  return createEventEnvelope({
    id: 'subsidy',
    simulationId: 'fiscal-test',
    type: 'SubsidyPaid',
    sequence: 2,
    occurredAt: 2,
    payload: {
      agentId: asAgentId('private-recipient'),
      amount: 5,
      previousBalance: 0,
      nextBalance: 5,
      reason: 'private-reason',
      ...(source === undefined ? {} : { fundingSource: source }),
    },
  });
}

test('zero treasury retains separate recorded inflow/outflow without exposing private payloads', () => {
  const input = {
    treasury: 0,
    revision: 1,
    commits: [{ sequence: 1, worldEvents: [tax(), subsidy('treasury')] }],
  };
  const original = structuredClone(input);
  const view = readFiscalObservation(input);
  expect(view.currentTreasury.amount).toBe(0);
  expect(view.groups).toEqual([
    { category: 'SubsidyPaid', source: 'treasury', direction: 'outflow', amount: 5, count: 1 },
    { category: 'TradeTaxCharged', source: 'treasury', direction: 'inflow', amount: 5, count: 1 },
  ]);
  expect(view.scope).toBe('recorded-tax-and-subsidy-event-types-only');
  expect(JSON.stringify(view)).not.toContain('private-');
  expect(input).toEqual(original);
});

test('legacy minted subsidy is not treasury spending; absent balance remains unknown', () => {
  const view = readFiscalObservation({
    treasury: undefined,
    revision: 1,
    commits: [{ sequence: 1, worldEvents: [subsidy()] }],
  });
  expect(view.groups).toEqual([
    { category: 'SubsidyPaid', source: 'mint', direction: 'outflow', amount: 5, count: 1 },
  ]);
  expect(view.currentTreasury.amount).toBeNull();
  const empty = readFiscalObservation({ treasury: undefined, revision: 0, commits: [] });
  expect(empty.groups).toEqual([]);
  expect(empty.nextCursor).toBeNull();
});

test('one large commit splits at event budget without omissions and ignores later appends', () => {
  const commits = [
    { sequence: 1, worldEvents: Array.from({ length: 2049 }, (_, i) => tax(i + 1, 1)) },
  ];
  const first = readFiscalObservation({ treasury: 2049, revision: 1, commits });
  expect(first.coverage.eventsScanned).toBe(2048);
  expect(first.groups[0]?.count).toBe(2048);
  expect(first.nextCursor).not.toBeNull();
  const next = readFiscalObservation({
    treasury: 2054,
    revision: 2,
    commits: [...commits, { sequence: 2, worldEvents: [tax(2050)] }],
    cursor: first.nextCursor!,
  });
  expect(next.historyThroughRevision).toBe(1);
  expect(next.groups[0]?.amount).toBe(1);
  expect(next.nextCursor).toBeNull();
  expect(next.currentTreasury).toEqual({ amount: 2054, observedAtRevision: 2 });
});

test('empty commit pages still advance a bounded cursor rather than claiming no past receipts', () => {
  const commits = Array.from({ length: 130 }, (_, i) => ({
    sequence: i + 1,
    worldEvents: i === 0 ? [tax()] : [],
  }));
  const first = readFiscalObservation({ treasury: 5, revision: 130, commits });
  expect(first.coverage.commitsScanned).toBe(128);
  expect(first.groups).toEqual([]);
  expect(first.nextCursor).not.toBeNull();
  const next = readFiscalObservation({
    treasury: 5,
    revision: 130,
    commits,
    cursor: first.nextCursor!,
  });
  expect(next.groups[0]?.amount).toBe(5);
  expect(next.coverage.commitsScanned).toBe(2);
  expect(next.nextCursor).toBeNull();
});

test('invalid cursor or non-finite source refuses instead of guessing scope or money', () => {
  const input = { treasury: 5, revision: 1, commits: [{ sequence: 1, worldEvents: [tax()] }] };
  for (const cursor of [
    '',
    'f2:1:1:1',
    'f1:2:1:1',
    'f1:1:0:0',
    'f1:1:1:2',
    'f1:1:1:-1',
    'f1:9007199254740992:1:1',
  ])
    expect(() => readFiscalObservation({ ...input, cursor })).toThrow('invalid-fiscal-cursor');
  expect(() =>
    readFiscalObservation({ ...input, commits: [{ sequence: 1, worldEvents: [tax(1, NaN)] }] }),
  ).toThrow('invalid-fiscal-source-amount');
});

test('runtime observation is authenticated, read-only for world state, replayable and compatible with old manifest bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'fiscal-observation-'));
  const manifest = createOpenSocietyManifest({ count: 2 });
  const runtime = new OpenSocietyRuntime(root, manifest);
  const actor = manifest.residents[0]!.id;
  try {
    const manifestBytes = readFileSync(join(root, 'manifest.json'));
    runtime.beginTurn(actor);
    const before = structuredClone(runtime.state.world);
    const query = runtime.invoke(actor, {
      name: 'world.observe',
      arguments: { view: 'fiscal' },
      requestId: 'fiscal',
    });
    expect(query.ok, query.error).toBe(true);
    expect(query.data).toMatchObject({ currentTreasury: { amount: before.treasury }, groups: [] });
    expect(runtime.state.world).toEqual(before);
    expect(() =>
      runtime.invoke('unknown-resident', {
        name: 'world.observe',
        arguments: { view: 'fiscal' },
        requestId: 'unknown',
      }),
    ).toThrow('unknown-resident');
    expect(
      runtime.invoke(actor, {
        name: 'world.observe',
        arguments: { view: 'self', cursor: 'f1:1:1:0' },
        requestId: 'wrong-view',
      }).error,
    ).toBe('cursor-only-supported-for-fiscal-observation');
    expect(
      runtime.invoke(actor, {
        name: 'world.observe',
        arguments: { view: 'fiscal', limit: 1 },
        requestId: 'wrong-page',
      }).error,
    ).toBe('fiscal-observation-use-cursor');
    const state = structuredClone(runtime.state);
    const bytes = readFileSync(join(root, 'journal.jsonl'));
    runtime.close();
    const reopened = new OpenSocietyRuntime(root);
    try {
      expect(reopened.state).toEqual(state);
      expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
      expect(readFileSync(join(root, 'manifest.json'))).toEqual(manifestBytes);
    } finally {
      reopened.close();
    }
  } finally {
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
