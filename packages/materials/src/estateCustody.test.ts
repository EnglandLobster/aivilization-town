import { expect, test } from 'vitest';
import {
  ESTATE_MATERIAL_CUSTODY_POLICY as POLICY,
  applyEstateMaterialEvent,
  captureEstateBackpack,
  assertEstateMaterialsState,
  type EstateMaterialSource,
  type EstateMaterialEvent,
  type EstateMaterialsState,
} from './estateCustody';
function fixture(items = { Bread: 2.25, Wood: 0 }) {
  const state = applyEstateMaterialEvent(undefined, {
    type: 'EstateMaterialCustodyEnabled',
    policy: POLICY,
  });
  const source: EstateMaterialSource = {
    ownerId: 'a',
    populationEventId: 'real-death',
    populationPolicyVersion: 'explicit-population-v2',
    cause: 'death',
    at: 100,
    locationId: 'market',
    sourceRevision: 41,
    items,
  };
  return { state, source };
}
test('preserves real fractional backpack at its actual location exactly once, excludes zero entries from transferable material and creates no warehouse, land or new item', () => {
  const t = fixture(),
    original = structuredClone(t.source),
    d = captureEstateBackpack(t.state, 'a-bag', t.source);
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error('fixture');
  expect(d.flows).toEqual([
    {
      commodity: 'Bread',
      quantity: 2.25,
      from: { kind: 'resident-backpack', id: 'a' },
      to: { kind: 'estate-backpack', id: 'a-bag' },
    },
  ]);
  const s = d.events.reduce(applyEstateMaterialEvent, t.state);
  expect(s.records['a-bag']).toMatchObject({
    held: { Bread: 2.25 },
    locationId: 'market',
    status: 'held',
    source: original,
  });
  expect(captureEstateBackpack(s, 'duplicate', t.source).accepted).toBe(false);
  expect(t.source).toEqual(original);
  assertEstateMaterialsState(s);
  const replay = [
    { type: 'EstateMaterialCustodyEnabled' as const, policy: POLICY },
    ...d.events,
  ].reduce<EstateMaterialsState | undefined>(
    (s, e) => applyEstateMaterialEvent(s, JSON.parse(JSON.stringify(e)) as EstateMaterialEvent),
    undefined,
  );
  expect(replay).toEqual(s);
});
test('empty personal backpack is recorded truthfully with no physical flows or fabricated stock; unenabled state refuses capture', () => {
  const t = fixture({ Bread: 0, Wood: 0 }),
    d = captureEstateBackpack(t.state, 'empty', t.source);
  if (!d.accepted) throw Error(d.reason);
  expect(d.flows).toEqual([]);
  expect(d.events.reduce(applyEstateMaterialEvent, t.state).records.empty!.held).toEqual({});
  expect(() => applyEstateMaterialEvent(undefined, d.events[0]!)).toThrow(
    'estate-material-custody-not-enabled',
  );
});
test('invalid physical source, negative/nonfinite amount or invented item/proof/location is rejected without changing any source inventory', () => {
  const t = fixture();
  for (const q of [-1, Infinity, NaN])
    expect(
      captureEstateBackpack(t.state, 'bad', { ...t.source, items: { Bread: q } }).accepted,
    ).toBe(false);
  expect(captureEstateBackpack(t.state, 'bad', { ...t.source, sourceRevision: 0 }).accepted).toBe(
    false,
  );
  const d = captureEstateBackpack(t.state, 'a-bag', t.source);
  if (!d.accepted) throw Error('fixture');
  const e = d.events[0]!;
  if (e.type !== 'EstateBackpackCaptured') throw Error('fixture');
  expect(() =>
    applyEstateMaterialEvent(t.state, { ...e, custody: { ...e.custody, held: { Bread: 3 } } }),
  ).toThrow('estate-material-capture-source-mismatch');
  expect(() =>
    applyEstateMaterialEvent(t.state, { ...e, custody: { ...e.custody, locationId: 'elsewhere' } }),
  ).toThrow('estate-material-capture-source-mismatch');
  expect(() =>
    applyEstateMaterialEvent(t.state, { ...e, flows: e.flows.map((f) => ({ ...f, quantity: 4 })) }),
  ).toThrow('estate-material-conservation-proof-mismatch');
  expect(t.state.records).toEqual({});
});

test('unobserved physical location is retained as null custody and never replaced by an invented default market or destination', () => {
  const t = fixture(),
    d = captureEstateBackpack(t.state, 'unlocated', { ...t.source, locationId: null });
  if (!d.accepted) throw Error(d.reason);
  const state = d.events.reduce(applyEstateMaterialEvent, t.state);
  expect(state.records.unlocated!.locationId).toBeNull();
  expect(state.records.unlocated!.source.locationId).toBeNull();
  expect(state.records.unlocated!.held).toEqual({ Bread: 2.25 });
  assertEstateMaterialsState(state);
});
