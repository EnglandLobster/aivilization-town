import { enterpriseController } from '@aivilization/enterprise';
import type { Controller } from '@aivilization/authority';
import type { WorldProjection } from './projection';

/** Current organizational account authority. Estate cash resolution is a separate protocol. */
export function residentFinancialAccount(
  w: WorldProjection,
  account: { readonly sector: 'agent' | 'collective' | 'enterprise'; readonly id: string },
):
  | {
      readonly controller: Controller;
      readonly balance: number;
      readonly status: 'open' | 'settling';
    }
  | undefined {
  if (account.sector === 'enterprise') {
    const e = w.serviceEmployment && w.enterprises[account.id];
    return e && e.status !== 'closed'
      ? {
          controller: enterpriseController(e),
          balance: e.balance,
          status: e.status === 'bankrupt' ? 'settling' : 'open',
        }
      : undefined;
  }
  if (account.sector === 'agent') {
    const a = w.agents[account.id];
    return a
      ? { controller: { kind: 'resident', id: account.id }, balance: a.balance, status: 'open' }
      : undefined;
  }
  const a = w.commonAccounts?.accounts[account.id];
  return a && a.status !== 'closed'
    ? {
        controller: { kind: 'collective', id: a.collectiveId },
        balance: a.balance,
        status: a.status,
      }
    : undefined;
}
