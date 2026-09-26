import { it, expect } from 'vitest';
import { emptyHouseholdState, decideHousehold, applyHouseholdEvent } from './residentHouseholds';
import { emptyCareState, decideCare, applyCareEvent, advanceCare } from './residentCare';
import {
  emptyHealthRecordsState,
  decideHealthRecord,
  applyHealthRecordEvent,
  canReadHealth,
} from './residentHealthRecords';
import {
  emptyResidentLeaseState,
  decideResidentLease,
  applyResidentLeaseEvent,
  settleLeaseBoundary,
  RESIDENT_LEASE_POLICY,
} from './residentLeases';
it('household facts require two consents and real shared residence, never emotional scoring', () => {
  let s = emptyHouseholdState();
  const p = { exists: () => true, cohabiting: () => false };
  const d = decideHousehold(
    s,
    'a',
    0,
    { type: 'propose', id: 'family', partnerId: 'b', kind: 'cohabitation', terms: '原文' },
    p,
  );
  if (!d.accepted) throw Error('create');
  s = d.events.reduce(applyHouseholdEvent, s);
  expect(
    decideHousehold(s, 'a', 0, { type: 'accept', id: 'family', expectedRevision: 1 }, p).accepted,
  ).toBe(false);
  expect(
    decideHousehold(s, 'b', 0, { type: 'accept', id: 'family', expectedRevision: 1 }, p),
  ).toMatchObject({ accepted: false, reason: 'real-shared-residence-required' });
  const accepted = decideHousehold(
    s,
    'b',
    0,
    { type: 'accept', id: 'family', expectedRevision: 1 },
    { ...p, cohabiting: () => true },
  );
  if (!accepted.accepted) throw Error('accept');
  const next = accepted.events.reduce(applyHouseholdEvent, s);
  expect(next.links.family?.status).toBe('active');
  expect(
    [...d.events, ...accepted.events].reduce(applyHouseholdEvent, emptyHouseholdState()),
  ).toEqual(next);
});
it('care needs provider consent, co-location, real duration and equivalent completion across cadence', () => {
  let s = emptyCareState();
  const p = { exists: () => true, locationExists: () => true, presentAndIdle: () => true };
  const d = decideCare(
    s,
    'b',
    0,
    {
      type: 'request',
      id: 'care',
      providerId: 'a',
      locationId: 'home',
      description: '照护',
      durationMs: 10,
    },
    p,
  );
  if (!d.accepted) throw Error('request');
  s = d.events.reduce(applyCareEvent, s);
  expect(
    decideCare(s, 'b', 0, { type: 'accept', id: 'care', expectedRevision: 1 }, p).accepted,
  ).toBe(false);
  const a = decideCare(s, 'a', 0, { type: 'accept', id: 'care', expectedRevision: 1 }, p);
  if (!a.accepted) throw Error('accept');
  s = a.events.reduce(applyCareEvent, s);
  const started = decideCare(s, 'a', 0, { type: 'start', id: 'care', expectedRevision: 2 }, p);
  if (!started.accepted) throw Error('start');
  expect(started.participation?.participants).toEqual(['a', 'b']);
  s = started.events.reduce(applyCareEvent, s);
  const half = advanceCare(s, 5).reduce(applyCareEvent, s);
  expect(advanceCare(half, 20).reduce(applyCareEvent, half)).toEqual(
    advanceCare(s, 20).reduce(applyCareEvent, s),
  );
});
it('patients control clinical records; invalid evidence never becomes treatment', () => {
  let s = emptyHealthRecordsState();
  const p = { exists: () => true, ownsSource: () => false };
  expect(
    decideHealthRecord(
      s,
      'a',
      0,
      {
        type: 'record',
        id: 'note',
        patientId: 'b',
        kind: 'note',
        content: '私密',
        sourceEventIds: [],
      },
      p,
    ).accepted,
  ).toBe(false);
  const grant = decideHealthRecord(s, 'b', 0, { type: 'grant', targetId: 'a' }, p);
  if (!grant.accepted) throw Error('grant');
  s = grant.events.reduce(applyHealthRecordEvent, s);
  expect(canReadHealth(s, 'a', 'b')).toBe(true);
  expect(
    decideHealthRecord(
      s,
      'a',
      0,
      {
        type: 'record',
        id: 'fake',
        patientId: 'b',
        kind: 'treatment',
        content: '假治疗',
        sourceEventIds: ['forged'],
      },
      p,
    ).accepted,
  ).toBe(false);
  const record = decideHealthRecord(
    s,
    'a',
    0,
    {
      type: 'record',
      id: 'note',
      patientId: 'b',
      kind: 'note',
      content: '原文',
      sourceEventIds: [],
    },
    p,
  );
  if (!record.accepted) throw Error('record');
  s = record.events.reduce(applyHealthRecordEvent, s);
  const revoke = decideHealthRecord(s, 'b', 0, { type: 'revoke', targetId: 'a' }, p);
  if (!revoke.accepted) throw Error('revoke');
  s = revoke.events.reduce(applyHealthRecordEvent, s);
  expect(canReadHealth(s, 'a', 'b')).toBe(false);
  expect(s.records.note?.content).toBe('原文');
});
it('lease offers do not grant land ownership; deadlines, arrears and refunds are explicit facts', () => {
  let s = emptyResidentLeaseState();
  const period = RESIDENT_LEASE_POLICY.rentPeriodMs,
    p = { exists: () => true, residence: () => 'home', canMoveIn: () => true };
  const create = decideResidentLease(
    s,
    'a',
    0,
    {
      type: 'offer',
      id: 'l',
      tenantId: 'b',
      locationId: 'home',
      terms: '贡献费用',
      rent: 5,
      deposit: 10,
      expiresAt: period * 3,
    },
    p,
  );
  if (!create.accepted) throw Error('offer');
  s = create.events.reduce(applyResidentLeaseEvent, s);
  expect(
    decideResidentLease(s, 'a', 0, { type: 'accept', id: 'l', expectedRevision: 1 }, p).accepted,
  ).toBe(false);
  const accept = decideResidentLease(
    s,
    'b',
    0,
    { type: 'accept', id: 'l', expectedRevision: 1 },
    p,
  );
  if (!accept.accepted) throw Error('accept');
  s = accept.events.reduce(applyResidentLeaseEvent, s);
  expect(accept.settlement).toMatchObject({ rent: 5, depositAction: 'lock' });
  const due = settleLeaseBoundary(s.leases.l!, period, false);
  s = applyResidentLeaseEvent(s, due.event);
  expect(s.leases.l?.arrears).toBe(5);
  expect(due.settlement.rent).toBe(0);
  const next = settleLeaseBoundary(s.leases.l!, period * 2, true);
  s = applyResidentLeaseEvent(s, next.event);
  const expiry = settleLeaseBoundary(s.leases.l!, period * 3, true);
  expect(expiry.event.lease.status).toBe('ended');
  expect(expiry.settlement).toMatchObject({ rent: 0, depositAction: 'return' });
});
