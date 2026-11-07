import { PUBLIC_GOVERNANCE_POLICY, createPublicGovernanceState } from '@aivilization/governance';
import type { WorldProjection } from '@aivilization/world';
import { createAivilizationTownGovernancePolicy } from '../experimentalFeatures';

/** Explicit initial institution. Residents may change this procedure through its own approved amendment. */
export function seedPublicGovernance(world: WorldProjection) {
  const residents = Object.keys(world.agents).sort();
  const authority = createPublicGovernanceState(
    {
      id: 'town',
      source: {
        kind: 'explicit-scenario-grant',
        version: 'open-town-public-grant-v1',
        description:
          'Scenario grants the initial resident electorate control over existing town fiscal policies and this procedure. This is an external initial institution, not unanimous resident consent.',
      },
      residents,
      actions: ['set-tax', 'set-budget', 'set-subsidy', 'set-procedure', 'invalidate-decision'],
    },
    {
      electorate: residents,
      minimumTurnout: Math.floor(residents.length / 2) + 1,
      minimumYes: Math.floor(residents.length / 2) + 1,
      allowVoteChanges: true,
      minimumVotingMs: 60000,
      maximumVotingMs: PUBLIC_GOVERNANCE_POLICY.maxVotingMs,
      executionWindowMs: 7 * 86400000,
      executors: 'electorate',
    },
  );
  return { authority, institutionPolicy: createAivilizationTownGovernancePolicy() };
}
