import { principalTradeAccount } from './principalTradePorts';
import type { PrincipalTradeAccount } from '@aivilization/commerce';
import { createHash } from 'node:crypto';
import { principalOperationKey } from '@aivilization/authority';
import { premisesConstructionFacts } from '@aivilization/premises';
import type { ConstructionTradeEvidence } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
/** A caller cannot provide the hash or the progress: both are derived from the owning domain. */
export function residentConstructionTradeEvidence(
  w: Pick<WorldProjection, 'premises'>,
  id: string,
): ConstructionTradeEvidence | undefined {
  if (!w.premises) return undefined;
  const facts = premisesConstructionFacts(w.premises, id);
  if (!facts) return undefined;
  const s = facts.specification;
  return {
    sourceVersion: facts.sourceVersion,
    revision: facts.revision,
    at: facts.at,
    progressMs: facts.progressMs,
    status: facts.status,
    basis: {
      projectId: s.projectId,
      kind: s.kind,
      siteId: s.siteId,
      buildingId: s.buildingId,
      beneficiary: structuredClone(s.beneficiary),
      requiredWorkMs: s.plan.workMs,
      specificationHash: createHash('sha256').update(principalOperationKey(s)).digest('hex'),
    },
  };
}

/** Separate grant prevents physical construction or permit fees from implicitly authorizing procurement. */
export function constructionTradeAccount(
  w: WorldProjection,
  a: PrincipalTradeAccount,
): ReturnType<typeof principalTradeAccount> {
  if (a.sector !== 'treasury') return principalTradeAccount(w, a);
  const grant = w.publicGovernance?.authority.grant;
  return a.id === 'public-treasury' && grant?.constructionTrade
    ? {
        principal: { kind: 'public', id: grant.id },
        balance: Math.max(
          0,
          (w.treasury ?? 0) - (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0),
        ),
        status: 'open',
      }
    : undefined;
}
