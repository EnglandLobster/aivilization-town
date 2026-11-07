import {
  economicAccount,
  assertEstateCashState,
  type EconomicAccount,
  type EstateCashState,
} from '@aivilization/economy';
import { assertEstateMaterialsState, type EstateMaterialsState } from '@aivilization/materials';
import {
  assertSuccessionArrangementsState,
  type SuccessionArrangementsState,
} from '@aivilization/society';
import type { WorldProjection } from './projection';
/** Explicit application protocol; no domain package imports this or reads a world projection. Not activated by optional field hydration. */
export const RESIDENT_EXIT_PRESERVATION_POLICY = {
  version: 'resident-exit-preservation-v1',
  cash: 'resident-estate-cash-v1',
  materials: 'resident-estate-material-custody-v1',
  arrangements: 'resident-succession-arrangements-v1',
  accountResolution: 'resident-physical-financial-account-v1',
} as const;
export const RESIDENT_EXIT_BANK_PRESERVATION_POLICY = {
  ...RESIDENT_EXIT_PRESERVATION_POLICY,
  version: 'resident-exit-preservation-v2',
  cash: 'resident-estate-cash-v2',
} as const;
export type ResidentExitPreservationPolicy =
  | typeof RESIDENT_EXIT_PRESERVATION_POLICY
  | typeof RESIDENT_EXIT_BANK_PRESERVATION_POLICY;
export type ResidentExitRecord = {
  readonly residentId: string;
  readonly populationEventId: string;
  readonly populationPolicyVersion: string;
  readonly cause: 'death' | 'emigration';
  readonly at: number;
  readonly cashAccountId: string;
  readonly backpackCustodyId: string;
};
export type ResidentExitState = {
  readonly policy: ResidentExitPreservationPolicy;
  readonly records: Readonly<Record<string, ResidentExitRecord>>;
  readonly cash: EstateCashState;
  readonly materials: EstateMaterialsState;
  readonly arrangements: SuccessionArrangementsState;
};
export type ResidentFinancialAccount = {
  readonly account: EconomicAccount;
  readonly ownerId: string;
  readonly balance: number;
  readonly kind: 'living-resident' | 'estate-custody';
  readonly acceptsNewObligations: boolean;
  readonly sourceRevision: number | null;
  readonly populationEventId?: string;
};
const validId = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const exact = (v: unknown, keys: readonly string[]) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
/** Checks completed snapshots, never a transient midway state during an atomic departure. */
export function assertResidentExitSnapshot(w: WorldProjection) {
  const s = w.residentExits;
  if (!s) return;
  if (
    !exact(s, ['policy', 'records', 'cash', 'materials', 'arrangements']) ||
    !s.records ||
    typeof s.records !== 'object' ||
    Array.isArray(s.records) ||
    !exact(s.policy, Object.keys(RESIDENT_EXIT_PRESERVATION_POLICY)) ||
    ![RESIDENT_EXIT_PRESERVATION_POLICY, RESIDENT_EXIT_BANK_PRESERVATION_POLICY].some((policy) =>
      Object.entries(policy).every(([k, v]) => s.policy[k as keyof typeof s.policy] === v),
    )
  )
    throw Error('unsupported-resident-exit-preservation-state');
  assertEstateCashState(s.cash);
  if (
    s.cash.policy.version !== s.policy.cash ||
    s.materials.policy.version !== s.policy.materials ||
    s.arrangements.policy.version !== s.policy.arrangements
  )
    throw Error('resident-exit-owning-policy-version-mismatch');
  assertEstateMaterialsState(s.materials);
  assertSuccessionArrangementsState(s.arrangements);
  const cash = new Set<string>(),
    bags = new Set<string>(),
    events = new Set<string>();
  for (const [id, r] of Object.entries(s.records)) {
    if (
      !exact(r, [
        'residentId',
        'populationEventId',
        'populationPolicyVersion',
        'cause',
        'at',
        'cashAccountId',
        'backpackCustodyId',
      ]) ||
      id !== r.residentId ||
      ![
        r.residentId,
        r.populationEventId,
        r.populationPolicyVersion,
        r.cashAccountId,
        r.backpackCustodyId,
      ].every(validId) ||
      !['death', 'emigration'].includes(r.cause) ||
      !Number.isSafeInteger(r.at) ||
      r.at < 0 ||
      r.at > w.clock.now ||
      w.agents[id] ||
      cash.has(r.cashAccountId) ||
      bags.has(r.backpackCustodyId) ||
      events.has(r.populationEventId)
    )
      throw Error('resident-exit-body-or-reference-mismatch');
    const c = s.cash.accounts[r.cashAccountId],
      b = s.materials.records[r.backpackCustodyId];
    if (
      !c ||
      !b ||
      c.ownerId !== id ||
      c.capture.ownerId !== id ||
      b.source.ownerId !== id ||
      c.capture.populationEventId !== r.populationEventId ||
      b.source.populationEventId !== r.populationEventId ||
      c.capture.populationPolicyVersion !== r.populationPolicyVersion ||
      b.source.populationPolicyVersion !== r.populationPolicyVersion ||
      c.capture.cause !== r.cause ||
      b.source.cause !== r.cause ||
      c.capture.at !== r.at ||
      b.source.at !== r.at
    )
      throw Error('resident-exit-owning-custody-source-mismatch');
    if (c.at > w.clock.now) throw Error('resident-exit-custody-time-unobserved');
    if (b.locationId !== null && !w.locations[b.locationId])
      throw Error('resident-exit-custody-location-unobserved');
    cash.add(r.cashAccountId);
    bags.add(r.backpackCustodyId);
    events.add(r.populationEventId);
  }
  if (
    Object.keys(s.cash.accounts).some((id) => !cash.has(id)) ||
    Object.keys(s.materials.records).some((id) => !bags.has(id))
  )
    throw Error('resident-exit-orphan-custody');
  for (const c of Object.values(s.arrangements.arrangements))
    if (c.trigger) {
      const r = s.records[c.ownerId];
      if (
        !r ||
        c.trigger.fact.eventId !== r.populationEventId ||
        c.trigger.fact.at !== r.at ||
        c.trigger.fact.policyVersion !== r.populationPolicyVersion ||
        c.trigger.fact.kind !== r.cause
      )
        throw Error('succession-trigger-population-event-mismatch');
    }
}
/** Read current cash without inventing a living agent. Rights stay on their original economic subject; actual settlement must record this physical account explicitly. */
export function residentPhysicalFinancialAccount(
  w: WorldProjection,
  id: string,
): ResidentFinancialAccount | undefined {
  const a = w.agents[id],
    state = w.residentExits,
    r = state?.records[id];
  if (a && r) throw Error('resident-financial-body-and-estate-conflict');
  if (a)
    return {
      account: economicAccount('agent', id),
      ownerId: id,
      balance: a.balance,
      kind: 'living-resident',
      acceptsNewObligations: true,
      sourceRevision: null,
    };
  if (!r || !state) return undefined;
  assertResidentExitSnapshot(w);
  const c = state.cash.accounts[r.cashAccountId];
  if (!c || c.status === 'closed') return undefined;
  return {
    account: economicAccount('estate', c.id),
    ownerId: id,
    balance: c.balance,
    kind: 'estate-custody',
    acceptsNewObligations: false,
    sourceRevision: c.revision,
    populationEventId: r.populationEventId,
  };
}
