import type { MaterialExtractionState, MaterialExtractionEvent } from './extractionModel';
import type {
  MaterialExpertiseState,
  MaterialGrowthEvent,
  MaterialProductionExpertise,
  MaterialRegrowthState,
} from './growth';
import type {
  MaterialReservationsState,
  MaterialReservationEvent,
  MaterialAllocation,
} from './reservationModel';
import type { Inventory } from '@aivilization/economy';
import {
  assertResourceControlPolicy,
  type ResourceControl,
  type PrincipalControl,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
  type PrincipalAuthorizationPort,
  type ResourcePrincipalPolicy,
  type ResourcePrincipal,
  type PrincipalControlChanged,
  type ResourceControlPolicy,
  type ControlCommand,
  type ControlAuthorizationPort,
  type Controller,
} from '@aivilization/authority';
export type MaterialRecipe = {
  readonly id: string;
  readonly version: string;
  readonly inputs: Inventory;
  readonly outputs: Inventory;
  readonly workMs: number;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly minResidentialTier: number;
};
export type MaterialsPolicy = {
  readonly version: 'resident-materials-v1';
  readonly control: ResourceControlPolicy;
  readonly maxStocksPerController: number;
  readonly maxStocks: number;
  readonly maxJobsPerStock: number;
  readonly maxJobs: number;
  readonly maxKinds: number;
  readonly maxQuantity: number;
  readonly maxBatch: number;
  readonly maxWorkers: number;
  readonly maxShiftMs: number;
  readonly settlementIntervalMs: number;
  readonly recipes: readonly MaterialRecipe[];
};
export type MaterialStock = {
  readonly id: string;
  readonly ownerId: string;
  readonly control: ResourceControl | PrincipalControl;
  readonly title: string;
  readonly locationId: string;
  readonly contributors: readonly string[];
  readonly readers: readonly string[];
  readonly inventory: Inventory;
  readonly status: 'open' | 'settling' | 'closed';
  readonly revision: number;
  readonly at: number;
};
export type ProductionSession = {
  readonly actorId: string;
  readonly startedAt: number;
  readonly until: number;
  readonly settledAt: number;
  readonly workedMs: number;
};
export type ProductionEndReason =
  | 'completed'
  | 'shift-ended'
  | 'left'
  | 'cancelled'
  | 'worker-unavailable'
  | 'reservation-mismatch'
  | 'effort-exhausted'
  | 'facility-unavailable'
  | 'source-expired';
