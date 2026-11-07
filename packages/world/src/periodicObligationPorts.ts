import { residentPhysicalFinancialAccount } from './residentExitPreservation';
import type { PeriodicPorts, PeriodicAccount, PeriodicAccountFacts } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  authorizeWorldPrincipalOperation,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import { residentEscrowIncoming } from './residentEscrowAccounting';
/** Current owning account facts only. Current management is required for new actions, never impersonated by due settlement. */
export function worldPeriodicAccount(
  w: WorldProjection,
  account: PeriodicAccount,
): PeriodicAccountFacts | undefined {
  if (account.sector === 'agent') {
    const a = residentPhysicalFinancialAccount(w, account.id);
    return a
      ? {
          account,
          principal: { kind: 'resident', id: account.id },
          balance: a.balance,
          status: a.acceptsNewObligations ? 'open' : 'settling',
          maximumBalance: Number.MAX_VALUE,
        }
      : undefined;
  }
  if (account.sector === 'enterprise') {
    const e = w.enterprises[account.id];
    return e
      ? {
          account,
          principal: { kind: 'enterprise', id: account.id },
          balance: e.balance,
          status: e.status === 'active' ? 'open' : e.status === 'closed' ? 'closed' : 'settling',
          maximumBalance: Number.MAX_VALUE,
        }
      : undefined;
  }
  if (account.sector === 'collective') {
    const a = w.commonAccounts?.accounts[account.id];
    return a
      ? {
          account,
          principal: { kind: 'collective', id: a.collectiveId },
          balance: a.balance,
          status: a.status,
          maximumBalance: Math.max(
            0,
            w.commonAccounts.policy.maxBalance - residentEscrowIncoming(w, a.id),
          ),
        }
      : undefined;
  }
  const grant = w.publicGovernance?.authority.grant;
  return account.id === 'public-treasury' && grant?.periodicObligations
    ? {
        account,
        principal: { kind: 'public', id: grant.id },
        balance: Math.max(
          0,
          (w.treasury ?? 0) - (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0),
        ),
        status: 'open',
        maximumBalance: Number.MAX_VALUE,
      }
    : undefined;
}
export function periodicObligationPorts(
  w: WorldProjection,
  actorId: string,
  collective?: PrincipalCollectivePort,
  execution?: PublicPrincipalExecution,
): PeriodicPorts {
  return {
    exists: (id) => Object.hasOwn(w.agents, id),
    account: (a) => worldPeriodicAccount(w, a),
    authorize: (p, r) => authorizeWorldPrincipalOperation(w, actorId, p, r, execution, collective),
  };
}
