import { assertSuccessionArrangementsState } from './residentSuccession';
import type { SuccessionArrangementsState, SuccessionPorts } from './residentSuccessionModel';
import {
  SUCCESSION_CONTROL_EXECUTION_POLICY as POLICY,
  type SuccessionControlExecutionEvent,
  type SuccessionControlExecutionsState,
  type SuccessionControlOfferRecord,
  type SuccessionControlOfferInput,
} from './successionControlExecutionModel';
const id = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const time = (v: number) => Number.isSafeInteger(v) && v >= 0;
const positive = (v: number) => time(v) && v > 0;
const exact = (v: unknown, keys: readonly string[]) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((key) => Object.hasOwn(v, key));
const check = (v: unknown, reason: string) => {
  if (!v) throw Error(reason);
};
const key = (r: SuccessionControlOfferRecord) =>
  JSON.stringify([r.arrangementId, r.kind, r.resourceId]);
export function assertSuccessionControlOfferRecord(r: SuccessionControlOfferRecord) {
  check(
    exact(r, [
      'id',
      'arrangementId',
      'arrangementRevision',
      'termsRevision',
      'populationEventId',
      'ownerId',
      'executorId',
      'beneficiaryId',
      'kind',
      'resourceId',
      'controlVersion',
      'sourceRevision',
      'at',
      'expiresAt',
    ]) &&
      [
        r.id,
        r.arrangementId,
        r.populationEventId,
        r.ownerId,
        r.executorId,
        r.beneficiaryId,
        r.resourceId,
      ].every(id) &&
      [r.arrangementRevision, r.termsRevision, r.controlVersion, r.sourceRevision].every(
        positive,
      ) &&
      r.termsRevision <= r.arrangementRevision &&
      r.ownerId !== r.executorId &&
      r.ownerId !== r.beneficiaryId &&
      ['stock', 'premises', 'space', 'register', 'group'].includes(r.kind) &&
      time(r.at) &&
      time(r.expiresAt) &&
      r.expiresAt > r.at,
    'invalid-succession-control-offer-record',
  );
}
export function assertSuccessionControlExecutionsState(s: SuccessionControlExecutionsState) {
  check(
    exact(s, ['policy', 'records']) &&
      exact(s.policy, Object.keys(POLICY)) &&
      Object.entries(POLICY).every(([k, v]) => s.policy[k as keyof typeof POLICY] === v) &&
      !!s.records &&
      typeof s.records === 'object' &&
      !Array.isArray(s.records) &&
      Object.keys(s.records).length <= POLICY.maxRecords,
    'invalid-succession-control-executions-state',
  );
  const used = new Set<string>();
  for (const [recordId, r] of Object.entries(s.records)) {
    assertSuccessionControlOfferRecord(r);
    check(recordId === r.id && !used.has(key(r)), 'succession-control-binding-already-used');
    used.add(key(r));
  }
}
export function applySuccessionControlExecutionEvent(
  s: SuccessionControlExecutionsState | undefined,
  e: SuccessionControlExecutionEvent,
): SuccessionControlExecutionsState {
  if (e.type === 'SuccessionControlExecutionsEnabled') {
    check(!s, 'succession-control-executions-already-enabled');
    const next = { policy: structuredClone(e.policy), records: {} };
    assertSuccessionControlExecutionsState(next);
    return next;
  }
  if (!s) throw Error('succession-control-executions-not-enabled');
  assertSuccessionControlExecutionsState(s);
  assertSuccessionControlOfferRecord(e.record);
  check(!s.records[e.record.id], 'succession-control-execution-id-already-used');
  const next = { ...s, records: { ...s.records, [e.record.id]: structuredClone(e.record) } };
  assertSuccessionControlExecutionsState(next);
  return next;
}
/** Cross-aggregate fact validation. Owning application must independently corroborate the population and resource ports and the actual resource offer in the same commit. */
export function assertSuccessionControlOfferSource(
  arrangements: SuccessionArrangementsState,
  record: SuccessionControlOfferRecord,
  p: SuccessionPorts,
) {
  assertSuccessionArrangementsState(arrangements);
  assertSuccessionControlOfferRecord(record);
  const a = arrangements.arrangements[record.arrangementId];
  check(
    a?.status === 'triggered' &&
      a.revision === record.arrangementRevision &&
      a.termsRevision === record.termsRevision &&
      a.ownerId === record.ownerId &&
      a.executorId === record.executorId &&
      a.beneficiaryId === record.beneficiaryId &&
      a.trigger?.fact.eventId === record.populationEventId &&
      record.at >= a.trigger.fact.at &&
      record.expiresAt <= a.trigger.executeBefore,
    'succession-control-exact-triggered-terms-required',
  );
  if (!a?.trigger) throw Error('succession-control-trigger-unavailable');
  check(
    !p.residentAvailable(a.ownerId) &&
      p.residentAvailable(a.executorId) &&
      p.residentAvailable(a.beneficiaryId),
    'succession-control-current-independent-parties-required',
  );
  const b = a.bindings.find((b) => b.kind === record.kind && b.id === record.resourceId);
  check(
    b?.duty === 'control-handover' && b.entitlementVersion === record.controlVersion,
    'succession-control-original-binding-required',
  );
  if (!b) throw Error('succession-control-original-binding-required');
  const f = p.resource(b);
  check(
    f &&
      f.available === true &&
      f.kind === b.kind &&
      f.id === b.id &&
      f.ownerId === a.ownerId &&
      f.entitlementVersion === b.entitlementVersion &&
      f.sourceRevision === record.sourceRevision,
    'succession-control-current-owning-resource-required',
  );
}
/** Preparation is not consumption. Only the actual domain offer and this event committed atomically consume this finite scope. */
export function prepareSuccessionControlOffer(
  arrangements: SuccessionArrangementsState,
  executions: SuccessionControlExecutionsState,
  actorId: string,
  at: number,
  input: SuccessionControlOfferInput,
  p: SuccessionPorts,
) {
  try {
    check(
      exact(input, [
        'id',
        'arrangementId',
        'expectedArrangementRevision',
        'termsRevision',
        'kind',
        'resourceId',
        'expiresAt',
      ]) &&
        id(actorId) &&
        time(at),
      'invalid-succession-control-offer-input',
    );
    assertSuccessionControlExecutionsState(executions);
    const a = arrangements.arrangements[input.arrangementId];
    if (!a) throw Error('succession-arrangement-not-found');
    if (a.status !== 'triggered' || !a.trigger)
      throw Error('succession-control-exact-triggered-terms-required');
    check(actorId === a.executorId, 'succession-control-real-executor-required');
    const binding = a.bindings.find((b) => b.kind === input.kind && b.id === input.resourceId);
    if (!binding) throw Error('succession-control-original-binding-required');
    const f = p.resource(binding);
    if (!f) throw Error('succession-control-source-unavailable');
    const record: SuccessionControlOfferRecord = {
      id: input.id,
      arrangementId: a.id,
      arrangementRevision: input.expectedArrangementRevision,
      termsRevision: input.termsRevision,
      populationEventId: a.trigger?.fact.eventId ?? '',
      ownerId: a.ownerId,
      executorId: actorId,
      beneficiaryId: a.beneficiaryId,
      kind: input.kind,
      resourceId: input.resourceId,
      controlVersion: binding.entitlementVersion,
      sourceRevision: f.sourceRevision,
      at,
      expiresAt: input.expiresAt,
    };
    assertSuccessionControlOfferSource(arrangements, record, p);
    const event: SuccessionControlExecutionEvent = {
      type: 'SuccessionControlOfferRecorded',
      record,
    };
    applySuccessionControlExecutionEvent(executions, event);
    return { accepted: true as const, event };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-succession-control-offer',
    };
  }
}
