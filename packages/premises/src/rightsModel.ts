import type {
  Controller,
  ControlAuthorizationPort,
  ResourcePrincipal,
  PrincipalAuthorization,
  PrincipalOperationRequest,
  PrincipalAuthorizationPort,
} from '@aivilization/authority';
import type { PremisesBuilding } from './model';
import type { PremisesProvision } from './provisionModel';

export const PREMISES_USE_SCOPES = ['entry', 'operate', 'store', 'reside'] as const;
export type PremisesUseScope = (typeof PREMISES_USE_SCOPES)[number];
export const PREMISES_RIGHTS_POLICY = {
  version: 'resident-premises-rights-v1',
  maxPermits: 10000,
  maxPermitsPerBuilding: 256,
  maxUsers: 64,
  maxTermsChars: 8000,
  maxOfferHorizonMs: 30 * 86400000,
  maxTermMs: 366 * 86400000,
} as const;
export type PremisesRightsPolicy = {
  readonly version: 'resident-premises-rights-v1';
  readonly maxPermits: number;
  readonly maxPermitsPerBuilding: number;
  readonly maxUsers: number;
  readonly maxTermsChars: number;
  readonly maxOfferHorizonMs: number;
  readonly maxTermMs: number;
};
export type PremisesPermitTerms = {
  readonly id: string;
  readonly buildingId: string;
  readonly issuer: Controller;
  readonly issuerVersion: number;
  readonly grantee: Controller;
  readonly users: readonly string[];
  readonly scopes: readonly PremisesUseScope[];
  readonly mode: 'shared' | 'exclusive';
  readonly title: string;
  readonly terms: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly acceptBy: number;
};
export type PermitSignature = {
  readonly actorId: string;
  readonly at: number;
  readonly decisionId?: string;
};
export const PRINCIPAL_PREMISES_RIGHTS_POLICY = {
  version: 'resident-premises-principal-permits-v2',
} as const;
export type PrincipalPremisesPermitTerms = Omit<PremisesPermitTerms, 'issuer' | 'grantee'> & {
  readonly issuer: ResourcePrincipal;
  readonly grantee: ResourcePrincipal;
  readonly principalVersion: typeof PRINCIPAL_PREMISES_RIGHTS_POLICY.version;
};
export type AnyPremisesPermitTerms = PremisesPermitTerms | PrincipalPremisesPermitTerms;
export type PrincipalPermitProof = PrincipalAuthorization<PrincipalOperationRequest>;
export type PrincipalPermitHistory = {
  readonly offered: PrincipalPermitProof;
  readonly accepted?: PrincipalPermitProof;
  readonly closed?: PrincipalPermitProof;
};
export type PremisesPermit = (
  | PremisesPermitTerms
  | (PrincipalPremisesPermitTerms & {
      readonly principalAuthorization: PrincipalPermitHistory;
    })
) & {
  readonly offered: PermitSignature;
  readonly accepted?: PermitSignature;
  readonly closed?: PermitSignature & { readonly reason: 'withdrawn' | 'released' | 'expired' };
  readonly status: 'offered' | 'accepted' | 'withdrawn' | 'released' | 'expired';
  readonly revision: number;
  readonly at: number;
};
export type PremisesRightsState = {
  readonly policy: PremisesRightsPolicy;
  readonly principalPolicy?: typeof PRINCIPAL_PREMISES_RIGHTS_POLICY;
  readonly permits: Readonly<Record<string, PremisesPermit>>;
  readonly provisions?: Readonly<Record<string, PremisesProvision>>;
};
export type PremisesRightsEvent =
  | { readonly type: 'PremisesRightsEnabled'; readonly policy: PremisesRightsPolicy }
  | {
      readonly type: 'PremisesPermitOffered';
      readonly terms: PremisesPermitTerms;
      readonly signature: PermitSignature;
    }
  | {
      readonly type: 'PremisesPermitAccepted';
      readonly id: string;
      readonly revision: number;
      readonly signature: PermitSignature;
    }
  | {
      readonly type: 'PremisesPermitClosed';
      readonly id: string;
      readonly revision: number;
      readonly signature: PermitSignature;
      readonly reason: 'withdrawn' | 'released' | 'expired';
    };
