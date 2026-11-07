import { effectiveController } from '@aivilization/authority';
import type { GroupInvitation } from '@aivilization/information';
import { controllerVisibleTo } from './resourceControlAccess';
import type { OpenSocietyState } from './types';

/** Collective membership permits administration metadata, never private group messages. */
export function canReadGroupInvitation(
  state: OpenSocietyState,
  invitation: GroupInvitation,
  actorId: string,
): boolean {
  const group = state.communication?.groups[invitation.groupId];
  return (
    invitation.residentId === actorId ||
    invitation.invitedBy === actorId ||
    (!!group && controllerVisibleTo(state, effectiveController(group), actorId))
  );
}
