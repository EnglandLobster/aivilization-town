import { createOpenSocietyManifest } from './manifest';

export const INTEGRATED_SOCIETY_PROFILE = 'society-integrated-v1';
export const INTEGRATED_SOCIETY_PROFILE_V2 = 'society-integrated-v2';
/**
 * integrated-v2 plus an economy where residents need each other: a small public purse that only
 * taxes can refill, an outside market for raw materials only, learning by doing, and regrowth.
 */
export const INTERDEPENDENT_SOCIETY_PROFILE = 'society-interdependent-v1';
/** integrated-v2 plus paced direct-message wakes (resident-message-pacing-v1). */
export const INTEGRATED_SOCIETY_PROFILE_V3 = 'society-integrated-v3';
/** interdependent-v1 plus paced direct-message wakes; the comparison arm for integrated-v3. */
export const INTERDEPENDENT_SOCIETY_PROFILE_V2 = 'society-interdependent-v2';
/** integrated-v3 plus resident action plans (resident-action-plans-v1). */
export const INTEGRATED_SOCIETY_PROFILE_V4 = 'society-integrated-v4';
/** interdependent-v2 plus resident action plans; the comparison arm for integrated-v4. */
export const INTERDEPENDENT_SOCIETY_PROFILE_V3 = 'society-interdependent-v3';
interface ProfileOptions {
  readonly constructionTrade?: true;
  /** Small tax-funded treasury, raw-materials-only outside market, learning by doing, regrowth. */
  readonly interdependent?: true;
  readonly messagePacing?: true;
  readonly actionPlans?: true;
}
/** What each released profile adds to INTEGRATED_SOCIETY_FEATURES. Released rows never change. */
const PROFILE_OPTIONS = {
  [INTEGRATED_SOCIETY_PROFILE]: {},
  [INTEGRATED_SOCIETY_PROFILE_V2]: { constructionTrade: true },
  [INTEGRATED_SOCIETY_PROFILE_V3]: { constructionTrade: true, messagePacing: true },
  [INTEGRATED_SOCIETY_PROFILE_V4]: {
    constructionTrade: true,
    messagePacing: true,
    actionPlans: true,
  },
  [INTERDEPENDENT_SOCIETY_PROFILE]: { constructionTrade: true, interdependent: true },
  [INTERDEPENDENT_SOCIETY_PROFILE_V2]: {
    constructionTrade: true,
    interdependent: true,
    messagePacing: true,
  },
  [INTERDEPENDENT_SOCIETY_PROFILE_V3]: {
    constructionTrade: true,
    interdependent: true,
    messagePacing: true,
    actionPlans: true,
  },
} as const satisfies Record<string, ProfileOptions>;
export type IntegratedSocietyProfile = keyof typeof PROFILE_OPTIONS;
export function isIntegratedSocietyProfile(value: unknown): value is IntegratedSocietyProfile {
  return typeof value === 'string' && Object.hasOwn(PROFILE_OPTIONS, value);
}
export const INTERDEPENDENT_ECONOMY = {
  treasury: 3_000,
  outsideMarket: 'raw-materials-only',
} as const;
/** Explicit release list. New optional features require a reviewed profile revision, never automatic enabling. */
export const INTEGRATED_SOCIETY_FEATURES = {
  cityApps: true,
  distribution: true,
  life: true,
  continuity: true,
  mobility: true,
  societyKernel: true,
  recordViews: true,
  collectives: true,
  commonAccounts: true,
  programConditions: true,
  programReactions: true,
  programActions: true,
  enterprisePrograms: true,
  serviceControl: true,
  elapsedRest: true,
  elapsedStudy: true,
  elapsedLabor: true,
  productiveEmployment: true,
  educationAuthority: true,
  serviceTime: true,
  publicLabor: true,
  serviceEmployment: true,
  physicalProduction: true,
  publicGovernance: true,
  publicEmployment: true,
  capitalAgreements: true,
  housingChoice: true,
  housingOccupancy: true,
  physicalHousingRest: true,
  resourcePrincipals: true,
  premisesPrincipals: true,
  servicePrincipals: true,
  serviceSupply: true,
  serviceAffiliations: true,
  serviceSupplyRelations: true,
  vehiclePrincipals: true,
  principalPermits: true,
  resourceSales: true,
  resourceSalesV2: true,
  periodicObligations: true,
  principalTrade: true,
  publicHousing: true,
  publicProcurement: true,
  publicGoodsProcurement: true,
  resourceControl: true,
  groupControl: true,
  materials: true,
  premises: true,
  facilityUse: true,
  serviceEngagements: true,
  logistics: true,
  evidenceTrade: true,
  premisesRights: true,
  paidPermits: true,
} as const satisfies Parameters<typeof createOpenSocietyManifest>[0];
export function createIntegratedSocietyManifest(
  input: {
    readonly profile?: IntegratedSocietyProfile;
    readonly count?: number;
    readonly seed?: string;
    readonly simulationId?: string;
    readonly initialization?: 'settled' | 'newcomers';
  } = {},
) {
  const { profile = INTEGRATED_SOCIETY_PROFILE, ...seed } = input;
  if (!isIntegratedSocietyProfile(profile)) throw Error('invalid-integrated-society-profile');
  const { interdependent, ...options }: ProfileOptions = PROFILE_OPTIONS[profile];
  const manifest = createOpenSocietyManifest({
    ...seed,
    ...INTEGRATED_SOCIETY_FEATURES,
    ...options,
    ...(interdependent ? { materialGrowth: true, economy: INTERDEPENDENT_ECONOMY } : {}),
  });
  return {
    ...manifest,
    provenance: { ...manifest.provenance, runProfile: profile },
  };
}
