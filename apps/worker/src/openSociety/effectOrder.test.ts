import { expect, test } from 'vitest';
import { SHARED_RECORDS_POLICY } from '@aivilization/information';
import {
  validatedEffectOrder,
  concatenateEffectOrder,
  orderedDomainPackets,
  type OrderableEffects,
  type SocietyEffectOrder,
} from './effectOrder';
import { PROGRAM_ACTIONS_POLICY } from '@aivilization/collaboration';
// Actual event types are irrelevant to ordering; owning reducers validate their payloads on application.
const fixture = (): OrderableEffects => ({
  coordinationEvents: [{ type: 'ProgramActionsEnabled', policy: PROGRAM_ACTIONS_POLICY }],
  sharedRecordsEvents: [{ type: 'SharedRecordsEnabled', policy: SHARED_RECORDS_POLICY }],
  effectOrder: {
    version: 'ordered-society-effects-v1',
    entries: [
      { family: 'coordinationEvents', index: 0 },
      { family: 'sharedRecordsEvents', index: 0 },
    ],
  },
});
test('ordered packets retain cross-domain sequence instead of regrouping by event family', () => {
  const e = fixture();
  expect(orderedDomainPackets(e)).toEqual([
    { coordinationEvents: e.coordinationEvents },
    { sharedRecordsEvents: e.sharedRecordsEvents },
  ]);
  expect(orderedDomainPackets(JSON.parse(JSON.stringify(e)) as OrderableEffects)).toEqual(
    orderedDomainPackets(e),
  );
});
test('omitting, duplicating, reordering within a domain or injecting unknown event families rejects', () => {
  const e = fixture(),
    valid = e.effectOrder!;
  for (const entries of [
    valid.entries.slice(1),
    [...valid.entries, valid.entries[0]!],
    [{ family: 'coordinationEvents' as const, index: 1 }, valid.entries[0]!],
  ])
    expect(() => validatedEffectOrder({ ...e, effectOrder: { ...valid, entries } })).toThrow();
  // Untrusted journal data intentionally has a family outside the typed application language.
  const unknown = JSON.parse(
    '{"version":"ordered-society-effects-v1","entries":[{"family":"shell","index":0}]}',
  ) as SocietyEffectOrder;
  expect(() => validatedEffectOrder({ ...e, effectOrder: unknown })).toThrow(
    'invalid-effect-order-reference',
  );
});
test('adding another step or queued reaction rebases references without moving prior events', () => {
  const a = fixture(),
    b = fixture(),
    effectOrder = concatenateEffectOrder(a, b);
  const combined = {
    coordinationEvents: [...a.coordinationEvents!, ...b.coordinationEvents!],
    sharedRecordsEvents: [...a.sharedRecordsEvents!, ...b.sharedRecordsEvents!],
    effectOrder,
  };
  expect(effectOrder.entries).toEqual([
    { family: 'coordinationEvents', index: 0 },
    { family: 'sharedRecordsEvents', index: 0 },
    { family: 'coordinationEvents', index: 1 },
    { family: 'sharedRecordsEvents', index: 1 },
  ]);
  expect(orderedDomainPackets(combined)).toHaveLength(4);
});
test('legacy packets preserve their former family ordering and cannot silently claim an unsupported version', () => {
  const { effectOrder, ...legacy } = fixture();
  expect(effectOrder).toBeDefined();
  expect(validatedEffectOrder(legacy).entries).toEqual([
    { family: 'sharedRecordsEvents', index: 0 },
    { family: 'coordinationEvents', index: 0 },
  ]);
  const future = JSON.parse('{"version":"future-v2","entries":[]}') as SocietyEffectOrder;
  expect(() => validatedEffectOrder({ ...legacy, effectOrder: future })).toThrow(
    'unsupported-effect-order',
  );
});
