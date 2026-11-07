import type {
  ResourcePrincipal,
  PrincipalAuthorization,
  PrincipalOperationRequest,
  PrincipalAuthorizationPort,
  PrincipalControlOffer,
} from '@aivilization/authority';
import { economicAccount } from '@aivilization/economy';
import type { AccountingTransaction } from '@aivilization/economy';
import type { PrincipalTradeAccount } from './principalTradeModel';

export const RESOURCE_SALES_POLICY = {
  version: 'resident-resource-sales-v1',
  resourceKinds: ['premises'],
  maxSales: 10000,
  maxPerSeller: 500,
  maxAmount: 1000000,
  maxTermsChars: 8000,
  maxWindowMs: 30 * 86400000,
  moneyScale: 1000000,
} as const;
export const RESOURCE_SALES_POLICY_V2 = {
  ...RESOURCE_SALES_POLICY,
  version: 'resident-resource-sales-v2',
  resourceKinds: ['premises', 'stock', 'vehicle'],
} as const;
export type ResourceSalesPolicy = typeof RESOURCE_SALES_POLICY | typeof RESOURCE_SALES_POLICY_V2;
export type ResourceSaleKind = 'premises' | 'stock' | 'vehicle';
/** Synchronous clearing only: every accepted packet begins and ends with zero cash here. */
export const RESOURCE_SALES_CLEARING = economicAccount('public-service', 'resident-resource-sales');
/** Owning resource source, never accepted from a resident command. No copy of mutable physical state is maintained. */
export type ResourceSaleCommonSource = {
  readonly id: string;
  readonly revision: number;
  readonly controlVersion: number;
  readonly seller: ResourcePrincipal;
  readonly offer: PrincipalControlOffer;
  readonly authorId: string;
  readonly locationId: string;
  readonly encumbrances: readonly {
    readonly kind: string;
    readonly id: string;
    readonly revision: number;
  }[];
};
export type PremisesResourceSaleSource = ResourceSaleCommonSource & {
  readonly version: 'premises-sale-source-v1';
  readonly kind: 'premises';
  readonly blueprint: {
    readonly primaryUse: string;
    readonly floorArea: number;
    readonly capacity: number;
    readonly fixtures: Readonly<Record<string, number>>;
  };
  readonly condition: number;
  readonly buildingStatus: 'operational' | 'closed' | 'demolished';
  readonly openProjects: readonly { readonly id: string; readonly revision: number }[];
};
export type StockResourceSaleSource = ResourceSaleCommonSource & {
  readonly version: 'stock-sale-source-v1';
  readonly kind: 'stock';
  readonly stockStatus: 'open' | 'settling' | 'closed';
  readonly inventory: Readonly<Record<string, number>>;
  readonly contributors: readonly string[];
  readonly readers: readonly string[];
};
export type VehicleResourceSaleSource = ResourceSaleCommonSource & {
  readonly version: 'vehicle-sale-source-v1';
  readonly kind: 'vehicle';
  readonly seats: number;
  readonly authorized: readonly string[];
  readonly cargoCapacity: {
    readonly version: 'vehicle-cargo-capacity-v1';
    readonly units: number;
    readonly source: 'scenario-seed' | 'authorized-extension';
    readonly sourceId: string;
  } | null;
  readonly busy: boolean;
};
export type ResourceSaleSource =
  | PremisesResourceSaleSource
  | StockResourceSaleSource
  | VehicleResourceSaleSource;
export type ResourceSaleTerms = {
  readonly id: string;
  readonly title: string;
  readonly terms: string;
  readonly source: ResourceSaleSource;
  readonly payer: PrincipalTradeAccount;
  readonly revenue: PrincipalTradeAccount;
  readonly amount: number;
  readonly acceptBy: number;
};
export type ResourceSale = ResourceSaleTerms & {
  readonly revision: number;
  readonly createdAt: number;
  readonly at: number;
  readonly status: 'offered' | 'settled' | 'withdrawn' | 'declined' | 'expired';
  readonly offeredAuthorization: PrincipalAuthorization<PrincipalOperationRequest>;
  readonly acceptedAuthorization?: PrincipalAuthorization<PrincipalOperationRequest>;
  readonly paidMicros: number;
};
export type ResourceSalesState = {
  readonly policy: ResourceSalesPolicy;
  readonly sales: Readonly<Record<string, ResourceSale>>;
};
export type ResourceSaleCommand =
  | {
      readonly type: 'offer';
      readonly id: string;
      readonly title: string;
      readonly terms: string;
      readonly resource: {
        readonly kind: ResourceSaleKind;
        readonly id: string;
        readonly expectedRevision: number;
      };
      readonly payer: PrincipalTradeAccount;
      readonly revenue: PrincipalTradeAccount;
      readonly amount: number;
      readonly acceptBy: number;
    }
  | {
      readonly type: 'accept' | 'withdraw' | 'decline';
      readonly id: string;
      readonly expectedRevision: number;
    };
export type ResourceSaleEvent =
  | { readonly type: 'ResourceSalesEnabled'; readonly policy: typeof RESOURCE_SALES_POLICY }
  | {
      readonly type: 'ResourceSalesPolicyExtended';
      readonly previousPolicyVersion: typeof RESOURCE_SALES_POLICY.version;
      readonly policy: typeof RESOURCE_SALES_POLICY_V2;
    }
  | {
      readonly type: 'ResourceSaleCommitted';
      readonly previousRevision: number;
      readonly sale: ResourceSale;
      readonly actorId: string;
      readonly operation: ResourceSaleCommand['type'] | 'expire';
      readonly command?: ResourceSaleCommand;
      readonly sourceRead?: ResourceSaleSource;
      readonly authorization?: PrincipalAuthorization<PrincipalOperationRequest>;
      readonly transactions: readonly AccountingTransaction[];
    };
export type ResourceSalePorts = {
  readonly exists: (actorId: string) => boolean;
  readonly available: (principal: ResourcePrincipal) => boolean;
  readonly source: (kind: ResourceSaleKind, id: string) => ResourceSaleSource | undefined;
  readonly account: (account: PrincipalTradeAccount) =>
    | {
        readonly principal: ResourcePrincipal;
        readonly balance: number;
        readonly status: 'open' | 'settling';
        /** Maximum immediately safe balance after other domains' reserved receipts/refunds. */
        readonly maximumBalance: number;
      }
    | undefined;
  readonly authorize: PrincipalAuthorizationPort<PrincipalOperationRequest>;
};
export type ResourceSaleDecision =
  | { readonly accepted: false; readonly reason: string }
  | { readonly accepted: true; readonly events: readonly ResourceSaleEvent[] };
