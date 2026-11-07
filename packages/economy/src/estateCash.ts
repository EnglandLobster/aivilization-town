import { createMoneyTransfer, economicAccount, assertMoneySupplyDelta } from './accounting';
import { commonAccountNextBalance } from './commonAccounts';
import {
  ESTATE_CASH_POLICY as POLICY,
  ESTATE_CASH_BANK_POLICY as BANK_POLICY,
  type EstateCashPolicy,
  ESTATE_CASH_SETTLEMENT_SOURCES as SOURCES,
  ESTATE_RESPONSIBILITY_DOMAINS as DOMAINS,
  type EstateCashState,
  type EstateCashAccount,
  type EstateCashCaptureSource,
  type EstateCashSourceReference,
  type EstateCashDecision,
  type EstateCashEvent,
  type EstateResponsibilityRead,
} from './estateCashModel';
const validId = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const time = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => time(v) && v > 0;
const check = (v: unknown, reason: string) => {
  if (!v) throw Error(reason);
};
const exact = (v: unknown, keys: readonly string[]) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const money = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const sourceKey = (r: EstateCashSourceReference) => `${r.context}:${r.id}`;
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = Object.entries(a).sort(([a], [b]) => a.localeCompare(b)),
    y = Object.entries(b).sort(([a], [b]) => a.localeCompare(b));
  return x.length === y.length && x.every(([k, v], i) => y[i]?.[0] === k && equal(v, y[i]?.[1]));
}
function assertCapture(s: EstateCashCaptureSource) {
  check(
    exact(s, [
      'populationEventId',
      'ownerId',
      'cause',
      'populationPolicyVersion',
      'at',
      'personalBalance',
    ]) &&
      validId(s.populationEventId) &&
      validId(s.ownerId) &&
      validId(s.populationPolicyVersion) &&
      ['death', 'emigration'].includes(s.cause) &&
      time(s.at) &&
      money(s.personalBalance),
    'invalid-estate-personal-cash-source',
  );
}
function captureTransaction(id: string, s: EstateCashCaptureSource) {
  return s.personalBalance === 0
    ? undefined
    : createMoneyTransfer({
        transactionId: `estate-capture:${id}`,
        reason: 'personal-cash-preserved-on-departure',
        from: economicAccount('agent', s.ownerId),
        to: economicAccount('estate', id),
        amount: s.personalBalance,
      });
}
export function assertEstateCashSourceReference(s: EstateCashSourceReference) {
  check(
    exact(s, ['context', 'id', 'revision', 'policyVersion']) &&
      Object.hasOwn(SOURCES, s.context) &&
      validId(s.id) &&
      positive(s.revision) &&
      s.policyVersion === SOURCES[s.context].policyVersion,
    'invalid-estate-owning-settlement-source',
  );
}
function assertAccount(a: EstateCashAccount, policy: EstateCashPolicy) {
  check(
    exact(a, [
      'id',
      'ownerId',
      'revision',
      'status',
      'balance',
      'at',
      'capture',
      'settledSources',
    ]) &&
      validId(a.id) &&
      validId(a.ownerId) &&
      positive(a.revision) &&
      ['held', 'closed'].includes(a.status) &&
      money(a.balance) &&
      time(a.at),
    'invalid-estate-cash-account',
  );
  assertCapture(a.capture);
  check(
    a.capture.ownerId === a.ownerId &&
      a.at >= a.capture.at &&
      (a.status !== 'closed' || a.balance === 0),
    'estate-cash-source-or-status-mismatch',
  );
  check(
    !!a.settledSources &&
      typeof a.settledSources === 'object' &&
      !Array.isArray(a.settledSources) &&
      Object.keys(a.settledSources).length <= POLICY.maxSourceReferences,
    'estate-source-reference-limit',
  );
  for (const [k, r] of Object.entries(a.settledSources)) {
    const context = Object.keys(SOURCES).find((v) => k.startsWith(`${v}:`));
    check(
      !!context &&
        (context !== 'credit' || policy.version === BANK_POLICY.version) &&
        validId(k.slice((context?.length ?? 0) + 1)) &&
        exact(r, ['revision', 'transactionId']) &&
        positive(r.revision) &&
        validId(r.transactionId),
      'invalid-estate-recorded-settlement',
    );
  }
}
export function assertEstateCashState(s: EstateCashState) {
  check(
    exact(s, ['policy', 'accounts']) &&
      (equal(s.policy, POLICY) || equal(s.policy, BANK_POLICY)) &&
      !!s.accounts &&
      typeof s.accounts === 'object' &&
      !Array.isArray(s.accounts) &&
      Object.keys(s.accounts).length <= POLICY.maxAccounts,
    'unsupported-estate-cash-state',
  );
  const owners = new Set<string>(),
    events = new Set<string>();
  for (const [id, a] of Object.entries(s.accounts)) {
    assertAccount(a, s.policy);
    check(
      id === a.id && !owners.has(a.ownerId) && !events.has(a.capture.populationEventId),
      'duplicate-estate-owner-or-population-source',
    );
    owners.add(a.ownerId);
    events.add(a.capture.populationEventId);
  }
}
export function assertEstateResponsibilitiesClear(reads: readonly EstateResponsibilityRead[]) {
  check(Array.isArray(reads), 'estate-responsibility-coverage-incomplete');
  check(
    reads.length === DOMAINS.length &&
      new Set(reads.map((r) => r.domain)).size === DOMAINS.length &&
      DOMAINS.every((d) => reads.some((r) => r.domain === d)),
    'estate-responsibility-coverage-incomplete',
  );
  for (const r of reads) {
    check(
      exact(r, ['domain', 'status', 'references']) &&
        r.status === 'observed' &&
        Array.isArray(r.references),
      'estate-responsibility-observation-unavailable',
    );
    check(
      r.references.every(
        (v) => exact(v, ['id', 'revision']) && validId(v.id) && positive(v.revision),
      ),
      'invalid-estate-responsibility-reference',
    );
    check(r.references.length === 0, 'estate-has-unsettled-responsibilities');
  }
}
export function applyEstateCashEvent(
  s: EstateCashState | undefined,
  e: EstateCashEvent,
): EstateCashState {
  if (e.type === 'EstateCashEnabled') {
    check(
      !s && (equal(e.policy, POLICY) || equal(e.policy, BANK_POLICY)),
      'invalid-estate-cash-activation',
    );
    return { policy: structuredClone(e.policy), accounts: {} };
  }
  if (!s) throw Error('estate-cash-not-enabled');
  let a: EstateCashAccount;
  if (e.type === 'EstateCashCaptured') {
    check(validId(e.id) && !s.accounts[e.id], 'estate-cash-account-already-exists');
    assertCapture(e.source);
    check(
      equal(e.transaction, captureTransaction(e.id, e.source)),
      'estate-capture-transaction-mismatch',
    );
    if (e.transaction) assertMoneySupplyDelta({ transaction: e.transaction, moneySupplyDelta: 0 });
    a = {
      id: e.id,
      ownerId: e.source.ownerId,
      revision: 1,
      status: 'held',
      balance: e.source.personalBalance,
      at: e.source.at,
      capture: structuredClone(e.source),
      settledSources: {},
    };
  } else {
    const old = s.accounts[e.id];
    if (!old) throw Error('estate-cash-account-not-found');
    check(
      old.status === 'held' &&
        old.revision === e.previousRevision &&
        Number.isSafeInteger(old.revision + 1) &&
        time(e.at) &&
        e.at >= old.at,
      'estate-cash-revision-or-status-conflict',
    );
    a = { ...structuredClone(old), revision: old.revision + 1, at: e.at };
    if (e.type === 'EstateCashClosed') {
      check(old.balance === 0, 'estate-cash-must-be-disposed-before-close');
      assertEstateResponsibilitiesClear(e.responsibilityReads);
      a = { ...a, status: 'closed' };
    } else {
      assertEstateCashSourceReference(e.source);
      check(
        e.source.context !== 'credit' || s.policy.version === BANK_POLICY.version,
        'estate-original-bank-scope-required',
      );
      assertMoneySupplyDelta({ transaction: e.transaction, moneySupplyDelta: 0 });
      const own = e.transaction.entries.filter((x) => x.account.sector === 'estate');
      check(
        own.length === 1 &&
          e.transaction.entries.length === 2 &&
          own[0]!.account.accountId === economicAccount('estate', e.id).accountId &&
          e.transaction.entries.some(
            (x) =>
              x.account.sector === (e.source.context === 'credit' ? 'bank' : 'public-service') &&
              x.account.accountId === SOURCES[e.source.context].accountId,
          ),
        'estate-only-owning-consumer-clearing-permitted',
      );
      check(validId(e.transaction.transactionId), 'invalid-estate-settlement-transaction-id');
      const key = sourceKey(e.source),
        prev = old.settledSources[key];
      check(!prev || e.source.revision > prev.revision, 'estate-owning-source-already-settled');
      const balance = commonAccountNextBalance(old.balance, own[0]!.amount, Number.MAX_VALUE);
      check(balance !== undefined, 'estate-cash-overdraft-or-money-range');
      if (balance === undefined) throw Error('estate-cash-overdraft-or-money-range');
      a = {
        ...a,
        balance,
        settledSources: {
          ...old.settledSources,
          [key]: { revision: e.source.revision, transactionId: e.transaction.transactionId },
        },
      };
    }
  }
  const next = { ...s, accounts: { ...s.accounts, [a.id]: a } };
  assertEstateCashState(next);
  return next;
}
function decide(s: EstateCashState, event: EstateCashEvent): EstateCashDecision {
  try {
    applyEstateCashEvent(s, event);
    return {
      accepted: true,
      events: [structuredClone(event)],
      transactions:
        event.type === 'EstateCashCaptured'
          ? event.transaction
            ? [event.transaction]
            : []
          : event.type === 'EstateCashSettled'
            ? [event.transaction]
            : [],
    };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-estate-cash-event',
    };
  }
}
/** Source must be read from the real pre-departure account and paired atomically with body departure by world. Not a resident CLI command. */
export function captureEstateCash(
  s: EstateCashState,
  id: string,
  source: EstateCashCaptureSource,
): EstateCashDecision {
  try {
    const transaction = captureTransaction(id, source);
    return decide(s, {
      type: 'EstateCashCaptured',
      id,
      source: structuredClone(source),
      ...(transaction ? { transaction } : {}),
    });
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-estate-capture',
    };
  }
}
/** Closed consumer adapter, not a generic withdrawal. World must independently verify the referenced real consumer settlement and exact same transaction. */
export function settleEstateCash(
  s: EstateCashState,
  input: Omit<Extract<EstateCashEvent, { type: 'EstateCashSettled' }>, 'type'>,
): EstateCashDecision {
  return decide(s, { type: 'EstateCashSettled', ...structuredClone(input) });
}
export function closeEstateCash(
  s: EstateCashState,
  input: Omit<Extract<EstateCashEvent, { type: 'EstateCashClosed' }>, 'type'>,
): EstateCashDecision {
  return decide(s, { type: 'EstateCashClosed', ...structuredClone(input) });
}
export const estateCashBalance = (s: EstateCashState | undefined) =>
  Object.values(s?.accounts ?? {}).reduce((n, a) => n + a.balance, 0);
