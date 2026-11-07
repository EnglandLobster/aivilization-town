import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { OPEN_SOCIETY_TOOLS } from './catalog';
import {
  assertCapabilityEffects,
  capabilityBoundary,
  validateCapabilityBoundaries,
} from './capabilityBoundaries';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
import * as recordTools from './sharedRecordTools';

const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups.length = 0;
});
const tool = (name: string) => OPEN_SOCIETY_TOOLS.find((t) => t.name === name)!;
function runtime(kernel = true) {
  const root = mkdtempSync(join(tmpdir(), 'society-boundaries-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 2, societyKernel: kernel }),
  );
  cleanups.push(() => r.close());
  let ordinal = 0;
  const [a, b] = r.manifest.residents.map((v) => v.id) as [string, string];
  const call = (name: string, args: Record<string, unknown>) => {
    r.beginTurn(a);
    const result = r.invoke(a, { name, arguments: args, requestId: `req-${++ordinal}` });
    r.finishTurn(a, { summary: 'boundary test' });
    return result;
  };
  return { r, a, b, call };
}

test('new and misclassified commands fail closed instead of inheriting a category default', () => {
  expect(() => validateCapabilityBoundaries(OPEN_SOCIETY_TOOLS)).not.toThrow();
  expect(() => capabilityBoundary({ ...tool('files.read'), name: 'files.unreviewed' })).toThrow(
    'missing-capability-boundary',
  );
  expect(() => capabilityBoundary({ ...tool('records.put'), mutates: false })).toThrow(
    'mutation-boundary-mismatch',
  );
  expect(() =>
    validateCapabilityBoundaries(OPEN_SOCIETY_TOOLS.filter((t) => t.name !== 'records.put')),
  ).toThrow('orphan-capability-boundary');
  expect(capabilityBoundary(tool('records.put'))).toMatchObject({
    records: ['attributed-claim'],
    delegation: 'exact-version-limited-mandate',
    cli: 'town records put',
  });
  expect(capabilityBoundary(tool('world.study'))).toMatchObject({
    participation: 'personal-physical-action',
    delegation: 'not-enabled',
    cli: 'town education study',
  });
  expect(capabilityBoundary(tool('world.study')).governingRules.map((r) => r.source)).toEqual([
    'integrity',
    'world-model',
    'initial-institution',
  ]);
});

test('residents can inspect actual boundaries without enabling effects or obtaining another resource authority', () => {
  const t = runtime(false);
  expect(t.call('rules.capability', { name: 'records.put' })).toMatchObject({
    ok: true,
    data: {
      records: ['attributed-claim'],
      availability: { adapterEnabled: false },
      cli: 'town records put',
    },
  });
  expect(t.r.state.sharedRecords).toBeUndefined();
  expect(t.call('rules.capability', { name: 'does.not-exist' })).toMatchObject({
    ok: false,
    error: 'capability-not-found',
  });
  expect(t.call('rules.capabilities', { category: 'world', limit: 1 })).toMatchObject({
    ok: true,
    data: { items: [{ name: 'world.observe' }] },
  });
  expect(t.call('rules.capabilities', { category: 'not-a-category' })).toMatchObject({
    ok: true,
    data: { total: 0, items: [] },
  });
});

test('adapter boundary stops a record writer from moving real money before durable mutation', () => {
  const t = runtime();
  expect(
    t.call('payments.transfer', { targetId: t.b, amount: 3, note: 'authorized fixture' }).ok,
  ).toBe(true);
  const events = t.r.journal.commits.find(
    (c) => c.capability === 'payments.transfer',
  )!.worldEvents!;
  expect(events.length).toBeGreaterThan(0);
  expect(() => assertCapabilityEffects(tool('records.put'), { worldEvents: events })).toThrow(
    'capability-effect-boundary-violation:records.put:worldEvents',
  );
  vi.spyOn(recordTools, 'executeSharedRecordTool').mockReturnValue({
    data: { claimed: 'written' },
    effects: { worldEvents: events },
  });
  t.r.beginTurn(t.a);
  const before = structuredClone(t.r.state),
    count = t.r.journal.commits.length;
  expect(() =>
    t.r.invoke(t.a, {
      name: 'records.put',
      requestId: 'forged-effects',
      arguments: {
        registerId: 'claims',
        key: 'entry',
        expectedRevision: 0,
        values: { text: 'claim' },
      },
    }),
  ).toThrow('capability-effect-boundary-violation');
  expect(t.r.state).toEqual(before);
  expect(t.r.journal.commits).toHaveLength(count);
});

test('reading receipts are permitted but cannot smuggle membership changes through a read operation', () => {
  const t = runtime();
  expect(t.call('groups.create', { id: 'group', title: 'Voluntary group' }).ok).toBe(true);
  const events = t.r.journal.commits.find(
    (c) => c.capability === 'groups.create',
  )!.communicationEvents!;
  expect(() =>
    assertCapabilityEffects(tool('groups.messages'), { communicationEvents: events }),
  ).toThrow('capability-receipt-boundary-violation');
  expect(() =>
    assertCapabilityEffects(tool('groups.messages'), {
      communicationEvents: [
        { type: 'GroupMessagesRead', ownerId: t.a, messageIds: ['actual-message'] },
      ],
    }),
  ).not.toThrow();
  expect(() =>
    assertCapabilityEffects(tool('rules.read'), { lifeEnabled: 'resident-life-v1' }),
  ).toThrow('capability-effect-boundary-violation');
});
