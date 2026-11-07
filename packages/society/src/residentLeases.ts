/** Shared-residence agreements grant occupancy/contribution rights, never ownership of public land. */
export const RESIDENT_LEASE_POLICY = {
  version: 'resident-leases-v1',
  rentPeriodMs: 86400000,
  maxText: 8000,
  maxAmount: 1000000,
} as const;
export type ResidentLease = {
  id: string;
  hostId: string;
  tenantId: string;
  locationId: string;
  terms: string;
  rent: number;
  deposit: number;
  expiresAt: number;
  nextRentAt: number;
  arrears: number;
  revision: number;
  status: 'offered' | 'active' | 'ended';
  at: number;
  depositId: string;
};
export type ResidentLeaseState = {
  version: 'resident-leases-v1';
  leases: Readonly<Record<string, ResidentLease>>;
};
export type ResidentLeaseEvent = { type: 'ResidentLeaseChanged'; lease: ResidentLease };
export type ResidentLeaseCommand =
  | {
      type: 'offer';
      id: string;
      tenantId: string;
      locationId: string;
      terms: string;
      rent: number;
      deposit: number;
      expiresAt: number;
    }
  | { type: 'accept' | 'end' | 'pay'; id: string; expectedRevision: number };
export type LeaseSettlement = {
  payerId: string;
  hostId: string;
  rent: number;
  depositAction: 'lock' | 'return' | 'none';
  deposit: number;
  depositId: string;
  locationId?: string;
};
export function emptyResidentLeaseState(): ResidentLeaseState {
  return { version: 'resident-leases-v1', leases: {} };
}
export function decideResidentLease(
  s: ResidentLeaseState,
  a: string,
  at: number,
  c: ResidentLeaseCommand,
  p: {
    exists: (id: string) => boolean;
    residence: (id: string) => string | undefined;
    canMoveIn: (id: string, location: string) => boolean;
  },
):
  | { accepted: true; events: readonly ResidentLeaseEvent[]; settlement?: LeaseSettlement }
  | { accepted: false; reason: string } {
  const no = (reason: string) => ({ accepted: false as const, reason });
  const changed = (lease: ResidentLease, settlement?: LeaseSettlement) => ({
    accepted: true as const,
    events: [{ type: 'ResidentLeaseChanged' as const, lease }],
    ...(settlement ? { settlement } : {}),
  });
  if (c.type === 'offer') {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}$/.test(c.id) ||
      Object.hasOwn(s.leases, c.id) ||
      !p.exists(a) ||
      !p.exists(c.tenantId) ||
      a === c.tenantId ||
      p.residence(a) !== c.locationId ||
      !c.terms.trim() ||
      c.terms.length > RESIDENT_LEASE_POLICY.maxText ||
      !Number.isFinite(c.rent) ||
      c.rent < 0 ||
      c.rent > RESIDENT_LEASE_POLICY.maxAmount ||
      !Number.isFinite(c.deposit) ||
      c.deposit < 0 ||
      c.deposit > RESIDENT_LEASE_POLICY.maxAmount ||
      !Number.isSafeInteger(c.expiresAt) ||
      c.expiresAt <= at
    )
      return no('invalid-shared-residence-offer');
    return changed({
      id: c.id,
      hostId: a,
      tenantId: c.tenantId,
      locationId: c.locationId,
      terms: c.terms,
      rent: c.rent,
      deposit: c.deposit,
      expiresAt: c.expiresAt,
      nextRentAt: 0,
      arrears: 0,
      revision: 1,
      status: 'offered',
      at,
      depositId: `lease-deposit-${c.id}`,
    });
  }
  const l = s.leases[c.id];
  if (!l || ![l.hostId, l.tenantId].includes(a)) return no('lease-not-found');
  if (l.revision !== c.expectedRevision) return no('revision-conflict');
  const settlement: LeaseSettlement = {
    payerId: l.tenantId,
    hostId: l.hostId,
    rent: 0,
    depositAction: 'none',
    deposit: l.deposit,
    depositId: l.depositId,
  };
  if (c.type === 'accept') {
    if (
      a !== l.tenantId ||
      l.status !== 'offered' ||
      at >= l.expiresAt ||
      p.residence(l.hostId) !== l.locationId ||
      !p.canMoveIn(a, l.locationId) ||
      Object.values(s.leases).some((v) => v.status === 'active' && v.tenantId === a)
    )
      return no('tenant-consent-and-capacity-required');
    return changed(
      {
        ...l,
        status: 'active',
        revision: l.revision + 1,
        nextRentAt: at + RESIDENT_LEASE_POLICY.rentPeriodMs,
      },
      {
        ...settlement,
        rent: l.rent,
        depositAction: l.deposit > 0 ? 'lock' : 'none',
        locationId: l.locationId,
      },
    );
  }
  if (c.type === 'end') {
    if (l.status === 'ended') return no('lease-already-ended');
    return changed(
      { ...l, status: 'ended', revision: l.revision + 1 },
      { ...settlement, depositAction: l.status === 'active' && l.deposit > 0 ? 'return' : 'none' },
    );
  }
  if (a !== l.tenantId || l.arrears <= 0) return no('no-tenant-arrears');
  return changed(
    { ...l, arrears: 0, revision: l.revision + 1 },
    { ...settlement, rent: l.arrears },
  );
}
/** Enumerate each due boundary. Failed collections become exact arrears, never negative cash. */
export function nextLeaseBoundary(l: ResidentLease): number | undefined {
  return l.status === 'offered'
    ? l.expiresAt
    : l.status === 'active'
      ? Math.min(l.nextRentAt, l.expiresAt)
      : undefined;
}
export function settleLeaseBoundary(
  l: ResidentLease,
  at: number,
  canPay: boolean,
): { event: ResidentLeaseEvent; settlement: LeaseSettlement } {
  if (l.status === 'ended' || at !== nextLeaseBoundary(l))
    throw new Error('invalid-lease-boundary');
  const ended = at >= l.expiresAt;
  return {
    event: {
      type: 'ResidentLeaseChanged',
      lease: {
        ...l,
        revision: l.revision + 1,
        status: ended ? 'ended' : 'active',
        nextRentAt: ended ? l.nextRentAt : l.nextRentAt + RESIDENT_LEASE_POLICY.rentPeriodMs,
        arrears: l.arrears + (!ended && !canPay ? l.rent : 0),
      },
    },
    settlement: {
      payerId: l.tenantId,
      hostId: l.hostId,
      rent: ended || !canPay ? 0 : l.rent,
      depositAction: ended && l.status === 'active' && l.deposit > 0 ? 'return' : 'none',
      deposit: l.deposit,
      depositId: l.depositId,
    },
  };
}
export function applyResidentLeaseEvent(
  s: ResidentLeaseState,
  e: ResidentLeaseEvent,
): ResidentLeaseState {
  if (e.lease.revision !== (s.leases[e.lease.id]?.revision ?? 0) + 1)
    throw new Error('lease-revision-gap');
  return { ...s, leases: { ...s.leases, [e.lease.id]: e.lease } };
}