export type MaterialProduction = {
  /** Present only when learning by doing shortened this batch's recipe snapshot. */
  readonly expertise?: MaterialProductionExpertise;
  readonly sourceId?: string;
  readonly sourceExpiresAt?: number;
  readonly lastStop?: {
    readonly actorId: string;
    readonly at: number;
    readonly reason: ProductionEndReason;
  };
  readonly id: string;
  readonly stockId: string;
  readonly createdBy: string;
  readonly decisionId?: string;
  readonly productName: string;
  readonly description: string;
  readonly recipe: MaterialRecipe;
  readonly quantity: number;
  readonly workers: readonly string[];
  readonly completed: number;
  readonly progressMs: number;
  readonly held: Inventory;
  readonly session?: ProductionSession;
  readonly status: 'open' | 'completed' | 'cancelled';
  readonly revision: number;
  readonly at: number;
};
export type MaterialEndpoint = {
  readonly kind: 'resident' | 'stock' | 'production' | 'reservation' | 'source';
  readonly id: string;
};
export type MaterialTransfer = {
  readonly from: MaterialEndpoint;
  readonly to: MaterialEndpoint;
  readonly items: Inventory;
};
export type MaterialConversion = {
  readonly productionId: string;
  readonly recipeVersion: string;
  readonly units: number;
  readonly consumed: Inventory;
  readonly produced: Inventory;
};
export type MaterialEffort = {
  readonly actorId: string;
  readonly productionId: string;
  readonly from: number;
  readonly through: number;
  readonly workMs: number;
  readonly energyCost: number;
  readonly satietyCost: number;
};
export type MaterialReceipt = {
  readonly reservationId?: string;
  readonly principalAuthorization?: PrincipalAuthorization<PrincipalOperationRequest>;
  readonly allocations?: readonly MaterialAllocation[];
  readonly endReason?: ProductionEndReason;
  readonly id: string;
  readonly actorId: string;
  readonly at: number;
  readonly operation: string;
  readonly stockId: string;
  readonly productionId?: string;
  readonly decisionId?: string;
  readonly transfers: readonly MaterialTransfer[];
  readonly conversions: readonly MaterialConversion[];
  readonly efforts: readonly MaterialEffort[];
};
export type MaterialsState = {
  readonly expertise?: MaterialExpertiseState;
  readonly regrowth?: MaterialRegrowthState;
  readonly resourcePrincipals?: ResourcePrincipalPolicy;
  readonly extraction?: MaterialExtractionState;
  readonly reservations?: MaterialReservationsState;
  readonly policy: MaterialsPolicy;
  readonly stocks: Readonly<Record<string, MaterialStock>>;
  readonly productions: Readonly<Record<string, MaterialProduction>>;
  readonly receipts: Readonly<Record<string, MaterialReceipt>>;
};
export type MaterialEvent =
  | { readonly type: 'MaterialResourcePrincipalsEnabled'; readonly policy: ResourcePrincipalPolicy }
  | { readonly type: 'MaterialPrincipalControlChanged'; readonly change: PrincipalControlChanged }
  | MaterialExtractionEvent
  | MaterialGrowthEvent
  | MaterialReservationEvent
  | { readonly type: 'MaterialsEnabled'; readonly policy: MaterialsPolicy }
  | { readonly type: 'MaterialStockChanged'; readonly stock: MaterialStock }
  | { readonly type: 'MaterialProductionChanged'; readonly production: MaterialProduction }
  | { readonly type: 'MaterialReceiptRecorded'; readonly receipt: MaterialReceipt };
export type MaterialCommand =
  | {
      readonly type: 'create-stock';
      readonly id: string;
      readonly title: string;
      readonly locationId: string;
    }
  | {
      readonly type: 'deposit';
      readonly id: string;
      readonly expectedRevision: number;
      readonly items: Inventory;
    }
  | {
      readonly type: 'withdraw';
      readonly id: string;
      readonly expectedRevision: number;
      readonly items: Inventory;
      readonly recipientId: string;
    }
  | {
      readonly type: 'configure-stock';
      readonly id: string;
      readonly expectedRevision: number;
      readonly contributors: readonly string[];
      readonly readers: readonly string[];
    }
  | {
      readonly type: 'settle-stock' | 'close-stock';
      readonly id: string;
      readonly expectedRevision: number;
    }
  | {
      readonly type: 'control-stock';
      readonly id: string;
      readonly expectedRevision: number;
      readonly control: ControlCommand;
    }
  | {
      readonly type: 'create-production';
      readonly id: string;
      readonly stockId: string;
      readonly expectedRevision: number;
      readonly recipeId: string;
      readonly quantity: number;
      readonly productName: string;
      readonly description: string;
      readonly workers: readonly string[];
    }
  | {
      readonly type: 'create-extraction';
      readonly id: string;
      readonly stockId: string;
      readonly expectedRevision: number;
      readonly sourceId: string;
      readonly sourceRevision: number;
      readonly quantity: number;
      readonly productName: string;
      readonly description: string;
      readonly workers: readonly string[];
    }
  | {
      readonly type: 'start-production';
      readonly id: string;
      readonly expectedRevision: number;
      readonly until: number;
    }
  | {
      readonly type: 'leave-production';
      readonly id: string;
      readonly expectedRevision: number;
    }
  | { readonly type: 'cancel-production'; readonly id: string; readonly expectedRevision: number };
export function isProductionCommand(c: MaterialCommand): c is Extract<
  MaterialCommand,
  {
    type:
      | 'create-production'
      | 'create-extraction'
      | 'start-production'
      | 'leave-production'
      | 'cancel-production';
  }
