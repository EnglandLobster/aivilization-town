import type { WorldCommandPolicies, WorldProjection } from '@aivilization/world';

export type WorldCommandPolicyResolver = (
  projection: WorldProjection,
) => WorldCommandPolicies;

export type WorldCommandPolicySource = WorldCommandPolicies | WorldCommandPolicyResolver;

export function resolveWorldCommandPolicies(input: {
  readonly policies: WorldCommandPolicySource;
  readonly projection: WorldProjection;
}): WorldCommandPolicies {
  return typeof input.policies === 'function'
    ? input.policies(input.projection)
    : input.policies;
}