/** Recorded execution source; a boundary is not an impersonated resident command. */
export type LeaseContinuitySource =
  | { readonly kind: 'boundary'; readonly at: number }
  | {
      readonly kind: 'resident';
      readonly at: number;
      readonly actorId: string;
      readonly operation: 'end' | 'pay';
    };
/** Validate immutable terms and recorded effects, without choosing a new action during replay. */
export function validateLeaseContinuityTransition(
  before: ResidentLease,
  after: ResidentLease,
  source: LeaseContinuitySource,
  paidRent: number,
): { returnDeposit: boolean } {
  const fail = () => {
    throw Error('invalid-lease-continuity-transition');
  };
  if (source.kind !== 'boundary' && source.kind !== 'resident') fail();
  if (
    !Number.isSafeInteger(source.at) ||
    source.at < before.at ||
    !Number.isFinite(paidRent) ||
    paidRent < 0 ||
    before.status === 'ended'
  )
    fail();
  const mutable = new Set(['revision', 'status', 'nextRentAt', 'arrears']);
  if (
    Object.keys(before).length !== Object.keys(after).length ||
    Object.entries(before).some(
      ([key, value]) => !mutable.has(key) && Reflect.get(after, key) !== value,
    ) ||
    after.revision !== before.revision + 1
  )
    fail();
  let ended = false;
  if (source.kind === 'boundary') {
    if (source.at !== nextLeaseBoundary(before)) fail();
    ended = source.at >= before.expiresAt;
    if (ended) {
      if (
        paidRent !== 0 ||
        after.arrears !== before.arrears ||
        after.nextRentAt !== before.nextRentAt
      )
        fail();
    } else if (
      before.status !== 'active' ||
      (paidRent !== 0 && paidRent !== before.rent) ||
      after.arrears !== before.arrears + before.rent - paidRent ||
      after.nextRentAt !== before.nextRentAt + RESIDENT_LEASE_POLICY.rentPeriodMs
    )
      fail();
  } else {
    if (![before.hostId, before.tenantId].includes(source.actorId)) fail();
    ended = source.operation === 'end';
    if (after.nextRentAt !== before.nextRentAt) fail();
    if (ended) {
      if (paidRent !== 0 || after.arrears !== before.arrears) fail();
    } else if (
      source.operation !== 'pay' ||
      source.actorId !== before.tenantId ||
      before.arrears <= 0 ||
      paidRent !== before.arrears ||
      after.arrears !== 0
    )
      fail();
  }
  if (after.status !== (ended ? 'ended' : before.status)) fail();
  return { returnDeposit: ended && before.status === 'active' && before.deposit > 0 };
}
