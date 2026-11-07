import type { FreightCustodyState } from './custodyHandoff';
import type {
  Controller,
  ResourcePrincipal,
  ControlAuthorizationPort,
} from '@aivilization/authority';
import type { Inventory, AccountingTransaction } from '@aivilization/economy';
import type { MaterialCustodyProof } from '@aivilization/materials';

export const LOGISTICS_POLICY = {
  version: 'resident-logistics-v1',
  loadModel: 'quantity-load-v1',
  maxTotal: 10000,
  maxPerController: 500,
  maxTermsChars: 8000,
  maxWindowMs: 30 * 86400000,
  maxFee: 1000000,
  personalLoadCapacity: 20,
} as const;
export type LogisticsPolicy = typeof LOGISTICS_POLICY;
export type FreightAccount = { readonly sector: 'agent' | 'collective'; readonly id: string };
export type FreightTerms = {
  readonly id: string;
  readonly controller: Controller;
  readonly recipient: Controller;
  readonly sourceStockId: string;
  readonly destinationStockId: string;
  readonly sourceLocationId: string;
  readonly destinationLocationId: string;
  readonly materialRef: { readonly id: string; readonly revision: number };
  readonly items: Inventory;
  readonly carrierId: string;
  readonly vehicleId?: string;
  readonly payer: FreightAccount;
  readonly deliveryFee: number;
  readonly returnFee: number;
  readonly deadline: number;
  readonly title: string;
  readonly terms: string;
};
export type FreightStatus =
  | 'offered'
  | 'accepted'
  | 'funded'
  | 'loaded'
  | 'return-required'
  | 'delivered'
  | 'returned'
  | 'cancelled';
export type Freight = FreightTerms & {
  readonly status: FreightStatus;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly at: number;
  readonly revision: number;
  readonly funded: number;
  readonly escrow: number;
  readonly paid: number;
  readonly refunded: number;
};
export type FreightOperation =
  | 'offer'
  | 'accept'
  | 'fund'
  | 'load'
  | 'deliver'
  | 'return'
  | 'cancel'
  | 'expire';
export type FreightReceipt = {
  readonly settlement?: {
    readonly fromStatus: FreightStatus | null;
    readonly toStatus: FreightStatus;
    readonly funded: number;
    readonly paid: number;
    readonly refunded: number;
    readonly escrowBefore: number;
    readonly escrowAfter: number;
  };
  readonly id: string;
  readonly freightId: string;
  readonly actorId: string;
  readonly at: number;
  readonly operation: FreightOperation;
  readonly decisionId?: string;
  /** An unaccepted offer owns no custody; release only its still-unbound matching material offer. */
  readonly releaseUnboundSource?: boolean;
};
export type LogisticsEvent =
  | { readonly type: 'LogisticsEnabled'; readonly policy: LogisticsPolicy }
  | { readonly type: 'FreightChanged'; readonly freight: Freight }
  | { readonly type: 'FreightReceiptRecorded'; readonly receipt: FreightReceipt };
export type LogisticsState = {
  readonly custody?: FreightCustodyState;
  readonly policy: LogisticsPolicy;
  readonly freight: Readonly<Record<string, Freight>>;
  readonly receipts: Readonly<Record<string, FreightReceipt>>;
};
export type LogisticsCommand =
  | ({ readonly type: 'offer' } & FreightTerms)
  | {
      readonly type: Exclude<FreightOperation, 'offer' | 'expire'>;
      readonly id: string;
      readonly expectedRevision: number;
    };
export type LogisticsDecision =
  | {
      readonly accepted: true;
      readonly events: readonly LogisticsEvent[];
      readonly transactions: readonly AccountingTransaction[];
      readonly materialProofs: readonly MaterialCustodyProof[];
    }
  | { readonly accepted: false; readonly reason: string };
export type LogisticsPorts = {
  readonly exists: (id: string) => boolean;
  readonly controllerAvailable: (c: Controller) => boolean;
  readonly authorize: ControlAuthorizationPort;
  readonly stock: (
    id: string,
  ) =>
    | { locationId: string; controller: ResourcePrincipal; status: 'open' | 'settling' | 'closed' }
    | undefined;
  readonly material: (id: string) =>
    | {
        stockId: string;
        revision: number;
        status: 'offered' | 'bound' | 'settled';
        expiresAt: number;
        beneficiary: Controller;
        consumer: { domain: string; id: string };
        held: Inventory;
      }
    | undefined;
  readonly account: (
    a: FreightAccount,
  ) => { controller: Controller; balance: number; status: 'open' | 'settling' } | undefined;
  readonly presentAndIdle: (actorId: string, locationId: string) => boolean;
  readonly routeExists: (from: string, to: string) => boolean;
  /** Shared physical gate uses actual carrier/vehicle location, cargo custody, ACL and capacity. */
  readonly cargoAccess: (
    f: Freight,
    operation: 'load' | 'deliver' | 'return',
  ) => string | undefined;
};
export function assertLogisticsPolicy(p: LogisticsPolicy) {
  if (
    Object.keys(p).length !== Object.keys(LOGISTICS_POLICY).length ||
    Object.entries(LOGISTICS_POLICY).some(([k, v]) => p[k as keyof LogisticsPolicy] !== v)
  )
    throw Error('unsupported-logistics-policy');
}
export const emptyLogisticsState = (policy: LogisticsPolicy = LOGISTICS_POLICY): LogisticsState => {
  assertLogisticsPolicy(policy);
  return { policy, freight: {}, receipts: {} };
};
export const activeFreight = (f: Freight) =>
  !['cancelled', 'returned', 'delivered'].includes(f.status);
export const loadedFreight = (f: Freight) =>
  f.status === 'loaded' || f.status === 'return-required';
export const freightRejected = (reason: string): LogisticsDecision => ({ accepted: false, reason });
export const freightEscrowBalance = (s: LogisticsState | undefined) =>
  Object.values(s?.freight ?? {}).reduce((n, f) => n + f.escrow, 0);
export const freightAccountObligations = (s: LogisticsState | undefined, accountId: string) =>
  Object.values(s?.freight ?? {}).some(
    (f) =>
      ['funded', 'loaded', 'return-required'].includes(f.status) &&
      f.payer.sector === 'collective' &&
      f.payer.id === accountId,
  );
export const freightReservedCommonIncoming = (s: LogisticsState | undefined, accountId: string) =>
  Object.values(s?.freight ?? {}).reduce(
    (n, f) => n + (f.payer.sector === 'collective' && f.payer.id === accountId ? f.escrow : 0),
    0,
  );
