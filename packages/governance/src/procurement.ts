import {
  PUBLIC_PROCUREMENT_GRANT,
  PUBLIC_GOODS_PROCUREMENT_GRANT,
  type PublicGovernanceState,
} from './model';
import { assertPublicGrant } from './validation';

/** Trusted, explicitly versioned scenario extension, never a resident action or retrospective vote. */
export function enablePublicProcurementAuthority(
  state: PublicGovernanceState,
): PublicGovernanceState {
  if (state.grant.procurement) throw Error('public-procurement-already-enabled');
  const grant = {
    ...state.grant,
    actions: [...state.grant.actions, 'fund-service' as const],
    procurement: PUBLIC_PROCUREMENT_GRANT,
  };
  assertPublicGrant(grant);
  return { ...state, grant };
}
export function enablePublicGoodsProcurementAuthority(
  state: PublicGovernanceState,
): PublicGovernanceState {
  if (!state.grant.procurement || state.grant.goodsProcurement)
    throw Error('public-goods-procurement-requires-new-extension');
  const grant = {
    ...state.grant,
    actions: [...state.grant.actions, 'fund-goods' as const],
    goodsProcurement: PUBLIC_GOODS_PROCUREMENT_GRANT,
  };
  assertPublicGrant(grant);
  return { ...state, grant };
}
