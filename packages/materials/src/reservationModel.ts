import type { Controller, ResourcePrincipal } from '@aivilization/authority';
import type { Inventory } from '@aivilization/economy';
export const MATERIAL_RESERVATIONS_POLICY = {
  version: 'material-reservations-v1',
  maxPerStock: 100,
  maxTotal: 10000,
  maxHorizonMs: 30 * 86400000,
  maxTermsChars: 2000,
} as const;
export type MaterialReservationsPolicy = {
  readonly version: 'material-reservations-v1';
  readonly maxPerStock: number;
  readonly maxTotal: number;
  readonly maxHorizonMs: number;
  readonly maxTermsChars: number;
};
export type MaterialConsumer = {
  readonly domain: 'premises';
  readonly id: string;
};
export type MaterialReservation = {
  readonly principalVersion?: 'resource-principals-v2';
  readonly id: string;
  readonly stockId: string;
  readonly beneficiary: ResourcePrincipal;
  readonly consumer: MaterialConsumer;
  readonly original: Inventory;
  readonly held: Inventory;
  readonly allocated: Inventory;
  readonly returned: Inventory;
  readonly createdBy: string;
  readonly decisionId?: string;
  readonly terms: string;
  readonly expiresAt: number;
  readonly revision: number;
  readonly at: number;
  readonly status: 'offered' | 'bound' | 'settled';
  readonly boundBy?: string;
};
export type MaterialReservationsState = {
  readonly policy: MaterialReservationsPolicy;
  readonly records: Readonly<Record<string, MaterialReservation>>;
};
export type MaterialAllocation = {
  readonly reservationId: string;
  readonly consumer: MaterialConsumer;
  readonly items: Inventory;
  readonly evidenceId: string;
};
export type MaterialReservationEvent =
  | { readonly type: 'MaterialReservationsEnabled'; readonly policy: MaterialReservationsPolicy }
  | { readonly type: 'MaterialReservationChanged'; readonly reservation: MaterialReservation };
export type MaterialReservationOffer = {
  readonly id: string;
  readonly stockId: string;
  readonly expectedStockRevision: number;
  readonly items: Inventory;
  readonly beneficiary: Controller;
  readonly consumer: MaterialConsumer;
  readonly terms: string;
  readonly expiresAt: number;
};
/** The application supplies one exact consumer transition; never a caller-controlled boolean or resident CLI payload. */
export type MaterialConsumerAuthorization = {
  readonly consumer: MaterialConsumer;
  readonly beneficiary: ResourcePrincipal;
  readonly evidenceId: string;
  readonly allocation?: Inventory;
  readonly finish?: boolean;
};
export function assertMaterialReservationsPolicy(p: MaterialReservationsPolicy) {
  if (
    p.version !== 'material-reservations-v1' ||
    ![p.maxPerStock, p.maxTotal, p.maxHorizonMs, p.maxTermsChars].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new Error('invalid-material-reservations-policy');
}

/** Explicit v2 entry; ordinary v1 offers retain their original beneficiary schema. */
export type PrincipalMaterialReservationOffer = Omit<MaterialReservationOffer, 'beneficiary'> & {
  readonly beneficiary: ResourcePrincipal;
};
export type PrincipalMaterialReservationCommand =
  | { readonly type: 'reserve-materials'; readonly offer: PrincipalMaterialReservationOffer }
  | {
      readonly type: 'reservation-withdrawn';
      readonly id: string;
      readonly expectedRevision: number;
    };
