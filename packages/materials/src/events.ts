import { validController, validResourcePrincipal } from '@aivilization/authority';
import { applyMaterialPrincipalEvent } from './principal';
import { applyMaterialExtractionEvent } from './extractionEvents';
import {
  materialSourceRecipe,
  matchesMaterialSourceRecipe,
  MATERIAL_EXTRACTION_POLICY,
} from './extractionModel';
import {
  applyMaterialExpertise,
  applyMaterialGrowthEvent,
  recordMaterialExperience,
  validProductionExpertise,
} from './growth';
import { assertMaterialReservationsPolicy } from './reservationModel';
import { activeMaterialCustody, assertMaterialCustodyPolicy } from './custodyModel';
import {
  emptyMaterialsState,
  validInventory,
  type MaterialsState,
  type MaterialEvent,
} from './model';
export function applyMaterialEvent(
  s: MaterialsState | undefined,
  e: MaterialEvent,
): MaterialsState {
  if (e.type === 'MaterialsEnabled') {
    if (s) throw new Error('materials-already-enabled');
    return emptyMaterialsState(e.policy);
  }
  if (!s) throw new Error('materials-not-enabled');
  if (
    e.type === 'MaterialResourcePrincipalsEnabled' ||
    e.type === 'MaterialPrincipalControlChanged'
  )
    return applyMaterialPrincipalEvent(s, e);
  if (e.type === 'MaterialExtractionEnabled' || e.type === 'MaterialSourceChanged')
    return applyMaterialExtractionEvent(s, e);
  if (
    e.type === 'MaterialExpertiseEnabled' ||
    e.type === 'MaterialRegrowthEnabled' ||
    e.type === 'MaterialSourcesRegrown'
  )
    return applyMaterialGrowthEvent(s, e);
  if (e.type === 'MaterialCustodyEnabled') {
    if (s.custodies) throw Error('material-custody-already-enabled');
    if (!s.reservations) throw Error('material-reservations-not-enabled');
    assertMaterialCustodyPolicy(e.policy);
    return { ...s, custodies: { policy: e.policy, records: {} } };
  }
  if (e.type === 'MaterialCustodyChanged') {
    if (!s.custodies) throw Error('material-custody-not-enabled');
    const c = e.custody,
      old = s.custodies.records[c.id];
    if (
      c.revision !== (old?.revision ?? 0) + 1 ||
      (old && !activeMaterialCustody(old)) ||
      !validInventory(c.held, s.policy.maxKinds, s.policy.maxQuantity, true) ||
      !Number.isSafeInteger(c.at) ||
      c.at < (old?.at ?? 0)
    )
      throw Error('invalid-material-custody-event');
    return { ...s, custodies: { ...s.custodies, records: { ...s.custodies.records, [c.id]: c } } };
  }
  if (e.type === 'MaterialReservationsEnabled') {
    if (s.reservations) throw new Error('material-reservations-already-enabled');
    assertMaterialReservationsPolicy(e.policy);
    return { ...s, reservations: { policy: e.policy, records: {} } };
  }
  if (e.type === 'MaterialReservationChanged') {
    if (!s.reservations) throw new Error('material-reservations-not-enabled');
    const r = e.reservation,
      old = s.reservations.records[r.id];
    if (
      (r.principalVersion !== undefined &&
        (r.principalVersion !== 'resource-principals-v2' ||
          !s.resourcePrincipals ||
          !validResourcePrincipal(r.beneficiary))) ||
      (r.principalVersion === undefined &&
        (!(r.beneficiary.kind === 'resident' || r.beneficiary.kind === 'collective') ||
          !validController({ kind: r.beneficiary.kind, id: r.beneficiary.id }))) ||
      r.revision !== (old?.revision ?? 0) + 1 ||
      old?.status === 'settled' ||
      !validInventory(r.held, s.policy.maxKinds, s.policy.maxQuantity, true) ||
      (old &&
        (r.principalVersion !== old.principalVersion ||
          r.stockId !== old.stockId ||
          JSON.stringify(r.original) !== JSON.stringify(old.original) ||
          JSON.stringify(r.consumer) !== JSON.stringify(old.consumer) ||
          JSON.stringify(r.beneficiary) !== JSON.stringify(old.beneficiary)))
    )
      throw new Error('invalid-material-reservation-event');
    return {
      ...s,
      reservations: { ...s.reservations, records: { ...s.reservations.records, [r.id]: r } },
    };
  }
  if (e.type === 'MaterialStockChanged') {
    const old = s.stocks[e.stock.id];
    if (
      e.stock.revision !== (old?.revision ?? 0) + 1 ||
      old?.status === 'closed' ||
      (old && old.locationId !== e.stock.locationId) ||
      (e.stock.control.policyVersion === 'resource-principals-v2' &&
        (!old || JSON.stringify(old.control) !== JSON.stringify(e.stock.control))) ||
      (old?.control.policyVersion === 'resource-principals-v2' &&
        e.stock.control.policyVersion !== 'resource-principals-v2') ||
      !validInventory(e.stock.inventory, s.policy.maxKinds, s.policy.maxQuantity, true)
    )
      throw new Error('invalid-material-stock-event');
    return { ...s, stocks: { ...s.stocks, [e.stock.id]: e.stock } };
  }
  if (e.type === 'MaterialProductionChanged') {
    const p = e.production,
      old = s.productions[p.id];
    if (
      p.revision !== (old?.revision ?? 0) + 1 ||
      old?.status === 'completed' ||
      old?.status === 'cancelled' ||
      (old &&
        (p.progressMs < old.progressMs ||
          p.stockId !== old.stockId ||
          p.sourceId !== old.sourceId ||
          p.sourceExpiresAt !== old.sourceExpiresAt ||
          p.quantity !== old.quantity ||
          JSON.stringify(p.recipe) !== JSON.stringify(old.recipe))) ||
      !Number.isSafeInteger(p.progressMs) ||
      p.progressMs < 0 ||
      p.progressMs > p.recipe.workMs * p.quantity ||
      p.completed !== Math.floor(p.progressMs / p.recipe.workMs) ||
      !validInventory(p.held, s.policy.maxKinds, s.policy.maxQuantity, true) ||
      (p.expertise !== undefined &&
        (!validProductionExpertise(s, p.expertise) ||
          (old !== undefined && JSON.stringify(old.expertise) !== JSON.stringify(p.expertise)))) ||
      (old !== undefined && old.expertise === undefined && p.expertise !== undefined)
    )
      throw new Error('invalid-material-production-event');
    if (!old && p.sourceId !== undefined) {
      const source = s.extraction?.sources[p.sourceId];
      if (
        !source ||
        !Number.isSafeInteger(p.sourceExpiresAt) ||
        p.sourceExpiresAt !== p.at + MATERIAL_EXTRACTION_POLICY.reservationDurationMs ||
        source.locationId !== s.stocks[p.stockId]?.locationId ||
        !matchesMaterialSourceRecipe(
          p.recipe,
          source,
          p.expertise &&
            applyMaterialExpertise(materialSourceRecipe(source), p.expertise.multiplier),
        )
      )
        throw Error('invalid-extraction-production-source');
    }
    return { ...s, productions: { ...s.productions, [p.id]: p } };
  }
  if (s.receipts[e.receipt.id]) throw new Error('duplicate-material-receipt');
  return recordMaterialExperience(
    { ...s, receipts: { ...s.receipts, [e.receipt.id]: e.receipt } },
    e.receipt.efforts,
  );
}
