import type { WorldProjection } from './projection';

/** Material stocks remain the sole physical truth; cash-only closure cannot strand an organizational resource. */
export function enterprisePrincipalStockIds(
  w: WorldProjection,
  enterpriseId: string,
): readonly string[] {
  return Object.values(w.materials?.stocks ?? {})
    .filter(
      (stock) =>
        stock.status !== 'closed' &&
        stock.control.controller.kind === 'enterprise' &&
        stock.control.controller.id === enterpriseId,
    )
    .map((stock) => stock.id)
    .sort();
}
export function hasEnterprisePrincipalAssets(w: WorldProjection, enterpriseId: string): boolean {
  return (
    enterprisePrincipalStockIds(w, enterpriseId).length > 0 ||
    Object.values(w.materials?.reservations?.records ?? {}).some(
      (r) =>
        r.principalVersion === 'resource-principals-v2' &&
        r.status !== 'settled' &&
        r.beneficiary.kind === 'enterprise' &&
        r.beneficiary.id === enterpriseId,
    ) ||
    Object.values(w.premises?.projects ?? {}).some(
      (p) =>
        p.status === 'open' &&
        p.controller.kind === 'enterprise' &&
        p.controller.id === enterpriseId,
    ) ||
    Object.values(w.premises?.buildings ?? {}).some(
      (b) =>
        b.control.controller.kind === 'enterprise' &&
        b.control.controller.id === enterpriseId &&
        (b.status !== 'demolished' || !b.footprintReleased),
    )
  );
}
