import {
  personallyControls,
  resourceAdministration,
  revisedResourceControl,
  initialResourceControl,
  type ResourceControl,
  type ResourceControlPolicy,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { validInformationId } from './model';

export const GROUP_CONTROL_POLICY = { version: 'resident-group-control-v1' } as const;
export type GroupControlPolicy = typeof GROUP_CONTROL_POLICY;
export function assertGroupControlPolicy(p: GroupControlPolicy) {
  if (p.version !== GROUP_CONTROL_POLICY.version) throw new Error('invalid-group-control-policy');
}

export const COMMUNICATION_POLICY = {
  version: 'communication-v1',
  maxMembers: 100,
  maxText: 8000,
  maxGroups: 30,
} as const;
export type CommunicationPolicy = {
  readonly version: 'communication-v1';
  readonly maxMembers: number;
  readonly maxText: number;
  readonly maxGroups: number;
};
export function assertCommunicationPolicy(p: CommunicationPolicy) {
  if (
    p.version !== 'communication-v1' ||
    [p.maxMembers, p.maxText, p.maxGroups].some((n) => !Number.isSafeInteger(n) || n < 1)
  )
    throw new Error('invalid-communication-policy');
}
export type ResidentGroup = {
  readonly control?: ResourceControl;
  id: string;
  ownerId: string;
  title: string;
  members: readonly string[];
  revision: number;
  closed: boolean;
  at: number;
};
export type GroupInvitation = {
  readonly invitedBy?: string;
  readonly resolvedBy?: string;
  readonly resolvedAt?: number;
  readonly resolution?:
    | 'recipient-accepted'
    | 'recipient-rejected'
    | 'controller-accepted'
    | 'controller-rejected'
    | 'controller-withdrew'
    | 'request-withdrawn'
    | 'controller-transfer'
    | 'group-closed';
  id: string;
  groupId: string;
  residentId: string;
  kind: 'invite' | 'request';
  status: 'pending' | 'accepted' | 'rejected';
  at: number;
};
export type GroupMessage = {
  id: string;
  groupId: string;
  authorId: string;
  content: string;
  at: number;
  sequence: number;
};
export type CommunicationState = {
  readonly groupControlPolicy?: GroupControlPolicy;
  policy: CommunicationPolicy;
  groups: Readonly<Record<string, ResidentGroup>>;
  invitations: Readonly<Record<string, GroupInvitation>>;
  messages: Readonly<Record<string, GroupMessage>>;
  blocked: Readonly<Record<string, readonly string[]>>;
  preferences: Readonly<Record<string, { directWake: boolean; subscriptionContext: boolean }>>;
  sequence: number;
  readMessageIds?: Readonly<Record<string, readonly string[]>>;
};
export type CommunicationEvent =
  | { type: 'GroupControlEnabled'; policy: GroupControlPolicy }
  | { type: 'CommunicationEnabled'; policy: CommunicationPolicy }
  | { type: 'GroupChanged'; group: ResidentGroup }
  | { type: 'GroupInvitationChanged'; invitation: GroupInvitation }
  | { type: 'GroupMessageSent'; message: GroupMessage }
  | { type: 'GroupMessagesRead'; ownerId: string; messageIds: readonly string[] }
  | { type: 'ResidentBlockChanged'; ownerId: string; targets: readonly string[] }
  | {
      type: 'CommunicationPreferenceChanged';
      ownerId: string;
      directWake: boolean;
      subscriptionContext: boolean;
    };
export type CommunicationCommand =
  | { type: 'withdraw-invitation' | 'withdraw-request'; id: string; expectedRevision: number }
  | { type: 'create'; id: string; title: string }
  | { type: 'invite' | 'join-request'; id: string; groupId: string; residentId: string }
  | { type: 'accept' | 'reject'; id: string; expectedRevision: number }
  | {
      type: 'leave' | 'close' | 'transfer';
      groupId: string;
      expectedRevision: number;
      targetId?: string;
    }
  | { type: 'send'; id: string; groupId: string; content: string }
  | { type: 'block' | 'unblock'; targetId: string }
  | { type: 'preferences'; directWake: boolean; subscriptionContext: boolean }
  | { type: 'read'; messageIds: readonly string[] };
export function emptyCommunicationState(
  policy: CommunicationPolicy = COMMUNICATION_POLICY,
  groupControlPolicy?: GroupControlPolicy,
): CommunicationState {
  assertCommunicationPolicy(policy);
  if (groupControlPolicy) assertGroupControlPolicy(groupControlPolicy);
  return {
    ...(groupControlPolicy ? { groupControlPolicy } : {}),
    policy,
    groups: {},
    invitations: {},
    messages: {},
    blocked: {},
    preferences: {},
    sequence: 0,
  };
}
export function communicationBlocked(
  state: CommunicationState | undefined,
  receiver: string,
  sender: string,
) {
  return state?.blocked[receiver]?.includes(sender) ?? false;
}
export function canReadGroup(state: CommunicationState, actorId: string, groupId: string) {
  return state.groups[groupId]?.members.includes(actorId) ?? false;
}
export function decideCommunication(input: {
  state: CommunicationState;
  actorId: string;
  at: number;
  command: CommunicationCommand;
  exists: (id: string) => boolean;
  controlAuthorization?: ControlAuthorizationPort;
  resourceControlPolicy?: ResourceControlPolicy;
}):
  | { accepted: true; events: readonly CommunicationEvent[] }
  | { accepted: false; reason: string } {
  const { state: s, actorId: a, at, command: c, exists } = input;
  assertCommunicationPolicy(s.policy);
  const no = (reason: string) => ({ accepted: false as const, reason });
  const yes = (...events: CommunicationEvent[]) => ({ accepted: true as const, events });
  if (!exists(a) || !Number.isSafeInteger(at) || at < 0) return no('invalid-actor-or-time');
  if (c.type === 'read') {
    if (
      c.messageIds.length > 100 ||
      c.messageIds.some((id) => {
        const m = s.messages[id];
        return !m || !canReadGroup(s, a, m.groupId) || communicationBlocked(s, a, m.authorId);
      })
    )
      return no('message-not-readable');
    const seen = new Set(s.readMessageIds?.[a] ?? []);
    const messageIds = [...new Set(c.messageIds)].filter((id) => !seen.has(id));
    return messageIds.length ? yes({ type: 'GroupMessagesRead', ownerId: a, messageIds }) : yes();
  }
  if (c.type === 'block' || c.type === 'unblock') {
    if (!exists(c.targetId) || a === c.targetId) return no('invalid-block-target');
    const targets = new Set(s.blocked[a] ?? []);
    if (c.type === 'block') targets.add(c.targetId);
    else targets.delete(c.targetId);
    return yes({ type: 'ResidentBlockChanged', ownerId: a, targets: [...targets].sort() });
  }
  if (c.type === 'preferences')
    return yes({
      type: 'CommunicationPreferenceChanged',
      ownerId: a,
      directWake: c.directWake,
      subscriptionContext: c.subscriptionContext,
    });
  if (c.type === 'create') {
    if (s.groupControlPolicy && !input.resourceControlPolicy)
      return no('resource-control-not-enabled');
    if (!validInformationId(c.id) || Object.hasOwn(s.groups, c.id))
      return no('invalid-or-existing-group');
    if (!c.title.trim() || c.title.length > 120) return no('invalid-title');
    if (
      Object.values(s.groups).filter((g) => personallyControls(g, a) && !g.closed).length >=
      s.policy.maxGroups
    )
      return no('group-limit');
    return yes({
      type: 'GroupChanged',
      group: {
        id: c.id,
        title: c.title,
        ownerId: a,
        members: [a],
        revision: 1,
        closed: false,
        at,
        ...(s.groupControlPolicy && input.resourceControlPolicy
          ? { control: initialResourceControl(a, at, input.resourceControlPolicy) }
          : {}),
      },
    });
  }
  if (c.type === 'withdraw-invitation' || c.type === 'withdraw-request') {
    if (!s.groupControlPolicy) return no('group-control-not-enabled');
    const i = s.invitations[c.id],
      g = i ? s.groups[i.groupId] : undefined;
    if (!i || !g) return no('invitation-not-found');
    if (i.status !== 'pending') return no('invitation-already-resolved');
    if (g.revision !== c.expectedRevision) return no('revision-conflict');
    if (
      c.type === 'withdraw-request'
        ? i.kind !== 'request' || i.residentId !== a
        : i.kind !== 'invite' || !resourceAdministration(g, a, input.controlAuthorization)
    )
      return no('invitation-not-yours');
    return yes({
      type: 'GroupInvitationChanged',
      invitation: {
        ...i,
        status: 'rejected',
        resolvedBy: a,
        resolvedAt: at,
        resolution: c.type === 'withdraw-request' ? 'request-withdrawn' : 'controller-withdrew',
      },
    });
  }
  if (c.type === 'accept' || c.type === 'reject') {
    const i = s.invitations[c.id];
    if (!i) return no('invitation-not-found');
    const g = s.groups[i.groupId]!;
    if (
      i.kind === 'invite'
        ? i.residentId !== a
        : !resourceAdministration(g, a, input.controlAuthorization)
    )
      return no('invitation-not-yours');
    if (i.status !== 'pending') return no('invitation-already-resolved');
    if (!('expectedRevision' in c) || g.revision !== c.expectedRevision)
      return no('revision-conflict');
    if (g.closed) return no('group-closed');
    const contact = i.kind === 'invite' ? (i.invitedBy ?? g.ownerId) : g.control ? a : g.ownerId;
    if (
      c.type === 'accept' &&
      (communicationBlocked(s, contact, i.residentId) ||
        communicationBlocked(s, i.residentId, contact))
    )
      return no('communication-blocked');
    if (
      c.type === 'accept' &&
      g.members.length >= s.policy.maxMembers &&
      !g.members.includes(i.residentId)
    )
      return no('group-full');
    return yes(
      {
        type: 'GroupInvitationChanged',
        invitation: {
          ...i,
          status: c.type === 'accept' ? 'accepted' : 'rejected',
          ...(g.control
            ? {
                resolvedBy: a,
                resolvedAt: at,
                resolution:
                  i.kind === 'invite'
                    ? c.type === 'accept'
                      ? ('recipient-accepted' as const)
                      : ('recipient-rejected' as const)
                    : c.type === 'accept'
                      ? ('controller-accepted' as const)
                      : ('controller-rejected' as const),
              }
            : {}),
        },
      },
      ...(c.type === 'accept' && !g.members.includes(i.residentId)
        ? [
            {
              type: 'GroupChanged' as const,
              group: { ...g, members: [...g.members, i.residentId], revision: g.revision + 1 },
            },
          ]
        : []),
    );
  }
  if (!('groupId' in c)) return no('invalid-command');
  const g = s.groups[c.groupId];
  if (!g) return no('group-not-found');
  if (g.closed) return no('group-closed');
  if (c.type === 'invite' || c.type === 'join-request') {
    const target = c.type === 'invite' ? c.residentId : a;
    if (c.type === 'invite' && !resourceAdministration(g, a, input.controlAuthorization))
      return no('owner-required');
    if (!exists(target) || g.members.includes(target)) return no('invalid-or-existing-member');
    const contact = g.control ? (c.type === 'invite' ? a : undefined) : g.ownerId;
    if (
      contact &&
      (communicationBlocked(s, target, contact) || communicationBlocked(s, contact, target))
    )
      return no('communication-blocked');
    if (
      Object.values(s.invitations).some(
        (i) =>
          i.groupId === g.id &&
          i.residentId === target &&
          i.kind === (c.type === 'invite' ? 'invite' : 'request') &&
          i.status === 'pending',
      )
    )
      return yes();
    if (!validInformationId(c.id) || Object.hasOwn(s.invitations, c.id))
      return no('invalid-or-existing-invitation');
    return yes({
      type: 'GroupInvitationChanged',
      invitation: {
        id: c.id,
        groupId: g.id,
        residentId: target,
        kind: c.type === 'invite' ? 'invite' : 'request',
        ...(g.control && c.type === 'invite' ? { invitedBy: a } : {}),
        status: 'pending',
        at,
      },
    });
  }
  if ((c.type === 'send' || c.type === 'leave') && !g.members.includes(a))
    return no('member-required');
  if (c.type === 'send') {
    if (
      !validInformationId(c.id) ||
      Object.hasOwn(s.messages, c.id) ||
      !c.content.trim() ||
      c.content.length > s.policy.maxText
    )
      return no('invalid-message');
    return yes({
      type: 'GroupMessageSent',
      message: {
        id: c.id,
        groupId: g.id,
        authorId: a,
        content: c.content,
        at,
        sequence: s.sequence + 1,
      },
    });
  }
  if (!('expectedRevision' in c) || g.revision !== c.expectedRevision)
    return no('revision-conflict');
  if (c.type === 'leave') {
    if (personallyControls(g, a)) return no('transfer-or-close-first');
    return yes({
      type: 'GroupChanged',
      group: { ...g, members: g.members.filter((id) => id !== a), revision: g.revision + 1 },
    });
  }
  const admin = resourceAdministration(g, a, input.controlAuthorization);
  if (!admin) return no('owner-required');
  if (c.type === 'transfer') {
    if (g.control) return no('resource-control-offer-required');
    if (!c.targetId || !g.members.includes(c.targetId) || c.targetId === a)
      return no('target-must-be-member');
    return yes({
      type: 'GroupChanged',
      group: { ...g, ownerId: c.targetId, revision: g.revision + 1 },
    });
  }
  return yes(
    {
      type: 'GroupChanged',
      group: {
        ...g,
        closed: true,
        revision: g.revision + 1,
        ...(g.control ? { control: revisedResourceControl(g, admin, at)! } : {}),
      },
    },
    ...Object.values(s.invitations)
      .filter((i) => i.groupId === g.id && i.status === 'pending')
      .map((i) => ({
        type: 'GroupInvitationChanged' as const,
        invitation: {
          ...i,
          status: 'rejected' as const,
          ...(g.control
            ? { resolvedBy: a, resolvedAt: at, resolution: 'group-closed' as const }
            : {}),
        },
      })),
  );
}
export function applyCommunicationEvent(
  state: CommunicationState | undefined,
  e: CommunicationEvent,
): CommunicationState {
  if (e.type === 'CommunicationEnabled') {
    if (state) throw new Error('communication-already-enabled');
    return emptyCommunicationState(e.policy);
  }
  if (!state) throw new Error('communication-not-enabled');
  switch (e.type) {
    case 'GroupControlEnabled':
      if (state.groupControlPolicy) throw new Error('group-control-already-enabled');
      assertGroupControlPolicy(e.policy);
      return { ...state, groupControlPolicy: e.policy };
    case 'GroupMessagesRead':
      return {
        ...state,
        readMessageIds: {
          ...state.readMessageIds,
          [e.ownerId]: [
            ...new Set([...(state.readMessageIds?.[e.ownerId] ?? []), ...e.messageIds]),
          ],
        },
      };
    case 'GroupChanged':
      if (e.group.revision !== (state.groups[e.group.id]?.revision ?? 0) + 1)
        throw new Error('group-revision-gap');
      return { ...state, groups: { ...state.groups, [e.group.id]: e.group } };
    case 'GroupInvitationChanged':
      return { ...state, invitations: { ...state.invitations, [e.invitation.id]: e.invitation } };
    case 'GroupMessageSent':
      if (e.message.sequence !== state.sequence + 1) throw new Error('message-sequence-gap');
      return {
        ...state,
        sequence: e.message.sequence,
        messages: { ...state.messages, [e.message.id]: e.message },
      };
    case 'ResidentBlockChanged':
      return { ...state, blocked: { ...state.blocked, [e.ownerId]: e.targets } };
    case 'CommunicationPreferenceChanged':
      return {
        ...state,
        preferences: {
          ...state.preferences,
          [e.ownerId]: { directWake: e.directWake, subscriptionContext: e.subscriptionContext },
        },
      };
  }
}
