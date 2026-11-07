import type {
  PrincipalAuthorization,
  PrincipalOperationRequest,
  ResourcePrincipal,
} from '@aivilization/authority';
import type { Service, ServicesCommand } from './model';

export const SERVICE_DIRECTORY_ID = 'resident-services';
export const SERVICE_SUPPLY_POLICY = {
  version: 'resident-service-supply-v3',
  maxRegisteredServices: 10000,
} as const;
export type ServiceSupplyPolicy = typeof SERVICE_SUPPLY_POLICY;
export type ServiceDirectoryRegistration = {
  readonly policy: ServiceSupplyPolicy;
  readonly revision: number;
};
export type PrincipalServiceCreation = {
  readonly principal: ResourcePrincipal;
  readonly enterpriseSupply?: true;
  readonly command: Omit<Extract<ServicesCommand, { type: 'publish' }>, 'enterpriseId'>;
};
export type ServiceSupplyEvent =
  | { readonly type: 'ServiceSupplyEnabled'; readonly policy: ServiceSupplyPolicy }
  | {
      readonly type: 'PrincipalServiceCreated';
      readonly previousDirectoryRevision: number;
      readonly at: number;
      readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
      readonly service: Service;
      readonly capacityProof: {
        readonly locationId: string;
        readonly capacity: number;
        readonly destinationCapacity?: number;
      };
    }
  | {
      readonly type: 'PrincipalServiceReopened';
      readonly previousRevision: number;
      readonly at: number;
      readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
      readonly service: Service;
      readonly capacityProof: { readonly locationId: string; readonly capacity: number };
    };
