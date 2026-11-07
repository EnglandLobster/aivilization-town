import { validController, validControllerId } from '@aivilization/authority';
import {
  CAPITAL_AGREEMENTS_POLICY as policy,
  capitalAccountKey,
  type CapitalAccount,
  type CapitalPosition,
  type CapitalAuthority,
  type CapitalAgreement,
  type EnterpriseCapitalState,
} from './capitalModel';
const isArray = (value: unknown): boolean => Array.isArray(value);
export const capitalId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v) &&
  !Object.hasOwn(Object.prototype, v);
export const capitalTime = (v: number): boolean => Number.isSafeInteger(v) && v >= 0;
export const capitalAmount = (v: number): boolean => Number.isSafeInteger(v) && v > 0;
export const capitalAccount = (a: CapitalAccount): boolean =>
  !!a &&
  (a.sector === 'agent' || a.sector === 'collective') &&
  capitalId(a.id) &&
  Object.keys(a).length === 2;
/** Exact structural evidence equality, independent of persisted JSON object-key order. */
export function capitalFactsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => capitalFactsEqual(v, b[i]));
  const left = Object.entries(a),
    right = Object.entries(b);
  return (
    left.length === right.length &&
    left.every(
      ([k, v]) => Object.hasOwn(b, k) && capitalFactsEqual(v, (b as Record<string, unknown>)[k]),
    )
  );
}
export function assertCapitalPositions(positions: readonly CapitalPosition[]) {
  if (!isArray(positions) || !positions.length || positions.length > policy.maxParties)
    throw Error('invalid-capital-positions');
  const keys = new Set<string>();
  let total = 0;
  for (const p of positions) {
    if (
      !capitalAccount(p.account) ||
      !Number.isFinite(p.weight) ||
      p.weight <= 0 ||
      keys.has(capitalAccountKey(p.account)) ||
      Object.keys(p).length !== 2
    )
      throw Error('invalid-capital-positions');
    keys.add(capitalAccountKey(p.account));
    total += p.weight;
  }
  if (!Number.isFinite(total) || positions.some((p) => p.weight / total === 0))
    throw Error('unrepresentable-capital-weights');
}
export function assertCapitalAuthority(a: CapitalAuthority) {
  if (
    !capitalId(a.actorId) ||
    a.actorId === 'system' ||
    !validController(a.controller) ||
    (a.controller.kind === 'resident'
      ? a.controller.id !== a.actorId || a.decisionId !== undefined
      : !a.decisionId || !validControllerId(a.decisionId))
  )
    throw Error('invalid-capital-authority');
}
export function assertCapitalAgreement(a: CapitalAgreement) {
  if (
    !capitalId(a.id) ||
    !capitalId(a.proposedBy) ||
    !capitalAmount(a.revision) ||
    !capitalTime(a.proposedAt) ||
    !capitalTime(a.expiresAt) ||
    a.expiresAt <= a.proposedAt ||
    a.expiresAt - a.proposedAt > policy.maxHorizonMs ||
    typeof a.terms !== 'string' ||
    !a.terms.trim() ||
    a.terms.length > policy.maxTermsChars ||
    !capitalAmount(a.equityVersion)
  )
    throw Error('invalid-capital-agreement');
  assertCapitalAuthority(a.proposerAuthority);
  if (a.proposerAuthority.actorId !== a.proposedBy) throw Error('capital-proposer-source-mismatch');
  assertCapitalPositions(a.positions);
  if (
    !isArray(a.participants) ||
    !a.participants.length ||
    a.participants.length > policy.maxParties ||
    a.participants.some((p) => !capitalAccount(p)) ||
    new Set(a.participants.map(capitalAccountKey)).size !== a.participants.length
  )
    throw Error('invalid-capital-participants');
  const parties = new Set(a.participants.map(capitalAccountKey)),
    payers = new Set<string>(),
    payees = new Set<string>();
  let incoming = 0,
    outgoing = 0;
  if (
    !isArray(a.contributions) ||
    !isArray(a.disbursements) ||
    a.contributions.length > policy.maxParties ||
    a.disbursements.length > policy.maxParties + 1
  )
    throw Error('invalid-capital-transfers');
  for (const c of a.contributions) {
    const k = capitalAccountKey(c.account);
    if (
      !capitalAccount(c.account) ||
      !capitalAmount(c.amountMicros) ||
      !parties.has(k) ||
      payers.has(k)
    )
      throw Error('invalid-capital-contribution');
    payers.add(k);
    incoming += c.amountMicros;
  }
  for (const d of a.disbursements) {
    const k = d.account.sector === 'enterprise' ? 'enterprise' : capitalAccountKey(d.account);
    if (
      (d.account.sector === 'enterprise'
        ? Object.keys(d.account).length !== 1
        : !capitalAccount(d.account) || !parties.has(k)) ||
      !capitalAmount(d.amountMicros) ||
      payees.has(k)
    )
      throw Error('invalid-capital-disbursement');
    payees.add(k);
    outgoing += d.amountMicros;
  }
  if (!Number.isSafeInteger(incoming) || !Number.isSafeInteger(outgoing) || incoming !== outgoing)
    throw Error('unbalanced-capital-terms');
  if (a.positions.some((p) => !parties.has(capitalAccountKey(p.account))))
    throw Error('capital-holder-consent-required');
  for (const [key, c] of Object.entries(a.consents)) {
    if (!parties.has(key) || !capitalTime(c.at) || c.at < a.proposedAt || c.at >= a.expiresAt)
      throw Error('invalid-capital-consent');
    assertCapitalAuthority(c.authority);
    const holder = a.participants.find((p) => capitalAccountKey(p) === key)!;
    if (
      holder.sector === 'agent' &&
      (c.authority.controller.kind !== 'resident' || c.authority.controller.id !== holder.id)
    )
      throw Error('capital-consent-account-mismatch');
    if (holder.sector === 'collective' && c.authority.controller.kind !== 'collective')
      throw Error('capital-consent-account-mismatch');
  }
  if (a.management) {
    assertCapitalAuthority(a.management.authority);
    if (
      !capitalAmount(a.management.controlVersion) ||
      !capitalTime(a.management.at) ||
      a.management.at < a.proposedAt ||
      a.management.at >= a.expiresAt
    )
      throw Error('invalid-capital-management-consent');
  }
  if (a.status === 'proposed') {
    if (a.endedAt !== undefined || a.endReason !== undefined)
      throw Error('invalid-capital-terminal-state');
  } else if (
    !['executed', 'cancelled'].includes(a.status) ||
    !capitalTime(a.endedAt!) ||
    a.endedAt! < a.proposedAt ||
    (a.status === 'executed'
      ? a.endReason !== 'completed' ||
        Object.keys(a.consents).length !== a.participants.length ||
        a.endedAt! >= a.expiresAt
      : !['withdrawn', 'expired', 'equity-version-changed'].includes(a.endReason!))
  )
    throw Error('invalid-capital-terminal-state');
}
export function assertEnterpriseCapitalState(s: EnterpriseCapitalState) {
  if (
    s.policyVersion !== policy.version ||
    !capitalAmount(s.equityVersion) ||
    Object.keys(s.agreements).length > policy.maxAgreements
  )
    throw Error('invalid-enterprise-capital-state');
  assertCapitalPositions(s.initialPositions);
  assertCapitalPositions(s.positions);
  if (s.equityVersion === 1 && !capitalFactsEqual(s.initialPositions, s.positions))
    throw Error('capital-origin-rights-mismatch');
  const executed = Object.values(s.agreements)
    .filter((a) => a.status === 'executed')
    .sort((a, b) => a.equityVersion - b.equityVersion);
  if (
    executed.length !== s.equityVersion - 1 ||
    executed.some((a, i) => a.equityVersion !== i + 1) ||
    (executed.length && !capitalFactsEqual(executed[executed.length - 1]!.positions, s.positions))
  )
    throw Error('capital-rights-history-mismatch');
  const open = Object.values(s.agreements).filter((a) => a.status === 'proposed');
  const held = open.reduce(
    (sum, a) =>
      sum +
      a.contributions
        .filter((c) => Object.hasOwn(a.consents, capitalAccountKey(c.account)))
        .reduce((n, c) => n + c.amountMicros, 0),
    0,
  );
  if (open.length > policy.maxOpenAgreements || !Number.isSafeInteger(held))
    throw Error('capital-protected-funds-limit');
  for (const [id, a] of Object.entries(s.agreements)) {
    assertCapitalAgreement(a);
    if (id !== a.id || a.equityVersion > s.equityVersion)
      throw Error('capital-agreement-source-mismatch');
  }
}

