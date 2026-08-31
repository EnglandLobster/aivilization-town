import type { LocationId } from '@aivilization/sim-core';

export type ResidentialAssignmentPolicy = {
  readonly policyVersion: string;
  readonly arrivalSelection: 'most-vacancies-then-location-id';
};

export type ResidentialOccupancy = {
  readonly locationId: LocationId;
  readonly capacity: number | null;
  readonly occupied: number;
};

export type ResidenceChangeDecision =
  | {
      readonly status: 'accepted';
      readonly previousResidenceLocationId: LocationId | null;
      readonly nextResidenceLocationId: LocationId;
      readonly capacity: number | null;
      readonly occupancyBefore: number;
      readonly occupancyAfter: number;
      readonly policyVersion: string;
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'policy-invalid' | 'already-resident' | 'residence-full';
      readonly detail: string;
    };

export function evaluateResidenceChange(input: {
  readonly previousResidenceLocationId: LocationId | null;
  readonly target: ResidentialOccupancy;
  readonly policy: ResidentialAssignmentPolicy;
}): ResidenceChangeDecision {
  try {
    assertValidResidentialAssignmentPolicy(input.policy);
    assertValidResidentialOccupancy(input.target);
  } catch (error) {
    return reject('policy-invalid', error instanceof Error ? error.message : String(error));
  }
  if (input.previousResidenceLocationId === input.target.locationId) {
    return reject('already-resident', `already resident at ${input.target.locationId}`);
  }
  if (input.target.capacity !== null && input.target.occupied >= input.target.capacity) {
    return reject(
      'residence-full',
      `residence ${input.target.locationId} capacity ${input.target.capacity} is full`,
    );
  }
  return {
    status: 'accepted',
    previousResidenceLocationId: input.previousResidenceLocationId,
    nextResidenceLocationId: input.target.locationId,
    capacity: input.target.capacity,
    occupancyBefore: input.target.occupied,
    occupancyAfter: input.target.occupied + 1,
    policyVersion: input.policy.policyVersion,
  };
}

/** Deterministic vacancy choice used only for system-created migrant arrivals. */
export function selectResidenceForArrival(input: {
  readonly residences: readonly ResidentialOccupancy[];
  readonly policy: ResidentialAssignmentPolicy;
}): ResidentialOccupancy | null {
  assertValidResidentialAssignmentPolicy(input.policy);
  for (const residence of input.residences) assertValidResidentialOccupancy(residence);
  return (
    [...input.residences]
      .filter((residence) => residence.capacity === null || residence.occupied < residence.capacity)
      .sort((left, right) => {
        const leftVacancies =
          left.capacity === null ? Number.POSITIVE_INFINITY : left.capacity - left.occupied;
        const rightVacancies =
          right.capacity === null ? Number.POSITIVE_INFINITY : right.capacity - right.occupied;
        return rightVacancies - leftVacancies || left.locationId.localeCompare(right.locationId);
      })[0] ?? null
  );
}

export function assertValidResidentialAssignmentPolicy(policy: ResidentialAssignmentPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('residential assignment policyVersion must not be empty');
  }
  if (policy.arrivalSelection !== 'most-vacancies-then-location-id') {
    throw new Error('unsupported residential assignment arrivalSelection');
  }
}

function assertValidResidentialOccupancy(residence: ResidentialOccupancy): void {
  if (residence.locationId.trim().length === 0) {
    throw new Error('residence locationId must not be empty');
  }
  if (
    residence.capacity !== null &&
    (!Number.isInteger(residence.capacity) || residence.capacity < 0)
  ) {
    throw new Error('residence capacity must be a non-negative integer or null');
  }
  if (!Number.isInteger(residence.occupied) || residence.occupied < 0) {
    throw new Error('residence occupied must be a non-negative integer');
  }
  if (residence.capacity !== null && residence.occupied > residence.capacity) {
    throw new Error('residence occupied must not exceed capacity');
  }
}

function reject(
  reason: Extract<ResidenceChangeDecision, { readonly status: 'rejected' }>['reason'],
  detail: string,
): ResidenceChangeDecision {
  return { status: 'rejected', reason, detail };
}
