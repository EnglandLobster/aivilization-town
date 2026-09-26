import {
  applyCommunicationEvent,
  canReadGroup,
  communicationBlocked,
  decideCommunication,
  type CommunicationCommand,
} from '@aivilization/information';
import { stringArg, numberArg, pageItems, ToolRefusal } from './arguments';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
import { digest } from './journal';
export function executeCommunicationTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const s = state.communication;
  if (!s) throw new ToolRefusal('communication-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  const id = stringArg(args, 'id');
  const groupId = stringArg(args, 'groupId');
  if (name === 'notifications.settings')
    return result(s.preferences[actorId] ?? { directWake: true, subscriptionContext: true });
  if (name === 'blocks.list') return result(pageItems(s.blocked[actorId] ?? [], args));
  if (name === 'groups.list')
    return result(
      pageItems(
        Object.values(s.groups)
          .filter((g) => g.members.includes(actorId))
          .map(({ members, ...g }) => ({ ...g, memberCount: members.length })),
        args,
      ),
    );
  if (name === 'groups.invitations')
    return result(
      pageItems(
        Object.values(s.invitations)
          .filter((i) => i.residentId === actorId || s.groups[i.groupId]?.ownerId === actorId)
          .map((i) => ({
            ...i,
            groupRevision: s.groups[i.groupId]!.revision,
            groupTitle: s.groups[i.groupId]!.title,
            groupClosed: s.groups[i.groupId]!.closed,
          })),
        args,
      ),
    );
  if (name === 'groups.members' || name === 'groups.messages') {
    if (!canReadGroup(s, actorId, groupId)) throw new ToolRefusal('member-required');
    if (name === 'groups.members') return result(pageItems(s.groups[groupId]!.members, args));
    const data = pageItems(
      Object.values(s.messages)
        .filter((m) => m.groupId === groupId && !communicationBlocked(s, actorId, m.authorId))
        .sort((a, b) => b.sequence - a.sequence),
      args,
    );
    const decision = decideCommunication({
      state: s,
      actorId,
      at: state.world.clock.now,
      command: { type: 'read', messageIds: data.items.map((m) => m.id) },
      exists: (id) => Object.hasOwn(state.residents, id),
    });
    if (!decision.accepted) throw new ToolRefusal(decision.reason);
    return { data, effects: { communicationEvents: decision.events } };
  }

  const operation = name.split('.')[1];
  const unique = `comm-${digest([actorId, requestId]).slice(0, 32)}`;
  let command: CommunicationCommand;
  if (name === 'blocks.add' || name === 'blocks.remove')
    command = {
      type: operation === 'add' ? 'block' : 'unblock',
      targetId: stringArg(args, 'targetId'),
    };
  else if (name === 'notifications.configure')
    command = {
      type: 'preferences',
      directWake: args.directWake === true,
      subscriptionContext: args.subscriptionContext === true,
    };
  else if (operation === 'create')
    command = { type: 'create', id, title: stringArg(args, 'title') };
  else if (operation === 'invite' || operation === 'join-request')
    command = {
      type: operation,
      id: unique,
      groupId,
      residentId: stringArg(args, 'residentId', actorId),
    };
  else if (operation === 'accept' || operation === 'reject')
    command = { type: operation, id, expectedRevision: numberArg(args, 'expectedRevision') };
  else if (operation === 'send')
    command = { type: 'send', id: unique, groupId, content: stringArg(args, 'content') };
  else if (operation === 'leave' || operation === 'close' || operation === 'transfer')
    command = {
      type: operation,
      groupId,
      expectedRevision: numberArg(args, 'expectedRevision'),
      ...(args.targetId === undefined ? {} : { targetId: stringArg(args, 'targetId') }),
    };
  else throw new ToolRefusal('unknown-communication-command');
  const decision = decideCommunication({
    state: s,
    actorId,
    at: state.world.clock.now,
    command,
    exists: (id) => Object.hasOwn(state.residents, id),
  });
  if (!decision.accepted) throw new ToolRefusal(decision.reason);
  const after = decision.events.reduce(applyCommunicationEvent, s);
  const event = decision.events[0];
  const data =
    event && 'invitation' in event
      ? event.invitation
      : event && 'message' in event
        ? event.message
        : event && 'group' in event
          ? after.groups[event.group.id]
          : { changed: decision.events.length > 0 };
  return { data, effects: { communicationEvents: decision.events } };
}
