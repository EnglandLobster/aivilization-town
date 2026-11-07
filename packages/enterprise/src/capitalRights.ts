import {
  capitalAccountKey,
  type CapitalAccount,
  type CapitalPosition,
  type EnterpriseCapitalState,
} from './capitalModel';
import { assertCapitalPositions, assertEnterpriseCapitalState } from './capitalValidation';
import { capitalHeldMicros } from './capitalAgreement';
/** Actual relative rights, preserving fractional legacy weights rather than rounding them into invented shares. */
export function capitalPayments(
  positions: readonly CapitalPosition[],
  amount: number,
): readonly { account: CapitalAccount; amount: number }[] {
  assertCapitalPositions(positions);
  if (!Number.isFinite(amount) || amount < 0) throw Error('invalid-capital-payment-total');
  // Pay small weights first so subtracting a dominant weight cannot erase the
  // remaining denominator or assign every smaller holder a NaN/zero residual.
  const byAccount = (a: CapitalPosition, b: CapitalPosition) =>
    capitalAccountKey(a.account).localeCompare(capitalAccountKey(b.account), 'en');
  const ordered = [...positions].sort((a, b) => a.weight - b.weight || byAccount(a, b));
  let remaining = amount,
    weight = ordered.reduce((sum, p) => sum + p.weight, 0);
  return ordered
    .map((p, i) => {
      const value =
        i === ordered.length - 1 ? remaining : remaining * Math.min(1, p.weight / weight);
      remaining -= value;
      weight -= p.weight;
      return { account: p.account, amount: value };
    })
    .sort((a, b) => capitalAccountKey(a.account).localeCompare(capitalAccountKey(b.account), 'en'));
}
export function capitalEscrowMicros(s: EnterpriseCapitalState | undefined): number {
  if (!s) return 0;
  assertEnterpriseCapitalState(s);
  return Object.values(s.agreements).reduce((sum, a) => sum + capitalHeldMicros(a), 0);
}
/** An account cannot disappear while it still owns rights or may receive protected funds. */
export function capitalAccountObligations(
  s: EnterpriseCapitalState | undefined,
  account: CapitalAccount,
): boolean {
  if (!s) return false;
  const key = capitalAccountKey(account);
  return (
    s.positions.some((p) => capitalAccountKey(p.account) === key) ||
    Object.values(s.agreements).some(
      (a) => a.status === 'proposed' && Object.hasOwn(a.consents, key),
    )
  );
}
/** Consent explicitly reserves headroom for this agreement's mutually exclusive success/refund outcomes. */
export function capitalReservedIncomingMicros(
  s: EnterpriseCapitalState | undefined,
  account: CapitalAccount,
): number {
  if (!s) return 0;
  const key = capitalAccountKey(account);
  return Object.values(s.agreements)
    .filter((a) => a.status === 'proposed' && Object.hasOwn(a.consents, key))
    .reduce((sum, a) => {
      const refund =
        a.contributions.find((c) => capitalAccountKey(c.account) === key)?.amountMicros ?? 0;
      const receipt =
        a.disbursements.find(
          (d) => d.account.sector !== 'enterprise' && capitalAccountKey(d.account) === key,
        )?.amountMicros ?? 0;
      return sum + Math.max(refund, receipt);
    }, 0);
}
