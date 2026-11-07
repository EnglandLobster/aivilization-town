import type { PrincipalControlChanged } from '@aivilization/authority';
import type {
  ResourceControl,
  PrincipalControl,
  ResourcePrincipal,
  PrincipalAuthorization,
  PrincipalOperationRequest,
  PrincipalAuthorizationPort,
  ResourceControlPolicy,
  Controller,
  ControlAuthorizationPort,
} from '@aivilization/authority';
import type { Inventory } from '@aivilization/economy';
import type { PremisesFacilityUsePolicy, ServiceFacilityEndowment } from './facilities';
import type {
  MaterialReservation,
  ProductionSession,
  ProductionEndReason,
  MaterialAllocation,
} from '@aivilization/materials';
export type PremisesUse =
  | 'residence'
  | 'production'
  | 'social'
  | 'education'
  | 'healthcare'
  | 'market'
  | 'food';
export const FIXTURE_KINDS = [
  'workstations',
  'careStations',
  'teachingStations',
  'storageUnits',
] as const;
export type FixtureKind = (typeof FIXTURE_KINDS)[number];
export type PremisesBlueprint = {
  readonly primaryUse: PremisesUse;
  readonly floorArea: number;
  readonly capacity: number;
  readonly fixtures: Readonly<Record<FixtureKind, number>>;
};
export type PremisesPolicy = {
  readonly version: 'resident-premises-v1';
  readonly control: ResourceControlPolicy;
  readonly maxSites: number;
  readonly maxBuildings: number;
  readonly maxProjects: number;
  readonly maxProjectsPerController: number;
  readonly maxFloorArea: number;
  readonly maxWorkers: number;
  readonly maxReservations: number;
  readonly maxShiftMs: number;
  readonly settlementIntervalMs: number;
  readonly areaPerOccupant: number;
  readonly maxStoragePerArea: number;
  readonly baseMaterialsPerArea: Inventory;
  readonly fixtureMaterials: Readonly<Record<FixtureKind, Inventory>>;
  readonly workMsPerArea: number;
  readonly fixtureWorkMs: Readonly<Record<FixtureKind, number>>;
  readonly energyPerWorkHour: number;
  readonly satietyPerWorkHour: number;
  readonly maintenanceFraction: number;
  readonly refitFraction: number;
  readonly demolitionWorkFraction: number;
  readonly salvageFraction: number;
  readonly wearIntervalMs: number;
  readonly wearPerInterval: number;
};
/** An explicitly seeded institution, separate from geometry and construction physics. */
export type PublicLandUsePolicy = {
  readonly version: 'public-construction-use-v1';
  readonly revision: number;
  readonly mode: 'open-with-funded-project' | 'authorization-required';
  readonly maxActiveProjectsPerController: number;
  readonly provenance: string;
};
export type ConstructionSite = {
  readonly id: string;
  readonly parentLocationId: string;
  readonly usableFloorArea: number;
  readonly occupiedFloorArea: number;
  readonly reservedFloorArea: number;
  readonly accessTravelMs: number;
  readonly revision: number;
  readonly source: 'scenario-seed' | 'authorized-extension';
  readonly sourceId: string;
};
export type PremisesAccess = {
  readonly entry: 'public' | 'listed';
  readonly visitors: readonly string[];
  readonly operators: readonly string[];
  readonly residents: readonly string[];
};
export type PremisesBuilding = {
  readonly id: string;
  readonly siteId: string;
  readonly locationId: string;
  readonly ownerId: string;
  readonly control: ResourceControl | PrincipalControl;
  readonly title: string;
  readonly blueprint: PremisesBlueprint;
  readonly condition: number;
  readonly status: 'operational' | 'closed' | 'demolished';
  readonly access: PremisesAccess;
  readonly embodied: Inventory;
  /** Physical demolition remains, still controlled and awaiting collection at the site. */
  readonly salvage: Inventory;
  readonly footprintReleased: boolean;
  readonly wearSettledAt: number;
  readonly revision: number;
  readonly at: number;
};
export type ConstructionPlan = {
  readonly modelVersion: 'resident-premises-v1';
  readonly blueprint: PremisesBlueprint;
  readonly materials: Inventory;
  readonly workMs: number;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly addedFloorArea: number;
  readonly repairPoints: number;
};
export type ConstructionProject = {
  readonly principalAuthorization?: PrincipalAuthorization<PrincipalOperationRequest>;
  readonly id: string;
  readonly kind: 'build' | 'modify' | 'maintain' | 'demolish';
  readonly buildingId: string;
  readonly workLocationId: string;
  readonly siteId: string;
  readonly controller: ResourcePrincipal;
  readonly createdBy: string;
  readonly decisionId?: string;
  readonly title: string;
  readonly description: string;
  readonly plan: ConstructionPlan;
  readonly workers: readonly string[];
  readonly reservations: readonly {
    readonly id: string;
    readonly sourceStockId: string;
    readonly committedRevision: number;
    readonly materials: Inventory;
  }[];
  readonly landUse: {
    readonly policyVersion: string;
    readonly revision: number;
    readonly authorityId: string;
  };
  readonly progressMs: number;
  readonly session?: ProductionSession;
  readonly lastStop?: {
    readonly actorId: string;
    readonly at: number;
    readonly reason: ProductionEndReason;
  };
  readonly status: 'open' | 'completed' | 'cancelled';
  readonly settlementBlock?: { readonly reason: string; readonly at: number };
  readonly revision: number;
  readonly at: number;
};
export type PremisesState = {
  readonly resourcePrincipals?: { readonly version: 'premises-resource-principals-v2' };
  readonly principalReceipts?: Readonly<Record<string, PremisesPrincipalReceipt>>;
  readonly serviceFacilityEndowments?: Readonly<Record<string, ServiceFacilityEndowment>>;
  readonly facilityUsePolicy?: PremisesFacilityUsePolicy;
  readonly policy: PremisesPolicy;
  readonly landUsePolicy: PublicLandUsePolicy;
  readonly sites: Readonly<Record<string, ConstructionSite>>;
  readonly buildings: Readonly<Record<string, PremisesBuilding>>;
  readonly projects: Readonly<Record<string, ConstructionProject>>;
};
export type PremisesPrincipalReceipt = {
  readonly id: string;
  readonly at: number;
  readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
};
export type PremisesEvent =
  | {
      readonly type: 'PremisesResourcePrincipalsEnabled';
      readonly policy: { readonly version: 'premises-resource-principals-v2' };
    }
  | {
      readonly type: 'PremisesPrincipalOperationRecorded';
      readonly receipt: PremisesPrincipalReceipt;
    }
  | { readonly type: 'ServiceFacilityEndowed'; readonly endowment: ServiceFacilityEndowment }
  | { readonly type: 'PremisesFacilityUseEnabled'; readonly policy: PremisesFacilityUsePolicy }
  | {
      readonly type: 'PremisesEnabled';
      readonly policy: PremisesPolicy;
      readonly landUsePolicy: PublicLandUsePolicy;
    }
  | { readonly type: 'ConstructionSiteRegistered'; readonly site: ConstructionSite }
  | { readonly type: 'ConstructionSiteChanged'; readonly site: ConstructionSite }
  | { readonly type: 'PremisesPrincipalControlChanged'; readonly change: PrincipalControlChanged }
  | { readonly type: 'PremisesBuildingChanged'; readonly building: PremisesBuilding }
  | { readonly type: 'ConstructionProjectChanged'; readonly project: ConstructionProject }
  | {
      readonly type: 'ConstructionResourcesAllocated';
      readonly evidenceId: string;
      readonly projectId: string;
      readonly allocations: readonly MaterialAllocation[];
    }
  | {
      readonly type: 'PremisesDemolished';
      readonly buildingId: string;
      readonly projectId: string;
      readonly consumed: Inventory;
      readonly recovered: Inventory;
      readonly waste: Inventory;
    }
  | {
      readonly type: 'PremisesSalvageCollected';
      readonly buildingId: string;
      readonly actorId: string;
      readonly items: Inventory;
      readonly at: number;
      readonly decisionId?: string;
    };
export type PremisesPorts = {
  readonly authorizePrincipal?: PrincipalAuthorizationPort<PrincipalOperationRequest>;
  readonly principalAvailable?: (principal: ResourcePrincipal) => boolean;
  readonly exists: (actor: string) => boolean;
  readonly present: (actor: string, parentLocation: string) => boolean;
  readonly idle: (actor: string) => boolean;
  readonly body: (
    actor: string,
  ) => { readonly energy: number; readonly satiety: number; readonly capable: boolean } | undefined;
  readonly reservation: (id: string) => MaterialReservation | undefined;
  readonly stockLocation: (stockId: string) => string | undefined;
  readonly authorize: ControlAuthorizationPort;
  readonly controlAvailable: (controller: Controller) => boolean;
  readonly siteGrant: (
    siteId: string,
    controller: ResourcePrincipal,
    projectId: string,
    floorArea: number,
  ) =>
    | { readonly authorityId: string; readonly policyVersion: string; readonly revision: number }
    | undefined;
  readonly occupiedOrReserved: (buildingId: string) => number;
  readonly hasObligations: (buildingId: string) => boolean;
  readonly sessionReserved: (project: ConstructionProject) => boolean;
};
