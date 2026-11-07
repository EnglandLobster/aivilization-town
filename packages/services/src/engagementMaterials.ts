import { sameController } from '@aivilization/authority';
import { serviceEffectRequirements, residentServiceEffect } from '@aivilization/society';
import type { Inventory } from '@aivilization/economy';
import type {
  ServiceEngagement,
  ServiceEngagementTerms,
  ServiceEngagementPorts,
  ServiceMaterialInstruction,
} from './engagementModel';
export function engagementMaterialsAvailable(
  e: ServiceEngagementTerms,
  p: ServiceEngagementPorts,
  at: number,
) {
  const required = serviceEffectRequirements(residentServiceEffect(e.modelId)!, e.maxDurationMs),
    total: Record<string, number> = {};
  if (new Set(e.materials.map((r) => r.id)).size !== e.materials.length) return false;
  for (const ref of e.materials) {
    const r = p.material(ref.id);
    if (
      !r ||
      r.revision !== ref.revision ||
      r.status !== 'offered' ||
      r.expiresAt <= at ||
      r.consumerDomain !== 'services' ||
      r.consumerId !== e.id ||
      !sameController(r.beneficiary, e.controller) ||
      r.locationId !== e.locationId
    )
      return false;
    for (const [item, quantity] of Object.entries(r.held))
      total[item] = (total[item] ?? 0) + quantity;
  }
  // Exact holdings avoid tying unrelated donations to a service or silently interpreting extra goods as fees.
  return (
    new Set([...Object.keys(required), ...Object.keys(total)]).size ===
      Object.keys(required).length &&
    Object.entries(required).every(
      ([item, quantity]) => Math.abs((total[item] ?? 0) - quantity) < 1e-9,
    )
  );
}
export function engagementMaterialInstructions(
  e: ServiceEngagement,
  p: ServiceEngagementPorts,
  evidenceId: string,
  consumed: Inventory,
  finish: boolean,
): readonly ServiceMaterialInstruction[] {
  const remaining = { ...consumed },
    instructions: ServiceMaterialInstruction[] = [];
  for (const ref of e.materials) {
    const r = p.material(ref.id);
    if (
      !r ||
      !['offered', 'bound'].includes(r.status) ||
      r.consumerDomain !== 'services' ||
      r.consumerId !== e.id ||
      !sameController(r.beneficiary, e.controller) ||
      r.locationId !== e.locationId
    )
      throw new Error('service-material-reservation-mismatch');
    const allocation: Record<string, number> = {};
    for (const [item, q] of Object.entries(remaining)) {
      const n = Math.min(q, r.held[item] ?? 0);
      if (n > 0) {
        allocation[item] = n;
        remaining[item] = Math.round((q - n) * 1e10) / 1e10;
      }
    }
    instructions.push({
      reservationId: ref.id,
      expectedRevision: r.revision,
      engagementId: e.id,
      controller: e.controller,
      evidenceId,
      consumed: allocation,
      finish,
    });
  }
  if (Object.values(remaining).some((q) => q > 1e-9)) throw new Error('service-material-underflow');
  return instructions;
}
