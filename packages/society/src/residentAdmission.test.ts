import { expect, test } from 'vitest';
import {
  RESIDENT_ADMISSION_POLICY as POLICY,
  decideResidentAdmission,
  residentAdmissionReservation,
} from './residentAdmission';
const facts = {
  living: 1999,
  permanentExits: 0,
  cashCapacity: 2000,
  materialCapacity: 2000,
  creditCapacity: 2000,
};
test('an admission reserves actual future custody before a body is created, including the last available slot', () => {
  expect(decideResidentAdmission(POLICY, facts)).toMatchObject({
    accepted: true,
    reservation: { remaining: 1 },
  });
  expect(decideResidentAdmission(POLICY, { ...facts, living: 2000 })).toMatchObject({
    accepted: false,
    reason: 'resident-exit-capacity-unreserved',
  });
});
test('real death converts one living reservation into one permanent reservation without freeing or needing another slot', () => {
  const before = residentAdmissionReservation({ ...facts, living: 2000 });
  expect(residentAdmissionReservation({ ...facts, living: 1999, permanentExits: 1 })).toEqual(
    before,
  );
  expect(
    decideResidentAdmission(POLICY, { ...facts, living: 1999, permanentExits: 1 }).accepted,
  ).toBe(false);
});
test('weakest actual owning domain bounds admission; missing bank mode does not fabricate a bank', () => {
  expect(decideResidentAdmission(POLICY, { ...facts, creditCapacity: 1000 }).accepted).toBe(false);
  expect(
    residentAdmissionReservation({
      living: 2,
      permanentExits: 1,
      cashCapacity: 8,
      materialCapacity: 4,
    }),
  ).toEqual({ reserved: 3, capacity: 4, remaining: 1 });
});
test('source and policy guard reject non-finite, fractional, zero capacity or altered rules', () => {
  for (const n of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => residentAdmissionReservation({ ...facts, living: n })).toThrow(
      'invalid-resident-admission-source',
    );
  expect(() => residentAdmissionReservation({ ...facts, creditCapacity: 0 })).toThrow();
  const p = structuredClone(POLICY);
  Object.assign(p, { identity: 'reuse-identity' });
  expect(() => decideResidentAdmission(p, facts)).toThrow('unsupported-resident-admission-policy');
});
