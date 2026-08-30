import type { WorldDecisionOccupationRule } from '@aivilization/agent-runtime';

const PUBLIC_RECRUITMENT_ONLY_REJECTION_REASONS = new Set(['application-quota-exhausted']);

/**
 * Enterprise membership is settled as a direct employment agreement, not as
 * an application to the public recruitment cycle. Keep the shared occupation
 * qualification gates while ignoring only public-cycle quota exhaustion.
 * Unknown rejection reasons remain blocking so future rules fail closed.
 */
export function isEnterpriseOccupationQualified(
  occupationRule: WorldDecisionOccupationRule | undefined,
): boolean {
  return (
    occupationRule === undefined ||
    occupationRule.rejectionReasons.every((reason) =>
      PUBLIC_RECRUITMENT_ONLY_REJECTION_REASONS.has(reason),
    )
  );
}
