import type { Inventory } from '@aivilization/economy';
/** Backpack preservation only. A source is a real body inventory read, not inherited ownership of all assets. */
export const ESTATE_MATERIAL_CUSTODY_POLICY = {
  version: 'resident-estate-material-custody-v1',
  maxRecords: 2000,
  maxSourceKinds: 1024,
} as const;
export type EstateMaterialSource = {
  readonly ownerId: string;
  readonly populationEventId: string;
  readonly populationPolicyVersion: string;
  readonly cause: 'death' | 'emigration';
  readonly at: number;
  readonly locationId: string | null;
  readonly sourceRevision: number;
  readonly items: Inventory;
};
export type EstateMaterialCustody = {
  readonly id: string;
  readonly revision: 1;
  readonly source: EstateMaterialSource;
  readonly status: 'held';
  readonly locationId: string | null;
  readonly held: Inventory;
};
export type EstateMaterialsState = {
  readonly policy: typeof ESTATE_MATERIAL_CUSTODY_POLICY;
  readonly records: Readonly<Record<string, EstateMaterialCustody>>;
};
export type EstateMaterialFlow = {
  readonly commodity: string;
  readonly quantity: number;
  readonly from: { readonly kind: 'resident-backpack'; readonly id: string };
  readonly to: { readonly kind: 'estate-backpack'; readonly id: string };
};
export type EstateMaterialEvent =
  | {
      readonly type: 'EstateMaterialCustodyEnabled';
      readonly policy: typeof ESTATE_MATERIAL_CUSTODY_POLICY;
    }
  | {
      readonly type: 'EstateBackpackCaptured';
      readonly custody: EstateMaterialCustody;
      readonly flows: readonly EstateMaterialFlow[];
    };
const validId = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const check = (v: unknown, message: string) => {
  if (!v) throw Error(message);
};
const exact = (v: unknown, keys: readonly string[]) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = Object.entries(a).sort(([a], [b]) => a.localeCompare(b)),
    y = Object.entries(b).sort(([a], [b]) => a.localeCompare(b));
  return x.length === y.length && x.every(([k, v], i) => y[i]?.[0] === k && equal(v, y[i]?.[1]));
}
function assertSource(s: EstateMaterialSource) {
  check(
    exact(s, [
      'ownerId',
      'populationEventId',
      'populationPolicyVersion',
      'cause',
      'at',
      'locationId',
      'sourceRevision',
      'items',
    ]) &&
      [s.ownerId, s.populationEventId, s.populationPolicyVersion].every(validId) &&
      (s.locationId === null || validId(s.locationId)) &&
      ['death', 'emigration'].includes(s.cause) &&
      time(s.at) &&
      time(s.sourceRevision) &&
      s.sourceRevision > 0,
    'invalid-estate-backpack-population-source',
  );
  check(
    !!s.items &&
      typeof s.items === 'object' &&
      !Array.isArray(s.items) &&
      Object.keys(s.items).length <= ESTATE_MATERIAL_CUSTODY_POLICY.maxSourceKinds &&
      Object.entries(s.items).every(
        ([k, v]) =>
          k.trim().length > 0 &&
          k.length <= 128 &&
          !Object.hasOwn(Object.prototype, k) &&
          Number.isFinite(v) &&
          v >= 0,
      ),
    'invalid-estate-backpack-source-inventory',
  );
}
const positiveItems = (v: Inventory): Inventory =>
  Object.fromEntries(Object.entries(v).filter(([, n]) => n > 0));
function flows(c: EstateMaterialCustody): readonly EstateMaterialFlow[] {
  return Object.entries(c.held)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([commodity, quantity]) => ({
      commodity,
      quantity,
      from: { kind: 'resident-backpack', id: c.source.ownerId },
      to: { kind: 'estate-backpack', id: c.id },
    }));
}
export function assertEstateMaterialsState(s: EstateMaterialsState) {
  check(
    exact(s, ['policy', 'records']) &&
      equal(s.policy, ESTATE_MATERIAL_CUSTODY_POLICY) &&
      !!s.records &&
      typeof s.records === 'object' &&
      !Array.isArray(s.records) &&
      Object.keys(s.records).length <= s.policy.maxRecords,
    'unsupported-estate-material-custody-state',
  );
  const owners = new Set<string>(),
    events = new Set<string>();
  for (const [id, c] of Object.entries(s.records)) {
    assertSource(c.source);
    check(
      exact(c, ['id', 'revision', 'source', 'status', 'locationId', 'held']) &&
        validId(id) &&
        c.id === id &&
        c.revision === 1 &&
        c.status === 'held' &&
        c.locationId === c.source.locationId &&
        equal(c.held, positiveItems(c.source.items)),
      'estate-material-capture-source-mismatch',
    );
    check(
      !owners.has(c.source.ownerId) && !events.has(c.source.populationEventId),
      'estate-backpack-source-already-preserved',
    );
    owners.add(c.source.ownerId);
    events.add(c.source.populationEventId);
  }
}
export function applyEstateMaterialEvent(
  s: EstateMaterialsState | undefined,
  e: EstateMaterialEvent,
): EstateMaterialsState {
  if (e.type === 'EstateMaterialCustodyEnabled') {
    check(
      !s && equal(e.policy, ESTATE_MATERIAL_CUSTODY_POLICY),
      'invalid-estate-material-activation',
    );
    return { policy: structuredClone(ESTATE_MATERIAL_CUSTODY_POLICY), records: {} };
  }
  if (!s) throw Error('estate-material-custody-not-enabled');
  check(!s.records[e.custody.id], 'estate-material-custody-already-exists');
  const next = { ...s, records: { ...s.records, [e.custody.id]: structuredClone(e.custody) } };
  assertEstateMaterialsState(next);
  check(equal(e.flows, flows(e.custody)), 'estate-material-conservation-proof-mismatch');
  return next;
}
/** World must atomically subtract this exact pre-departure backpack and add only these captured items. No stock, structure, title or capacity is created. */
export function captureEstateBackpack(
  s: EstateMaterialsState,
  id: string,
  source: EstateMaterialSource,
):
  | {
      readonly accepted: true;
      readonly events: readonly EstateMaterialEvent[];
      readonly flows: readonly EstateMaterialFlow[];
    }
  | { readonly accepted: false; readonly reason: string } {
  try {
    assertSource(source);
    const custody: EstateMaterialCustody = {
      id,
      revision: 1,
      source: structuredClone(source),
      status: 'held',
      locationId: source.locationId,
      held: positiveItems(source.items),
    };
    const event: EstateMaterialEvent = {
      type: 'EstateBackpackCaptured',
      custody,
      flows: flows(custody),
    };
    applyEstateMaterialEvent(s, event);
    return { accepted: true, events: [event], flows: event.flows };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-estate-material-capture',
    };
  }
}
