/** Experimental natural-day calibration. Rates describe consequences, never required behavior. */
export const RESIDENT_RHYTHM_POLICY = {
  version: 'resident-natural-day-v1',
  dayLengthMs: 86_400_000,
  physiologyMaximum: 100,
  sleepRecoveryPerSecond: 100 / 28_800,
  healthRecoveryPerSecond: 40 / 3600,
  treatmentCurrencyPerSecond: 20 / 3600,
  laborEnergyPerHour: 5,
  laborSatietyPerHour: 3,
  passiveEnergyPerHour: 1,
  passiveSatietyPerHour: 2,
  sleepDeprivationHealthPerSecond: 2 / 3600,
  wagePeriodSeconds: 28_800,
  freeActivityIntervalMs: 900_000,
  opportunityCadenceMs: 60_000,
} as const;
export type ResidentRhythmPolicy = {
  readonly [K in keyof typeof RESIDENT_RHYTHM_POLICY]: K extends 'version'
    ? 'resident-natural-day-v1'
    : number;
};
export function assertResidentRhythmPolicy(p: ResidentRhythmPolicy): void {
  if (
    p.version !== 'resident-natural-day-v1' ||
    Object.entries(p).some(
      ([k, v]) => k !== 'version' && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0),
    )
  )
    throw new Error('invalid-resident-rhythm');
  if (
    [p.dayLengthMs, p.freeActivityIntervalMs, p.opportunityCadenceMs].some(
      (v) => !Number.isSafeInteger(v),
    )
  )
    throw new Error('invalid-resident-rhythm-time');
}