> {
  return (
    c.type === 'create-production' ||
    c.type === 'create-extraction' ||
    c.type === 'start-production' ||
    c.type === 'leave-production' ||
    c.type === 'cancel-production'
  );
}
export type MaterialPorts = {
  readonly principalAvailable?: (principal: ResourcePrincipal) => boolean;
  readonly authorizePrincipal?: PrincipalAuthorizationPort<PrincipalOperationRequest>;
  /** Actual physical allowance supplied by the owning body domain, never a resident parameter. */
  readonly settledWorkMs?: (production: MaterialProduction, elapsedMs: number) => number;
  readonly physicalWorkEndedAt?: (production: MaterialProduction) => number | undefined;
  readonly mayWorkAt?: (actorId: string, locationId: string) => boolean;
  readonly exists: (actorId: string) => boolean;
  readonly present: (actorId: string, locationId: string) => boolean;
  readonly idle: (actorId: string) => boolean;
  readonly mayStoreAt: (actorId: string, locationId: string) => boolean;
  readonly inventory: (actorId: string) => Inventory;
  readonly body: (
    actorId: string,
  ) => { energy: number; satiety: number; residentialTier: number; capable: boolean } | undefined;
  readonly controlAvailable: (controller: Controller) => boolean;
  readonly authorize: ControlAuthorizationPort;
  readonly hasExternalObligation: (stockId: string) => boolean;
  readonly sessionReserved: (production: MaterialProduction) => boolean;
  readonly locationStorageCapacity?: (locationId: string) => number | undefined;
  readonly workstationAvailable?: (
    productionId: string,
    actorId: string,
    locationId: string,
  ) => boolean;
};
export type MaterialDecision =
  | {
      readonly accepted: true;
      readonly events: readonly MaterialEvent[];
      readonly reservation?: {
        readonly actorId: string;
        readonly locationId: string;
        readonly until: number;
      };
      readonly release?: ProductionSession;
    }
  | { readonly accepted: false; readonly reason: string };
export const materialId = (v: string) =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v) && !Object.hasOwn(Object.prototype, v);
export const quantity = (n: number) => Number.isFinite(n) && n > 0;
export const validInventory = (
  v: Inventory,
  maxKinds: number,
  maxQuantity: number,
  allowEmpty = false,
) => {
  const entries = Object.entries(v);
  return (
    (allowEmpty || entries.length > 0) &&
    entries.length <= maxKinds &&
    entries.every(
      ([k, n]) =>
        k.trim().length > 0 &&
        k.length <= 128 &&
        !Object.hasOwn(Object.prototype, k) &&
        quantity(n) &&
        n <= maxQuantity,
    )
  );
};
export function assertMaterialsPolicy(p: MaterialsPolicy) {
  assertResourceControlPolicy(p.control);
  if (
    p.version !== 'resident-materials-v1' ||
    ![
      p.maxStocksPerController,
      p.maxStocks,
      p.maxJobsPerStock,
      p.maxJobs,
      p.maxKinds,
      p.maxQuantity,
      p.maxBatch,
      p.maxWorkers,
      p.maxShiftMs,
      p.settlementIntervalMs,
    ].every((n) => Number.isSafeInteger(n) && n > 0) ||
    !p.recipes.length ||
    p.recipes.length > 1000 ||
    new Set(p.recipes.map((r) => r.id)).size !== p.recipes.length ||
    p.recipes.some(
      (r) =>
        !materialId(r.id) ||
        !r.version.trim() ||
        !validInventory(r.inputs, p.maxKinds, p.maxQuantity) ||
        !validInventory(r.outputs, p.maxKinds, p.maxQuantity) ||
        !Number.isSafeInteger(r.workMs) ||
        r.workMs < 1 ||
        ![r.energyCost, r.satietyCost].every((n) => Number.isFinite(n) && n >= 0) ||
        !Number.isSafeInteger(r.minResidentialTier) ||
        r.minResidentialTier < 1,
    )
  )
    throw new Error('invalid-materials-policy');
}
export function emptyMaterialsState(policy: MaterialsPolicy): MaterialsState {
  assertMaterialsPolicy(policy);
  return { policy, stocks: {}, productions: {}, receipts: {} };
}
export const no = (reason: string): MaterialDecision => ({ accepted: false, reason });
