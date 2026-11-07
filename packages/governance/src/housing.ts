import { PUBLIC_HOUSING_GRANT, type PublicGovernanceState } from './model';
import { assertPublicGrant } from './validation';
/** A resident vote cannot expand the jurisdiction granted by the simulation. */
export function enablePublicHousingAuthority(state: PublicGovernanceState): PublicGovernanceState {
  if (state.grant.housing) throw Error('public-housing-already-enabled');
  const grant = {
    ...state.grant,
    actions: [...state.grant.actions, 'set-housing' as const],
    housing: PUBLIC_HOUSING_GRANT,
  };
  assertPublicGrant(grant);
  return { ...state, grant };
}
