import type { CapitalAccount } from '@aivilization/enterprise';
import type { OpenSocietyState } from './types';
import { controllerVisibleTo } from './resourceControlAccess';
export const capitalAccountVisibleTo = (s: OpenSocietyState, a: CapitalAccount, actor: string) =>
  a.sector === 'agent'
    ? a.id === actor
    : !!s.world.commonAccounts?.accounts[a.id] &&
      controllerVisibleTo(
        s,
        { kind: 'collective', id: s.world.commonAccounts.accounts[a.id]!.collectiveId },
        actor,
      );
