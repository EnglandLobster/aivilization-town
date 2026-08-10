export type WageType = 'static' | 'dynamic';

export type JobTierConfig = {
  readonly tier: number;
  readonly tierName: string;
  readonly minResidentialTier: number;
  readonly minEducationScore: number;
  readonly prerequisiteCommodity: string | null;
  readonly wageType: WageType;
  readonly source: string;
};

export type OccupationConfig = {
  readonly name: string;
  readonly jobTier: number;
  readonly minResidentialTier: number;
  readonly educationFloor: number;
  readonly eligibilityShare: number;
  readonly baseWage: number;
  readonly source: string;
};

const jobTierSource = 'AIvilization v0 Appendix B Table 10';
const occupationSource = 'AIvilization v0 Appendix B Table 11';

export const jobTiers = [
  {
    tier: 1,
    tierName: 'Entry',
    minResidentialTier: 1,
    minEducationScore: 0,
    prerequisiteCommodity: null,
    wageType: 'static',
    source: jobTierSource,
  },
  {
    tier: 2,
    tierName: 'Skilled',
    minResidentialTier: 2,
    minEducationScore: 20,
    prerequisiteCommodity: 'Beef',
    wageType: 'static',
    source: jobTierSource,
  },
  {
    tier: 3,
    tierName: 'Backbone',
    minResidentialTier: 3,
    minEducationScore: 70,
    prerequisiteCommodity: 'Sushi',
    wageType: 'static',
    source: jobTierSource,
  },
  {
    tier: 4,
    tierName: 'Expert',
    minResidentialTier: 4,
    minEducationScore: 110,
    prerequisiteCommodity: 'Pure Silicon',
    wageType: 'dynamic',
    source: jobTierSource,
  },
  {
    tier: 5,
    tierName: 'Management',
    minResidentialTier: 5,
    minEducationScore: 180,
    prerequisiteCommodity: 'Transistor',
    wageType: 'dynamic',
    source: jobTierSource,
  },
  {
    tier: 6,
    tierName: 'Leadership',
    minResidentialTier: 6,
    minEducationScore: 320,
    prerequisiteCommodity: 'Circuit Board',
    wageType: 'dynamic',
    source: jobTierSource,
  },
] as const satisfies readonly JobTierConfig[];

export const occupations = [
  {
    name: 'Cleaner',
    jobTier: 1,
    minResidentialTier: 1,
    educationFloor: 0,
    eligibilityShare: 1.0,
    baseWage: 250,
    source: occupationSource,
  },
  {
    name: 'Waiter',
    jobTier: 1,
    minResidentialTier: 1,
    educationFloor: 13,
    eligibilityShare: 0.9,
    baseWage: 253,
    source: occupationSource,
  },
  {
    name: 'Stock Clerk',
    jobTier: 2,
    minResidentialTier: 2,
    educationFloor: 0,
    eligibilityShare: 0.832,
    baseWage: 260,
    source: occupationSource,
  },
  {
    name: 'Security Guard',
    jobTier: 2,
    minResidentialTier: 2,
    educationFloor: 42,
    eligibilityShare: 0.728,
    baseWage: 270,
    source: occupationSource,
  },
  {
    name: 'Receptionist',
    jobTier: 2,
    minResidentialTier: 2,
    educationFloor: 62,
    eligibilityShare: 0.624,
    baseWage: 275,
    source: occupationSource,
  },
  {
    name: 'Cashier',
    jobTier: 3,
    minResidentialTier: 3,
    educationFloor: 78,
    eligibilityShare: 0.56,
    baseWage: 301,
    source: occupationSource,
  },
  {
    name: 'Maintenance Worker',
    jobTier: 3,
    minResidentialTier: 3,
    educationFloor: 104,
    eligibilityShare: 0.476,
    baseWage: 309,
    source: occupationSource,
  },
  {
    name: 'Chef',
    jobTier: 4,
    minResidentialTier: 4,
    educationFloor: 113,
    eligibilityShare: 0.448,
    baseWage: 356,
    source: occupationSource,
  },
  {
    name: 'Nurse',
    jobTier: 4,
    minResidentialTier: 4,
    educationFloor: 141,
    eligibilityShare: 0.384,
    baseWage: 366,
    source: occupationSource,
  },
  {
    name: 'Teacher',
    jobTier: 4,
    minResidentialTier: 4,
    educationFloor: 176,
    eligibilityShare: 0.32,
    baseWage: 380,
    source: occupationSource,
  },
  {
    name: 'Doctor',
    jobTier: 5,
    minResidentialTier: 5,
    educationFloor: 207,
    eligibilityShare: 0.28,
    baseWage: 429,
    source: occupationSource,
  },
  {
    name: 'Office Clerk',
    jobTier: 5,
    minResidentialTier: 5,
    educationFloor: 237,
    eligibilityShare: 0.245,
    baseWage: 444,
    source: occupationSource,
  },
  {
    name: 'Supermarket Manager',
    jobTier: 5,
    minResidentialTier: 5,
    educationFloor: 273,
    eligibilityShare: 0.21,
    baseWage: 463,
    source: occupationSource,
  },
  {
    name: 'Restaurant Manager',
    jobTier: 5,
    minResidentialTier: 5,
    educationFloor: 319,
    eligibilityShare: 0.175,
    baseWage: 489,
    source: occupationSource,
  },
  {
    name: 'Principal',
    jobTier: 6,
    minResidentialTier: 6,
    educationFloor: 357,
    eligibilityShare: 0.15,
    baseWage: 734,
    source: occupationSource,
  },
  {
    name: 'Hospital Director',
    jobTier: 6,
    minResidentialTier: 6,
    educationFloor: 421,
    eligibilityShare: 0.12,
    baseWage: 961,
    source: occupationSource,
  },
  {
    name: 'CEO',
    jobTier: 6,
    minResidentialTier: 6,
    educationFloor: 604,
    eligibilityShare: 0.065,
    baseWage: 1411,
    source: occupationSource,
  },
] as const satisfies readonly OccupationConfig[];
