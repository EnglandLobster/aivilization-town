import {
  advanceServicePhysiology,
  SERVICE_PHYSIOLOGY_VERSION,
  type ElapsedPhysiologyInput,
  type ServiceParticipantCondition,
} from '@aivilization/society';
import type { ServiceEngagement } from './engagementModel';
export type ServiceElapsedInterval = {
  readonly from: number;
  readonly until: number;
  readonly decay: ElapsedPhysiologyInput['decay'];
  readonly deprivation?: NonNullable<ElapsedPhysiologyInput['deprivation']>;
};
export type ServiceElapsedBody = ServiceElapsedInterval & {
  readonly policyVersion: typeof SERVICE_PHYSIOLOGY_VERSION;
  readonly engagementId: string;
  readonly workLimitMs: number;
  readonly workedMs: number;
  readonly providerBefore: ServiceParticipantCondition;
  readonly recipientBefore: ServiceParticipantCondition;
  readonly providerAfter: ServiceParticipantCondition;
  readonly recipientAfter: ServiceParticipantCondition;
  readonly exhausted: boolean;
};
export function decideServiceElapsedBody(
  e: ServiceEngagement,
  interval: ServiceElapsedInterval,
  provider: ServiceParticipantCondition,
  recipient: ServiceParticipantCondition,
  available: boolean,
): ServiceElapsedBody {
  const from = interval.from,
    until = interval.until;
  if (
    !e.providerPresence ||
    !e.recipientPresence ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(until) ||
    until <= from ||
    from < e.settledAt ||
    from < Math.max(e.providerPresence.startedAt, e.recipientPresence.startedAt)
  )
    throw Error('invalid-service-elapsed-interval');
  const workLimitMs = available
    ? Math.min(
        until - from,
        e.maxDurationMs - e.progressMs,
        Math.max(0, Math.min(e.endAt, e.providerPresence.until, e.recipientPresence.until) - from),
      )
    : 0;
  const input = {
    modelId: e.modelId,
    previousProgressMs: e.progressMs,
    provider,
    recipient,
    educationCeiling: e.educationCeiling ?? 0,
    elapsedMs: until - from,
    workLimitMs,
    decay: interval.decay,
    ...(interval.deprivation ? { deprivation: interval.deprivation } : {}),
  };
  const result = advanceServicePhysiology(input);
  const exhausted =
    available &&
    (result.workedMs < workLimitMs ||
      (workLimitMs === until - from &&
        workLimitMs < e.maxDurationMs - e.progressMs &&
        advanceServicePhysiology({
          ...input,
          elapsedMs: input.elapsedMs + 1,
          workLimitMs: workLimitMs + 1,
        }).workedMs === result.workedMs));
  return {
    ...interval,
    policyVersion: SERVICE_PHYSIOLOGY_VERSION,
    engagementId: e.id,
    workLimitMs,
    workedMs: result.workedMs,
    providerBefore: provider,
    recipientBefore: recipient,
    providerAfter: result.provider,
    recipientAfter: result.recipient,
    exhausted,
  };
}
export function serviceElapsedEffect(e: ServiceEngagement, body: ServiceElapsedBody) {
  if (body.policyVersion !== SERVICE_PHYSIOLOGY_VERSION || body.engagementId !== e.id)
    throw Error('invalid-service-body-version-or-source');
  return advanceServicePhysiology({
    modelId: e.modelId,
    previousProgressMs: e.progressMs,
    provider: body.providerBefore,
    recipient: body.recipientBefore,
    educationCeiling: e.educationCeiling ?? 0,
    elapsedMs: body.until - body.from,
    workLimitMs: body.workLimitMs,
    decay: body.decay,
    ...(body.deprivation ? { deprivation: body.deprivation } : {}),
  });
}
