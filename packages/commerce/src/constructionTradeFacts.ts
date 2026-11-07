import {
  principalId,
  validResourcePrincipal,
  type ResourcePrincipal,
} from '@aivilization/authority';
import { tradeFactsEqual } from './tradeFacts';

/** Versioned commercial interpretation, independent of construction physics and subjective acceptance. */
export const CONSTRUCTION_TRADE_FACT_POLICY = {
  version: 'construction-trade-facts-v1',
  sourceVersion: 'resident-premises-v1',
  settlementBasis: 'completed-frozen-project',
} as const;
export type ConstructionTradeBasis = {
  readonly projectId: string;
  readonly kind: 'build' | 'modify' | 'maintain' | 'demolish';
  readonly siteId: string;
  readonly buildingId: string;
  readonly beneficiary: ResourcePrincipal;
  /** Adapter commitment to the exact immutable owning-domain plan and material-source references. */
  readonly specificationHash: string;
  readonly requiredWorkMs: number;
};
/** Only the owning-domain read adapter may supply evidence; resident statements are not this port. */
export type ConstructionTradeEvidence = {
  readonly sourceVersion: typeof CONSTRUCTION_TRADE_FACT_POLICY.sourceVersion;
  readonly basis: ConstructionTradeBasis;
  readonly revision: number;
  readonly at: number;
  readonly progressMs: number;
  readonly status: 'open' | 'completed' | 'cancelled';
};
export type ConstructionTradeObservation = {
  readonly policyVersion: typeof CONSTRUCTION_TRADE_FACT_POLICY.version;
  readonly evidence: ConstructionTradeEvidence;
  readonly objectiveDelivery: 'pending' | 'completed' | 'cancelled-without-delivery';
};
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function validConstructionTradeBasis(b: ConstructionTradeBasis): boolean {
  return (
    !!b &&
    [b.projectId, b.siteId, b.buildingId].every(principalId) &&
    ['build', 'modify', 'maintain', 'demolish'].includes(b.kind) &&
    validResourcePrincipal(b.beneficiary) &&
    typeof b.specificationHash === 'string' &&
    /^[a-f0-9]{64}$/.test(b.specificationHash) &&
    time(b.requiredWorkMs) &&
    b.requiredWorkMs > 0
  );
}
function validEvidence(e: ConstructionTradeEvidence, at: number): boolean {
  return (
    !!e &&
    e.sourceVersion === CONSTRUCTION_TRADE_FACT_POLICY.sourceVersion &&
    validConstructionTradeBasis(e.basis) &&
    Number.isSafeInteger(e.revision) &&
    e.revision >= 1 &&
    time(e.at) &&
    e.at <= at &&
    time(e.progressMs) &&
    e.progressMs <= e.basis.requiredWorkMs &&
    ['open', 'completed', 'cancelled'].includes(e.status) &&
    (e.status === 'completed'
      ? e.progressMs === e.basis.requiredWorkMs
      : e.progressMs < e.basis.requiredWorkMs)
  );
}
/** No payment or cancellation of physical work occurs here; interrupted performance remains a settlement obligation. */
export function observeConstructionTradeFacts(
  basis: ConstructionTradeBasis,
  previous: ConstructionTradeEvidence | undefined,
  current: ConstructionTradeEvidence | undefined,
  at: number,
):
  | { readonly accepted: true; readonly observation: ConstructionTradeObservation }
  | { readonly accepted: false; readonly reason: string } {
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!time(at) || !validConstructionTradeBasis(basis))
    return no('invalid-construction-trade-basis');
  if (!current) return no('construction-trade-source-unavailable');
  if (!validEvidence(current, at)) return no('invalid-construction-trade-evidence');
  if (!tradeFactsEqual(basis, current.basis)) return no('construction-trade-basis-changed');
  if (previous) {
    if (!validEvidence(previous, at) || !tradeFactsEqual(basis, previous.basis))
      return no('invalid-construction-trade-previous-evidence');
    if (
      current.revision < previous.revision ||
      current.at < previous.at ||
      current.progressMs < previous.progressMs
    )
      return no('construction-trade-evidence-regressed');
    if (current.revision === previous.revision && !tradeFactsEqual(current, previous))
      return no('construction-trade-revision-reused');
    if (previous.status !== 'open' && !tradeFactsEqual(current, previous))
      return no('construction-trade-terminal-evidence-changed');
  }
  return {
    accepted: true,
    observation: {
      policyVersion: CONSTRUCTION_TRADE_FACT_POLICY.version,
      evidence: structuredClone(current),
      objectiveDelivery:
        current.status === 'completed'
          ? 'completed'
          : current.status === 'cancelled'
            ? 'cancelled-without-delivery'
            : 'pending',
    },
  };
}
