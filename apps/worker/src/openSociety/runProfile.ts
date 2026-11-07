import { createOpenSocietyManifest } from './manifest';

/**
 * Town profiles. After the 2026-11-06 cleanup (specs/OPEN_SOCIETY_CLEANUP_V1.md) there is one
 * current town; historical profiles (society-integrated-v1..v4, society-interdependent-v1..v3)
 * remain on branch pre-cleanup-2026-11-06 together with the towns they created.
 */
export const TOWN_PROFILE = 'town-v1';
/**
 * The same town in an economy where residents need each other: a small public purse that only
 * taxes can refill, an outside market for raw materials only, learning by doing and regrowth.
 */
export const TOWN_INTERDEPENDENT_PROFILE = 'town-interdependent-v1';
const PROFILES = [TOWN_PROFILE, TOWN_INTERDEPENDENT_PROFILE] as const;
export type TownProfile = (typeof PROFILES)[number];
export function isTownProfile(value: unknown): value is TownProfile {
  return PROFILES.some((profile) => profile === value);
}
export const INTERDEPENDENT_ECONOMY = {
  treasury: 3_000,
  outsideMarket: 'raw-materials-only',
} as const;
/** Everything a current town has. Optional features need a reviewed change here, never implicit enabling. */
export const TOWN_FEATURES = {
  cityApps: true,
  life: true,
  continuity: true,
  societyKernel: true,
  collectives: true,
  commonAccounts: true,
  programConditions: true,
  programActions: true,
  enterprisePrograms: true,
  elapsedRest: true,
  elapsedStudy: true,
  elapsedLabor: true,
  productiveEmployment: true,
  educationAuthority: true,
  publicLabor: true,
  physicalProduction: true,
  publicGovernance: true,
  publicEmployment: true,
  housingChoice: true,
  housingOccupancy: true,
  physicalHousingRest: true,
  resourcePrincipals: true,
  premisesPrincipals: true,
  publicHousing: true,
  resourceControl: true,
  groupControl: true,
  materials: true,
  premises: true,
  facilityUse: true,
  premisesRights: true,
  messagePacing: true,
  actionPlans: 'resident-action-plans-v2',
} as const satisfies Parameters<typeof createOpenSocietyManifest>[0];
export function createTownManifest(
  input: {
    readonly profile?: TownProfile;
    readonly count?: number;
    readonly seed?: string;
    readonly simulationId?: string;
    readonly initialization?: 'settled' | 'newcomers';
  } = {},
) {
  const { profile = TOWN_PROFILE, ...seed } = input;
  if (!isTownProfile(profile)) throw Error('invalid-town-profile');
  const manifest = createOpenSocietyManifest({
    ...seed,
    ...TOWN_FEATURES,
    ...(profile === TOWN_INTERDEPENDENT_PROFILE
      ? { materialGrowth: true, economy: INTERDEPENDENT_ECONOMY }
      : {}),
  });
  return { ...manifest, provenance: { ...manifest.provenance, runProfile: profile } };
}
