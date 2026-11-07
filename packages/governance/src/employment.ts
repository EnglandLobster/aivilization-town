import { PUBLIC_EMPLOYMENT_GRANT, type PublicGovernanceState } from './model';
import { assertPublicGrant } from './validation';
/** Explicit trusted extension; a resident procedure cannot create its own jurisdiction. */
export function enablePublicEmploymentAuthority(
  state: PublicGovernanceState,
): PublicGovernanceState {
  if (state.grant.employment) throw Error('public-employment-already-enabled');
  const grant = {
    ...state.grant,
    actions: [...state.grant.actions, 'set-employment' as const],
    employment: PUBLIC_EMPLOYMENT_GRANT,
  };
  assertPublicGrant(grant);
  return { ...state, grant };
}