/** Public currency units at the adapter boundary, with exact micro-unit executable commitments. */
export function parseCapitalAllocation(
  value: unknown,
): Pick<CapitalAgreement, 'positions' | 'contributions' | 'disbursements'> | undefined {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const keys = (v: Record<string, unknown>, names: readonly string[]) =>
    Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
  const micros = (v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
    const n = Math.round(v * policy.moneyScale);
    return capitalAmount(n) && Math.abs(n / policy.moneyScale - v) <= 1e-10 ? n : undefined;
  };
  if (
    !object(value) ||
    !keys(value, ['positions', 'contributions', 'disbursements']) ||
    !Array.isArray(value.positions) ||
    !Array.isArray(value.contributions) ||
    !Array.isArray(value.disbursements)
  )
    return undefined;
  try {
    // Validated boundary: every account, amount and nested closed shape is checked before publication.
    const positions = value.positions as CapitalPosition[];
    assertCapitalPositions(positions);
    const contributions: CapitalAgreement['contributions'][number][] = [],
      disbursements: CapitalAgreement['disbursements'][number][] = [];
    for (const row of value.contributions as unknown[]) {
      if (
        !object(row) ||
        !keys(row, ['account', 'amount']) ||
        !object(row.account) ||
        !capitalAccount(row.account as CapitalAccount)
      )
        return undefined;
      const amountMicros = micros(row.amount);
      if (amountMicros === undefined) return undefined;
      contributions.push({ account: row.account as CapitalAccount, amountMicros });
    }
    for (const row of value.disbursements as unknown[]) {
      if (!object(row) || !keys(row, ['account', 'amount']) || !object(row.account))
        return undefined;
      const a = row.account;
      if (a.sector === 'enterprise' ? !keys(a, ['sector']) : !capitalAccount(a as CapitalAccount))
        return undefined;
      const amountMicros = micros(row.amount);
      if (amountMicros === undefined) return undefined;
      disbursements.push({
        account: a.sector === 'enterprise' ? { sector: 'enterprise' } : (a as CapitalAccount),
        amountMicros,
      });
    }
    return { positions, contributions, disbursements };
  } catch {
    return undefined;
  }
}
