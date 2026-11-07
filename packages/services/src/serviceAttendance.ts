import { advanceElapsedPhysiology, type ServiceParticipantCondition } from '@aivilization/society';
import type { ServiceEngagement } from './engagementModel';
import type { ServiceElapsedInterval } from './elapsedBody';
export const SERVICE_ATTENDANCE_VERSION = 'resident-service-attendance-v1';
export type ServiceAttendanceBody = ServiceElapsedInterval & {
  readonly policyVersion: typeof SERVICE_ATTENDANCE_VERSION;
  readonly engagementId: string;
  readonly attendedMs: number;
  readonly providerBefore: ServiceParticipantCondition;
  readonly providerAfter: ServiceParticipantCondition;
  readonly exhausted: boolean;
};
/** Waiting establishes actual presence, not delivered service or patient/learning effects. */
export function decideServiceAttendanceBody(
  e: ServiceEngagement,
  interval: ServiceElapsedInterval,
  provider: ServiceParticipantCondition,
  available: boolean,
): ServiceAttendanceBody {
  if (
    !e.providerPresence ||
    e.recipientPresence ||
    !Number.isSafeInteger(interval.from) ||
    !Number.isSafeInteger(interval.until) ||
    interval.until <= interval.from ||
    interval.from < Math.max(e.settledAt, e.providerPresence.startedAt)
  )
    throw Error('invalid-service-attendance-interval');
  const elapsedMs = interval.until - interval.from;
  const body = (ms: number) =>
    advanceElapsedPhysiology({
      previous: provider,
      elapsedMs: ms,
      decay: interval.decay,
      ...(interval.deprivation ? { deprivation: interval.deprivation } : {}),
    }).next;
  const maximum = available
    ? Math.max(
        0,
        Math.min(elapsedMs, e.endAt - interval.from, e.providerPresence.until - interval.from),
      )
    : 0;
  let low = 0,
    high = provider.health > 0 ? maximum : 0;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (body(middle).health > 0) low = middle;
    else high = middle - 1;
  }
  return {
    ...interval,
    policyVersion: SERVICE_ATTENDANCE_VERSION,
    engagementId: e.id,
    attendedMs: low,
    providerBefore: provider,
    providerAfter: { ...body(elapsedMs), educationScore: provider.educationScore },
    exhausted:
      available && (low < maximum || (maximum === elapsedMs && body(maximum + 1).health <= 0)),
  };
}
