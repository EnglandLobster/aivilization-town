import {
  decideCommonAccount,
  type AccountingTransaction,
  type CommonAccountAuthority,
  type CommonAccountCommand,
  type CommonAccountEvent,
  type CommonAccountResourceOperation,
  type CommonAccountsPolicy,
} from '@aivilization/economy';
import { decideFundEnterprise, type EnterpriseDomainEvent } from '@aivilization/enterprise';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
export type ResidentCommonAccountsPayload = {
  readonly policyVersion: 'resident-common-accounts-v1';
  readonly events: readonly CommonAccountEvent[];
  readonly transactions: readonly AccountingTransaction[];
  readonly enterpriseFunding: readonly {
    readonly enterpriseId: string;
    readonly event: Extract<EnterpriseDomainEvent, { type: 'EnterpriseFunded' }>;
  }[];
};
export type ResidentCommonAccountCommand =
  | Extract<CommonAccountCommand, { type: 'open' | 'contribute' }>
  | CommonAccountResourceOperation;
/** Application-owned authorization port. No resident-facing boolean or caller-supplied authority. */
export type CommonAccountAuthorizationPort = {
  readonly isActiveMember: (collectiveId: string, actorId: string) => boolean;
  readonly authorize: (
    command: CommonAccountResourceOperation,
    collectiveId: string,
  ) => { accepted: true; authority: CommonAccountAuthority } | { accepted: false; reason: string };
  readonly unresolvedObligations: (accountId: string) => boolean;
};
export function residentCommonAccountEvent(input: {
  projection: WorldProjection;
  actorId: string;
  command: ResidentCommonAccountCommand;
  authorization: CommonAccountAuthorizationPort;
  requestId: string;
  receiptId: string;
  simulationId: string;
  nextSequence: number;
}): { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string } {
  const { projection: w, command: cmd } = input,
    s = w.commonAccounts;
  if (!s) return { accepted: false, reason: 'common-accounts-not-enabled' };
  let command: CommonAccountCommand;
  if (cmd.type === 'open' || cmd.type === 'contribute') command = cmd;
  else {
    const account = s.accounts[cmd.id];
    if (!account) return { accepted: false, reason: 'common-account-not-found' };
    const auth = input.authorization.authorize(cmd, account.collectiveId);
    if (!auth.accepted) return auth;
    command = { ...cmd, authority: auth.authority };
  }
  const d = decideCommonAccount({
    state: s,
    actorId: input.actorId,
    at: w.clock.now,
    requestId: input.receiptId,
    command,
    ports: {
      isMember: input.authorization.isActiveMember,
      residentBalance: (id) => w.agents[id]?.balance,
      recipientBalance: (r) =>
        r.sector === 'agent'
          ? w.agents[r.id]?.balance
          : r.sector === 'treasury'
            ? r.id === 'public-treasury'
              ? w.treasury
              : undefined
            : r.sector === 'enterprise' &&
                w.enterprises[r.id] &&
                !['closed', 'bankrupt'].includes(w.enterprises[r.id]!.status)
              ? w.enterprises[r.id]!.balance
              : undefined,
      unresolvedObligations: (id) => input.authorization.unresolvedObligations(id),
    },
  });
  if (!d.accepted) return d;
  const enterpriseFunding: ResidentCommonAccountsPayload['enterpriseFunding'][number][] = [];
  if (command.type === 'transfer' && command.recipient.sector === 'enterprise') {
    const enterprise = w.enterprises[command.recipient.id];
    if (!enterprise) return { accepted: false, reason: 'recipient-not-available' };
    const funding = decideFundEnterprise({ enterprise, amount: command.amount });
    if (funding.status === 'rejected') return { accepted: false, reason: funding.reason };
    for (const event of funding.events) {
      if (event.type !== 'EnterpriseFunded')
        throw new Error('unexpected-enterprise-funding-effect');
      enterpriseFunding.push({ enterpriseId: enterprise.enterpriseId, event });
    }
  }
  return {
    accepted: true,
    events: [
      createEventEnvelope({
        id: input.requestId + ':common-accounts',
        simulationId: input.simulationId,
        type: 'ResidentCommonAccountsCommitted',
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        payload: {
          policyVersion: 'resident-common-accounts-v1' as const,
          events: d.events,
          transactions: d.transactions,
          enterpriseFunding,
        },
      }),
    ],
  };
}
export function enableCommonAccountsEvent(input: {
  simulationId: string;
  requestId: string;
  nextSequence: number;
  at: number;
  policy: CommonAccountsPolicy;
}): WorldEvent {
  return createEventEnvelope({
    id: input.requestId + ':common-accounts-enabled',
    simulationId: input.simulationId,
    type: 'ResidentCommonAccountsCommitted',
    sequence: input.nextSequence,
    occurredAt: input.at,
    payload: {
      policyVersion: 'resident-common-accounts-v1' as const,
      events: [{ type: 'CommonAccountsEnabled' as const, policy: input.policy }],
      transactions: [],
      enterpriseFunding: [],
    },
  });
}
