import { createMoneyTransfer, economicAccount, type AccountingTransaction } from './accounting';
import {
  assertCommonAccountsPolicy,
  commonAccountId,
  emptyCommonAccountsState,
  type CommonAccount,
  type CommonAccountCommand,
  type CommonAccountDecision,
  type CommonAccountEvent,
  type CommonAccountPorts,
  type CommonAccountReceipt,
  type CommonAccountsState,
} from './commonAccountModel';
const no = (reason: string): CommonAccountDecision => ({ accepted: false, reason });
/** Reject unrepresentable deltas rather than silently rounding one side away. */
export function commonAccountNextBalance(
  balance: number,
  delta: number,
  max: number,
): number | undefined {
  const next = balance + delta;
  return Number.isFinite(balance) &&
    balance >= 0 &&
    Number.isFinite(delta) &&
    Number.isFinite(next) &&
    next >= 0 &&
    next <= max &&
    (delta === 0 || next !== balance) &&
    Math.abs(next - balance - delta) <= 1e-8
    ? next
    : undefined;
}
export function decideCommonAccount(input: {
  state: CommonAccountsState;
  actorId: string;
  at: number;
  requestId: string;
  command: CommonAccountCommand;
  ports: CommonAccountPorts;
}): CommonAccountDecision {
  const { state: s, actorId, at, requestId, command: c, ports } = input;
  assertCommonAccountsPolicy(s.policy);
  if (
    !commonAccountId(actorId) ||
    ports.residentBalance(actorId) === undefined ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !commonAccountId(c.id) ||
    !commonAccountId(requestId)
  )
    return no('invalid-common-account-command');
  if (Object.hasOwn(s.receipts, requestId)) return no('duplicate-common-account-receipt');
  const changes: CommonAccount[] = [];
  let transaction: AccountingTransaction | undefined;
  const accountIds = [c.id];
  if (c.type === 'open') {
    if (Object.hasOwn(s.accounts, c.id)) return no('common-account-already-exists');
    if (!commonAccountId(c.collectiveId) || !ports.isMember(c.collectiveId, actorId))
      return no('active-collective-member-required');
    if (typeof c.title !== 'string' || !c.title.trim() || c.title.length > 120)
      return no('invalid-common-account-title');
    if (
      Object.values(s.accounts).filter((a) => a.collectiveId === c.collectiveId).length >=
      s.policy.maxAccountsPerCollective
    )
      return no('common-account-quota-exceeded');
    changes.push({
      id: c.id,
      collectiveId: c.collectiveId,
      title: c.title,
      balance: 0,
      revision: 1,
      controlVersion: 1,
      status: 'open',
      createdBy: actorId,
      at,
    });
  } else {
    const a = s.accounts[c.id];
    if (!a) return no('common-account-not-found');
    if (!Number.isSafeInteger(a.revision + 1) || !Number.isSafeInteger(a.controlVersion + 1))
      return no('common-account-version-exhausted');
    if (c.type === 'contribute') {
      if (a.status !== 'open') return no('common-account-not-receiving');
      if (a.revision !== c.expectedRevision) return no('revision-conflict');
      if (
        !Number.isFinite(c.amount) ||
        c.amount <= 0 ||
        c.amount > s.policy.maxTransfer ||
        typeof c.note !== 'string' ||
        c.note.length > s.policy.maxNoteChars
      )
        return no('invalid-common-account-transfer');
      const next = commonAccountNextBalance(
          a.balance,
          c.amount,
          s.policy.maxBalance - (ports.reservedIncoming?.(a.id) ?? 0),
        ),
        payer = ports.residentBalance(actorId)!;
      if (payer < c.amount) return no('insufficient-personal-balance');
      if (
        next === undefined ||
        commonAccountNextBalance(payer, -c.amount, Number.MAX_VALUE) === undefined
      )
        return no('unrepresentable-common-account-transfer');
      changes.push({ ...a, balance: next, revision: a.revision + 1 });
      transaction = createMoneyTransfer({
        transactionId: requestId,
        reason: 'common-account-contribution',
        from: economicAccount('agent', actorId),
        to: economicAccount('collective', a.id),
        amount: c.amount,
      });
    } else {
      if (
        !commonAccountId(c.authority.decisionId) ||
        c.authority.collectiveId !== a.collectiveId ||
        !Number.isSafeInteger(c.authority.charterVersion) ||
        c.authority.charterVersion < 1 ||
        !Number.isSafeInteger(c.authority.decisionRevision) ||
        c.authority.decisionRevision < 1
      )
        return no('exact-collective-authority-required');
      if (a.controlVersion !== c.controlVersion)
        return no('common-account-control-version-conflict');
      if (a.status === 'closed') return no('common-account-closed');
      if (c.type === 'transfer') {
        if (
          !Number.isFinite(c.amount) ||
          c.amount <= 0 ||
          c.amount > s.policy.maxTransfer ||
          typeof c.note !== 'string' ||
          c.note.length > s.policy.maxNoteChars ||
          !commonAccountId(c.recipient.id)
        )
          return no('invalid-common-account-transfer');
        if (a.balance < c.amount) return no('insufficient-common-account-balance');
        const next = commonAccountNextBalance(a.balance, -c.amount, s.policy.maxBalance);
        if (next === undefined) return no('unrepresentable-common-account-transfer');
        if (c.recipient.sector === 'collective') {
          const other = s.accounts[c.recipient.id];
          if (!other || other.status !== 'open' || other.id === a.id)
            return no('invalid-recipient-account');
          const received = commonAccountNextBalance(
            other.balance,
            c.amount,
            s.policy.maxBalance - (ports.reservedIncoming?.(other.id) ?? 0),
          );
          if (received === undefined || !Number.isSafeInteger(other.revision + 1))
            return no('unrepresentable-common-account-transfer');
          changes.push({ ...other, balance: received, revision: other.revision + 1 });
          accountIds.push(other.id);
        } else {
          const balance = ports.recipientBalance(c.recipient);
          if (balance === undefined) return no('recipient-not-available');
          if (commonAccountNextBalance(balance, c.amount, Number.MAX_VALUE) === undefined)
            return no('unrepresentable-common-account-transfer');
        }
        changes.push({ ...a, balance: next, revision: a.revision + 1 });
        transaction = createMoneyTransfer({
          transactionId: requestId,
          reason: 'common-account-authorized-transfer',
          from: economicAccount('collective', a.id),
          to: economicAccount(c.recipient.sector, c.recipient.id),
          amount: c.amount,
        });
      } else if (c.type === 'beginSettlement') {
        if (a.status !== 'open') return no('common-account-already-settling');
        changes.push({
          ...a,
          status: 'settling',
          revision: a.revision + 1,
          controlVersion: a.controlVersion + 1,
        });
      } else {
        if (a.status !== 'settling') return no('common-account-settlement-required');
        if (a.balance !== 0 || ports.unresolvedObligations(a.id))
          return no('common-account-not-settled');
        changes.push({
          ...a,
          status: 'closed',
          revision: a.revision + 1,
          controlVersion: a.controlVersion + 1,
        });
      }
    }
  }
  // Admission limits must never lock existing money by preventing withdrawal or closure.
  const creditedAccounts =
    transaction?.entries
      .filter((e) => e.account.sector === 'collective' && e.amount > 0)
      .map((e) => e.account.accountId) ?? [];
  if (
    creditedAccounts.some(
      (id) =>
        Object.values(s.receipts).filter((r) =>
          r.transaction?.entries.some((e) => e.account.accountId === id && e.amount > 0),
        ).length >= s.policy.maxFundingReceiptsPerAccount,
    )
  )
    return no('common-account-funding-quota-exceeded');
  const receipt: CommonAccountReceipt = {
    id: requestId,
    actorId,
    accountIds,
    accountRevisions: Object.fromEntries(changes.map((a) => [a.id, a.revision])),
    at,
    operation: c.type,
    note: 'note' in c ? c.note : '',
    ...('authority' in c ? { authority: { ...c.authority } } : {}),
    ...(transaction ? { transaction } : {}),
  };
  return {
    accepted: true,
    events: [
      ...changes.map((account) => ({ type: 'CommonAccountChanged' as const, account })),
      { type: 'CommonAccountReceiptRecorded', receipt },
    ],
    transactions: transaction ? [transaction] : [],
  };
}
export function applyCommonAccountEvent(
  s: CommonAccountsState | undefined,
  e: CommonAccountEvent,
): CommonAccountsState {
  if (e.type === 'CommonAccountsEnabled') {
    if (s) throw new Error('common-accounts-already-enabled');
    return emptyCommonAccountsState(e.policy);
  }
  if (!s) throw new Error('common-accounts-not-enabled');
  if (e.type === 'CommonAccountReceiptRecorded') {
    if (
      e.receipt.accountIds.some((id) => s.accounts[id]?.revision !== e.receipt.accountRevisions[id])
    )
      throw new Error('common-account-receipt-version-mismatch');
    if (Object.hasOwn(s.receipts, e.receipt.id))
      throw new Error('duplicate-common-account-receipt');
    return { ...s, receipts: { ...s.receipts, [e.receipt.id]: e.receipt } };
  }
  const a = e.account;
  if (a.revision !== (s.accounts[a.id]?.revision ?? 0) + 1)
    throw new Error('common-account-revision-gap');
  if (!Number.isFinite(a.balance) || a.balance < 0 || a.balance > s.policy.maxBalance)
    throw new Error('invalid-common-account-balance');
  return { ...s, accounts: { ...s.accounts, [a.id]: a } };
}
