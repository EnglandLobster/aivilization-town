import {
  assertServicesPolicy,
  STAFFED_SERVICES_POLICY,
  type ServicesState,
  type ServicesEvent,
} from './model';
export type ServicePolicyUpgradeEvent = {
  readonly type: 'ServicePolicyUpgraded';
  readonly version: 'resident-service-policy-transition-v1';
  readonly at: number;
  readonly previousPolicy: ServicesState['policy'];
  readonly policy: ServicesState['policy'];
  readonly retiredServiceIds: readonly string[];
};
/** Drain under the old agreement; never invent providers or recalculate completed attendance. */
export function decideServicePolicyUpgrade(
  s: ServicesState,
  at: number,
): { accepted: true; events: readonly ServicesEvent[] } | { accepted: false; reason: string } {
  assertServicesPolicy(s.policy);
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!Number.isSafeInteger(at) || at < 0) return no('invalid-service-policy-time');
  if (s.policy.version === 'resident-services-v3') return { accepted: true, events: [] };
  const pending = transitionBlocker(s, at);
  if (pending) return no(pending);
  return {
    accepted: true,
    events: [
      {
        type: 'ServicePolicyUpgraded',
        version: 'resident-service-policy-transition-v1',
        at,
        previousPolicy: structuredClone(s.policy),
        policy: {
          ...STAFFED_SERVICES_POLICY,
          maxCapacity: s.policy.maxCapacity,
          maxText: s.policy.maxText,
        },
        retiredServiceIds: Object.keys(s.services).sort(),
      },
    ],
  };
}
function transitionBlocker(s: ServicesState, at: number): string | undefined {
  if (Object.values(s.services).some((v) => v.active)) return 'active-services-require-close';
  if (
    Object.values(s.bookings).some((b) =>
      ['requested', 'accepted', 'checked-in'].includes(b.status),
    )
  )
    return 'outstanding-service-bookings';
  if (Object.values(s.queues).some((q) => q.status === 'waiting'))
    return 'outstanding-service-queue';
  if (
    Object.values(s.slots).some(
      (slot) =>
        (slot.startedAt !== undefined && (slot.providerUntil ?? slot.end) > at) ||
        slot.providers?.some((p) => p.endedAt === undefined && p.until > at),
    )
  )
    return 'outstanding-service-provider-time';
  return undefined;
}
export function applyServicePolicyUpgrade(
  s: ServicesState,
  e: ServicePolicyUpgradeEvent,
): ServicesState {
  assertServicesPolicy(e.previousPolicy);
  assertServicesPolicy(e.policy);
  if (
    e.version !== 'resident-service-policy-transition-v1' ||
    s.policyTransition ||
    s.policy.version === 'resident-services-v3' ||
    e.previousPolicy.version !== s.policy.version ||
    e.previousPolicy.maxCapacity !== s.policy.maxCapacity ||
    e.previousPolicy.maxText !== s.policy.maxText ||
    e.policy.version !== 'resident-services-v3' ||
    e.policy.maxCapacity !== s.policy.maxCapacity ||
    e.policy.maxText !== s.policy.maxText ||
    e.policy.maxProviderShiftsPerSlot !== STAFFED_SERVICES_POLICY.maxProviderShiftsPerSlot ||
    transitionBlocker(s, e.at) !== undefined ||
    !Number.isSafeInteger(e.at) ||
    e.at < 0 ||
    JSON.stringify(e.retiredServiceIds) !== JSON.stringify(Object.keys(s.services).sort()) ||
    e.retiredServiceIds.some((id) => s.services[id]?.active)
  )
    throw new Error('invalid-service-policy-upgrade-event');
  return {
    ...s,
    policy: structuredClone(e.policy),
    policyTransition: {
      version: e.version,
      at: e.at,
      previousPolicy: structuredClone(e.previousPolicy),
      retiredServiceIds: [...e.retiredServiceIds],
    },
  };
}
