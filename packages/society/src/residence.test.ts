import { asLocationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';

import {
  evaluateResidenceChange,
  selectResidenceForArrival,
  type ResidentialAssignmentPolicy,
} from './residence';

const policy: ResidentialAssignmentPolicy = {
  policyVersion: 'residential-assignment-test-v1',
  arrivalSelection: 'most-vacancies-then-location-id',
};

describe('residential assignment', () => {
  test('accepts a resident-selected vacancy and freezes capacity evidence', () => {
    expect(
      evaluateResidenceChange({
        previousResidenceLocationId: null,
        target: { locationId: asLocationId('homes'), capacity: 3, occupied: 2 },
        policy,
      }),
    ).toEqual({
      status: 'accepted',
      previousResidenceLocationId: null,
      nextResidenceLocationId: 'homes',
      capacity: 3,
      occupancyBefore: 2,
      occupancyAfter: 3,
      policyVersion: policy.policyVersion,
    });
  });

  test('rejects an already-held or full residence', () => {
    expect(
      evaluateResidenceChange({
        previousResidenceLocationId: asLocationId('homes'),
        target: { locationId: asLocationId('homes'), capacity: 2, occupied: 1 },
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'already-resident' });
    expect(
      evaluateResidenceChange({
        previousResidenceLocationId: null,
        target: { locationId: asLocationId('full'), capacity: 2, occupied: 2 },
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'residence-full' });
  });

  test('selects the largest vacancy pool with a stable location tie-break', () => {
    expect(
      selectResidenceForArrival({
        residences: [
          { locationId: asLocationId('west'), capacity: 5, occupied: 3 },
          { locationId: asLocationId('east'), capacity: 4, occupied: 2 },
          { locationId: asLocationId('full'), capacity: 1, occupied: 1 },
        ],
        policy,
      })?.locationId,
    ).toBe(asLocationId('east'));
  });
});
