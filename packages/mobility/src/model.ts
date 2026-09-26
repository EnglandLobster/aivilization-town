export const MOBILITY_POLICY = {
  version: 'resident-mobility-v1',
  maxFare: 10000,
  maxHorizonMs: 86_400_000,
  maxQuotesPerRide: 100,
} as const;
export type MobilityPolicy = {
  readonly version: typeof MOBILITY_POLICY.version;
  readonly maxFare: number;
  readonly maxHorizonMs: number;
  readonly maxQuotesPerRide: number;
};
export type Journey = {
  readonly from: string;
  readonly to: string;
  readonly departedAt: number;
  readonly arrivesAt: number;
  readonly people: readonly string[];
};
export type Vehicle = {
  readonly id: string;
  readonly ownerId: string;
  readonly authorized: readonly string[];
  readonly locationId: string;
  readonly seats: number;
  readonly revision: number;
  readonly journey?: Journey;
};
export type Driver = {
  readonly id: string;
  readonly vehicleId: string;
  readonly online: boolean;
  readonly revision: number;
};
export type RideStatus =
  | 'requested'
  | 'booked'
  | 'pickup'
  | 'ready'
  | 'riding'
  | 'completed'
  | 'cancelled';
export type Ride = {
  readonly id: string;
  readonly riderId: string;
  readonly pickupId: string;
  readonly destinationId: string;
  readonly expiresAt: number;
  readonly at: number;
  readonly revision: number;
  readonly status: RideStatus;
  readonly driverId?: string;
  readonly vehicleId?: string;
  readonly quoteId?: string;
  readonly fare?: number;
  readonly endReason?: string;
};
export type Quote = {
  readonly id: string;
  readonly rideId: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly fare: number;
  readonly expiresAt: number;
  readonly active: boolean;
  readonly revision: number;
};
export type MobilityState = {
  readonly policy: MobilityPolicy;
  readonly vehicles: Readonly<Record<string, Vehicle>>;
  readonly drivers: Readonly<Record<string, Driver>>;
  readonly rides: Readonly<Record<string, Ride>>;
  readonly quotes: Readonly<Record<string, Quote>>;
};
export type MobilityEvent =
  | { readonly type: 'VehicleChanged'; readonly value: Vehicle }
  | { readonly type: 'DriverChanged'; readonly value: Driver }
  | { readonly type: 'RideChanged'; readonly value: Ride }
  | { readonly type: 'RideQuoteChanged'; readonly value: Quote };
export type MobilityCommand =
  | {
      type: 'vehicles.authorize' | 'vehicles.revoke';
      id: string;
      residentId: string;
      expectedRevision: number;
    }
  | { type: 'drivers.register'; vehicleId: string }
  | { type: 'drivers.online' | 'drivers.offline' }
  | { type: 'rides.request'; id: string; destinationId: string; expiresAt: number }
  | { type: 'rides.quote'; id: string; rideId: string; fare: number; expiresAt: number }
  | { type: 'rides.withdraw'; id: string; expectedRevision: number }
  | { type: 'rides.book'; id: string; quoteId: string; expectedRevision: number }
  | { type: 'rides.pickup' | 'rides.board' | 'rides.cancel'; id: string; expectedRevision: number };
export type MobilityPorts = {
  readonly exists: (id: string) => boolean;
  readonly location: (id: string) => string | null;
  readonly idle: (id: string) => boolean;
  readonly destinationExists: (id: string) => boolean;
  readonly arrivalAt: (people: readonly string[], from: string, to: string) => number | null;
};
export type FareEffect = { readonly kind: 'fund' | 'refund' | 'pay'; readonly ride: Ride };
export type MobilityDecision =
  | {
      readonly accepted: true;
      readonly events: readonly MobilityEvent[];
      readonly fares: readonly FareEffect[];
    }
  | { readonly accepted: false; readonly reason: string };
export function validateMobilityPolicy(p: MobilityPolicy) {
  if (
    p.version !== MOBILITY_POLICY.version ||
    ![p.maxFare, p.maxHorizonMs, p.maxQuotesPerRide].every((x) => Number.isSafeInteger(x) && x > 0)
  )
    throw new Error('invalid-mobility-policy');
}
export function emptyMobilityState(
  vehicles: readonly Vehicle[],
  policy: MobilityPolicy = MOBILITY_POLICY,
): MobilityState {
  validateMobilityPolicy(policy);
  if (
    new Set(vehicles.map((v) => v.id)).size !== vehicles.length ||
    vehicles.some(
      (v) =>
        !v.id ||
        !v.ownerId ||
        !v.locationId ||
        v.revision !== 1 ||
        v.journey ||
        !Number.isSafeInteger(v.seats) ||
        v.seats < 2 ||
        new Set(v.authorized).size !== v.authorized.length,
    )
  )
    throw new Error('invalid-vehicle-seed');
  return {
    policy,
    vehicles: Object.fromEntries(vehicles.map((v) => [v.id, structuredClone(v)])),
    drivers: {},
    rides: {},
    quotes: {},
  };
}
export const activeRide = (r: Ride) => r.status !== 'completed' && r.status !== 'cancelled';
export const assignedRide = (r: Ride) => activeRide(r) && r.status !== 'requested';
export const authorizedDriver = (v: Vehicle, id: string) =>
  v.ownerId === id || v.authorized.includes(id);
