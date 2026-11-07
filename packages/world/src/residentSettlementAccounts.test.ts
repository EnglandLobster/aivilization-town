import { expect, test } from 'vitest';
import { createMoneyTransfer, economicAccount, applyEstateCashEvent } from '@aivilization/economy';
import { applyWorldEvent } from './projection';
import { residentExitFixture, capturedResidentDeparture } from './testFixtures/residentExit';
import {
  resolveResidentSettlementAccounts,
  assertResidentSettlementAccountResolution,
} from './residentSettlementAccounts';
const payment = () =>
  createMoneyTransfer({
    transactionId: 'original-paid-period',
    reason: 'periodic-obligation-paid',
    from: economicAccount('agent', 'a'),
    to: economicAccount('public-service', 'resident-periodic-obligations'),
    amount: 2,
  });
const departed = () => {
  const w = residentExitFixture();
  return applyWorldEvent(w, capturedResidentDeparture(w));
};
test('living subjects retain the original ledger and no estate mapping, without inventing an account revision or authority', () => {
  const w = residentExitFixture(),
    raw = [payment()],
    r = resolveResidentSettlementAccounts(w, raw);
  expect(r.mappings).toEqual([]);
  expect(r.transactions).toEqual(raw);
  expect(r).not.toHaveProperty('authority');
  assertResidentSettlementAccountResolution(w, raw, r);
});
test('an original contract subject resolves to its actual preserved account, with current cash revision and real population reference; this read moves no money', () => {
  const w = departed(),
    raw = [payment()],
    before = structuredClone(w),
    r = resolveResidentSettlementAccounts(w, raw);
  expect(r.mappings).toEqual([
    {
      residentId: 'a',
      original: economicAccount('agent', 'a'),
      physical: economicAccount('estate', 'estate-10'),
      populationEventId: 'actual-death-a',
      estateRevision: 1,
    },
  ]);
  expect(r.transactions[0]?.entries[0]).toEqual({
    account: economicAccount('estate', 'estate-10'),
    amount: -2,
  });
  expect(r.transactions[0]?.entries[1]).toEqual(raw[0]?.entries[1]);
  expect(r.transactions[0]?.transactionId).toBe(raw[0]?.transactionId);
  expect(w).toEqual(before);
  expect(raw[0]?.entries[0]?.account.sector).toBe('agent');
  assertResidentSettlementAccountResolution(w, raw, r);
});
test('a forged population reference, physical destination, amount or unknown field cannot replace an owning-account read', () => {
  const w = departed(),
    raw = [payment()],
    r = resolveResidentSettlementAccounts(w, raw);
  for (const fake of [
    { ...r, mappings: [{ ...r.mappings[0]!, populationEventId: 'fake' }] },
    {
      ...r,
      mappings: [{ ...r.mappings[0]!, physical: economicAccount('estate', 'someone-else') }],
    },
    {
      ...r,
      transactions: [
        createMoneyTransfer({
          transactionId: 'original-paid-period',
          reason: 'periodic-obligation-paid',
          from: economicAccount('estate', 'estate-10'),
          to: economicAccount('public-service', 'resident-periodic-obligations'),
          amount: 3,
        }),
      ],
    },
    { ...r, authority: { kind: 'resident', id: 'a' } },
  ])
    expect(() => assertResidentSettlementAccountResolution(w, raw, fake)).toThrow(
      'physical-account-proof-mismatch',
    );
});
test('a subsequent real cash-domain event invalidates a saved physical-account proof, without pretending that an original deceased person authorized another action', () => {
  const w = departed(),
    raw = [payment()],
    r = resolveResidentSettlementAccounts(w, raw),
    s = w.residentExits!;
  const transaction = r.transactions[0]!;
  const cash = applyEstateCashEvent(s.cash, {
    type: 'EstateCashSettled',
    id: 'estate-10',
    previousRevision: 1,
    at: 0,
    source: {
      context: 'periodic-obligations',
      id: 'existing-contract',
      revision: 1,
      policyVersion: 'resident-periodic-obligations-v1',
    },
    transaction,
  });
  const next = { ...w, residentExits: { ...s, cash } };
  expect(() => assertResidentSettlementAccountResolution(next, raw, r)).toThrow(
    'physical-account-proof-mismatch',
  );
  expect(resolveResidentSettlementAccounts(next, raw).mappings[0]?.estateRevision).toBe(2);
});
test('a closed consumer must supply its original economic ledger; direct estate input, duplicate transactions, malformed account identity and absent subjects are rejected', () => {
  const w = departed(),
    raw = payment();
  expect(() => resolveResidentSettlementAccounts(w, [raw, raw])).toThrow('duplicate-transaction');
  const direct = createMoneyTransfer({
    transactionId: 'direct-withdrawal',
    reason: 'unsupported',
    from: economicAccount('estate', 'estate-10'),
    to: economicAccount('public-service', 'resident-periodic-obligations'),
    amount: 2,
  });
  expect(() => resolveResidentSettlementAccounts(w, [direct])).toThrow('must-be-resolved');
  expect(() =>
    resolveResidentSettlementAccounts(w, [
      {
        ...raw,
        entries: [
          { ...raw.entries[0]!, account: { sector: 'agent', accountId: 'treasury:a' } },
          raw.entries[1]!,
        ],
      },
    ]),
  ).toThrow('original-account-mismatch');
  expect(() =>
    resolveResidentSettlementAccounts(w, [
      createMoneyTransfer({
        transactionId: 'unknown-subject',
        reason: 'unsupported',
        from: economicAccount('agent', 'unknown'),
        to: economicAccount('public-service', 'resident-periodic-obligations'),
        amount: 2,
      }),
    ]),
  ).toThrow('original-subject-unavailable');
});