export type PremisesRightsCommand =
  | {
      readonly type: 'offer';
      readonly terms: Omit<PremisesPermitTerms, 'issuer' | 'issuerVersion'>;
      readonly buildingRevision: number;
    }
  | {
      readonly type: 'accept' | 'withdraw' | 'release';
      readonly id: string;
      readonly revision: number;
    };
export type PremisesRightsPorts = {
  readonly building: (id: string) => PremisesBuilding | undefined;
  readonly exists: (actorId: string) => boolean;
  readonly controllerAvailable: (controller: Controller) => boolean;
  readonly authorize: ControlAuthorizationPort;
  /** Binds collective execution to the exact represented side, never a CLI argument. */
  readonly actingFor?: Controller;
  readonly conflict: (terms: AnyPremisesPermitTerms, at: number) => string | undefined;
  readonly releaseBlocked: (permit: PremisesPermit, at: number) => string | undefined;
};
export type PremisesRightsDecision =
  | { readonly accepted: false; readonly reason: string }
  | { readonly accepted: true; readonly events: readonly PremisesRightsEvent[] };

export function isPrincipalPremisesPermit(
  p: AnyPremisesPermitTerms,
): p is PrincipalPremisesPermitTerms {
  return 'principalVersion' in p;
}
export type PrincipalPremisesRightsCommand =
  | {
      readonly type: 'offer';
      readonly terms: Omit<
        PrincipalPremisesPermitTerms,
        'issuer' | 'issuerVersion' | 'principalVersion'
      >;
      readonly buildingRevision: number;
    }
  | { readonly type: 'accept'; readonly id: string; readonly revision: number }
  | { readonly type: 'release'; readonly id: string; readonly revision: number }
  | {
      readonly type: 'withdraw';
      readonly id: string;
      readonly revision: number;
      readonly side: 'issuer' | 'grantee';
    };
export type PrincipalPermitTradeBinding = {
  readonly orderId: string;
  readonly orderRevision: number;
};
export type PrincipalPremisesRightsEvent =
  | {
      readonly type: 'PrincipalPremisesRightsEnabled';
      readonly policy: typeof PRINCIPAL_PREMISES_RIGHTS_POLICY;
    }
  | {
      readonly type: 'PrincipalPremisesPermitOffered';
      readonly terms: PrincipalPremisesPermitTerms;
      readonly authorization: PrincipalPermitProof;
      readonly at: number;
    }
  | {
      readonly type: 'PrincipalPremisesPermitAccepted';
      readonly id: string;
      readonly revision: number;
      readonly authorization: PrincipalPermitProof;
      readonly at: number;
    }
  | {
      readonly type: 'PrincipalPremisesPermitTradeAccepted';
      readonly id: string;
      readonly revision: number;
      readonly authorization: PrincipalPermitProof;
      readonly binding: PrincipalPermitTradeBinding;
      readonly at: number;
    }
  | {
      readonly type: 'PrincipalPremisesPermitClosed';
      readonly id: string;
      readonly revision: number;
      readonly reason: 'withdrawn' | 'released';
      readonly side: 'issuer' | 'grantee';
      readonly authorization: PrincipalPermitProof;
      readonly at: number;
    };
export type PrincipalPremisesRightsPorts = {
  readonly building: PremisesRightsPorts['building'];
  readonly exists: PremisesRightsPorts['exists'];
  readonly available: (principal: ResourcePrincipal) => boolean;
  readonly authorize: PrincipalAuthorizationPort<PrincipalOperationRequest>;
  readonly conflict: PremisesRightsPorts['conflict'];
  readonly releaseBlocked: PremisesRightsPorts['releaseBlocked'];
};
export type PrincipalPremisesRightsDecision =
  | { readonly accepted: false; readonly reason: string }
  | { readonly accepted: true; readonly events: readonly PrincipalPremisesRightsEvent[] };
