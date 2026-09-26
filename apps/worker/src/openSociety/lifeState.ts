import {
  RESIDENT_HOUSEHOLD_POLICY,
  RESIDENT_CARE_POLICY,
  RESIDENT_HEALTH_RECORD_POLICY,
  RESIDENT_LEASE_POLICY,
  RESIDENT_LEARNING_POLICY,
} from '@aivilization/society';
import {
  emptyHouseholdState,
  applyHouseholdEvent,
  emptyCareState,
  applyCareEvent,
  emptyHealthRecordsState,
  applyHealthRecordEvent,
  emptyLearningState,
  applyLearningEvent,
  type HouseholdState,
  type HouseholdEvent,
  type CareState,
  type CareEvent,
  type HealthRecordsState,
  type HealthRecordEvent,
  type LearningState,
  type LearningEvent,
} from '@aivilization/society';
export const RESIDENT_LIFE_VERSION = 'resident-life-v1';
export const RESIDENT_LIFE_POLICIES = {
  households: RESIDENT_HOUSEHOLD_POLICY,
  care: RESIDENT_CARE_POLICY,
  healthRecords: RESIDENT_HEALTH_RECORD_POLICY,
  leases: RESIDENT_LEASE_POLICY,
  learning: RESIDENT_LEARNING_POLICY,
} as const;
export type ResidentLifeState = {
  version: typeof RESIDENT_LIFE_VERSION;
  households: HouseholdState;
  care: CareState;
  health: HealthRecordsState;
  learning: LearningState;
};
export type ResidentLifeEvents = {
  lifeEnabled?: typeof RESIDENT_LIFE_VERSION;
  householdEvents?: readonly HouseholdEvent[];
  careEvents?: readonly CareEvent[];
  healthRecordEvents?: readonly HealthRecordEvent[];
  learningEvents?: readonly LearningEvent[];
};
export function emptyResidentLifeState(): ResidentLifeState {
  return {
    version: RESIDENT_LIFE_VERSION,
    households: emptyHouseholdState(),
    care: emptyCareState(),
    health: emptyHealthRecordsState(),
    learning: emptyLearningState(),
  };
}
export function applyResidentLifeEvents(
  previous: ResidentLifeState | undefined,
  e: ResidentLifeEvents,
): ResidentLifeState | undefined {
  let s = previous;
  if (e.lifeEnabled) {
    if (e.lifeEnabled !== RESIDENT_LIFE_VERSION)
      throw new Error('unsupported-resident-life-version');
    if (s) throw new Error('life-already-enabled');
    s = emptyResidentLifeState();
  }
  if (!s) {
    if (
      e.householdEvents?.length ||
      e.careEvents?.length ||
      e.healthRecordEvents?.length ||
      e.learningEvents?.length
    )
      throw new Error('life-not-enabled');
    return undefined;
  }
  return {
    ...s,
    households: (e.householdEvents ?? []).reduce(applyHouseholdEvent, s.households),
    care: (e.careEvents ?? []).reduce(applyCareEvent, s.care),
    health: (e.healthRecordEvents ?? []).reduce(applyHealthRecordEvent, s.health),
    learning: (e.learningEvents ?? []).reduce(applyLearningEvent, s.learning),
  };
}
