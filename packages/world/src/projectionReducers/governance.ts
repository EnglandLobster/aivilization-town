import {
  applyGovernanceDomainEvent,
  createInitialTownGovernanceState,
  type GovernancePolicyChangedDomainEvent,
} from '@aivilization/society';
import type { WorldEvent } from '../events';
import type { WorldGovernanceState, WorldProjection } from '../projection';

/** Replays complete enacted-policy facts; no current default or formula is consulted. */
export function applyGovernanceProjectionEvent(
  projection: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  if (event.type !== 'GovernancePolicyChanged') return undefined;
  const domainEvent: GovernancePolicyChangedDomainEvent = {
    type: 'GovernancePolicyChanged',
    policyKind: event.payload.policyKind,
    governancePolicyVersion: event.payload.governancePolicyVersion,
    governanceRevision: event.payload.governanceRevision,
    reason: event.payload.reason,
    authority: { ...event.payload.authority },
    ...(event.payload.taxPolicy === undefined
      ? {}
      : {
          taxPolicy: {
            ...event.payload.taxPolicy,
            incomeTaxBrackets: event.payload.taxPolicy.incomeTaxBrackets.map((bracket) => ({
              ...bracket,
            })),
          },
        }),
    ...(event.payload.publicBudgetPolicy === undefined
      ? {}
      : {
          publicBudgetPolicy: {
            ...event.payload.publicBudgetPolicy,
            allocations: event.payload.publicBudgetPolicy.allocations.map((allocation) => ({
              ...allocation,
            })),
          },
        }),
    ...(event.payload.subsidyPolicy === undefined
      ? {}
      : { subsidyPolicy: { ...event.payload.subsidyPolicy } }),
  };
  const next = applyGovernanceDomainEvent(
    projection.governance ?? createInitialTownGovernanceState(),
    domainEvent,
  );
  const governance: WorldGovernanceState = {
    ...next,
    lastChangedAt: event.payload.changedAt,
    lastChangedBy: { ...event.payload.authority },
    lastChangeReason: event.payload.reason,
  };
  return { ...projection, governance };
}
