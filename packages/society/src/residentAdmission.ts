/** Explicit lifetime reservation, separate from biological population and social membership. */
export const RESIDENT_ADMISSION_POLICY = {
  version: 'resident-lifetime-admission-v1',
  reservation: 'living-plus-permanent-exit-v1',
  identity: 'permanent-subject-not-reusable-v1',
  partition: 'requires-reservation-transfer-v1',
} as const;
export type ResidentAdmissionFacts = {
  readonly living: number;
  readonly permanentExits: number;
  readonly cashCapacity: number;
  readonly materialCapacity: number;
  readonly creditCapacity?: number;
};
export function assertResidentAdmissionPolicy(p: typeof RESIDENT_ADMISSION_POLICY) {
  if (
    !p ||
    Object.keys(p).length !== Object.keys(RESIDENT_ADMISSION_POLICY).length ||
    !Object.entries(RESIDENT_ADMISSION_POLICY).every(([k, v]) => p[k as keyof typeof p] === v)
  )
    throw Error('unsupported-resident-admission-policy');
}
export function residentAdmissionReservation(f: ResidentAdmissionFacts) {
  const values = [
    f.living,
    f.permanentExits,
    f.cashCapacity,
    f.materialCapacity,
    ...(f.creditCapacity === undefined ? [] : [f.creditCapacity]),
  ];
  if (
    values.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    f.cashCapacity < 1 ||
    f.materialCapacity < 1 ||
    f.creditCapacity === 0 ||
    !Number.isSafeInteger(f.living + f.permanentExits)
  )
    throw Error('invalid-resident-admission-source');
  const reserved = f.living + f.permanentExits;
  const capacity = Math.min(f.cashCapacity, f.materialCapacity, f.creditCapacity ?? Infinity);
  return { reserved, capacity, remaining: capacity - reserved };
}
/** Ports supply observed owning-domain limits. Missing evidence is not spare capacity. */
export function decideResidentAdmission(
  p: typeof RESIDENT_ADMISSION_POLICY,
  f: ResidentAdmissionFacts,
) {
  assertResidentAdmissionPolicy(p);
  const reservation = residentAdmissionReservation(f);
  return reservation.remaining > 0
    ? { accepted: true as const, reservation }
    : {
        accepted: false as const,
        reason: 'resident-exit-capacity-unreserved' as const,
        reservation,
      };
}
