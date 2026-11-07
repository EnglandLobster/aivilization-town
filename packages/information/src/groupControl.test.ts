import { expect, test } from 'vitest';
import { RESOURCE_CONTROL_POLICY, type ControlAuthorizationPort } from '@aivilization/authority';
import {
  GROUP_CONTROL_POLICY,
  decideCommunication,
  applyCommunicationEvent,
  emptyCommunicationState,
  canReadGroup,
  type CommunicationCommand,
} from './communication';
import { emptyInformationState, DEFAULT_INFORMATION_POLICY } from './model';
import {
  decideInformationResourceControl,
  decideInformationResourceManagement,
  parseInformationResourceOperation,
  type InformationResources,
  type InformationResourceEffects,
} from './resourceControl';
const exists = (id: string) => ['a', 'b', 'c', 'd'].includes(id);
const grant: ControlAuthorizationPort = (c) =>
  c.kind === 'collective' && c.id === 'club' ? { actorId: 'b', decisionId: 'decision' } : undefined;
function fixture(enabled = true) {
  let s: InformationResources = {
    information: emptyInformationState(),
    informationPolicy: DEFAULT_INFORMATION_POLICY,
    communication: emptyCommunicationState(undefined, enabled ? GROUP_CONTROL_POLICY : undefined),
  };
  const events: Parameters<typeof applyCommunicationEvent>[1][] = [];
  const apply = (e: InformationResourceEffects) => {
    events.push(...(e.communicationEvents ?? []));
    s = {
      ...s,
      communication: (e.communicationEvents ?? []).reduce(
        applyCommunicationEvent,
        s.communication!,
      ),
    };
  };
  const call = (actorId: string, command: CommunicationCommand) => {
    const d = decideCommunication({
      state: s.communication!,
      actorId,
      at: 10,
      command,
      exists,
      ...(enabled ? { resourceControlPolicy: RESOURCE_CONTROL_POLICY } : {}),
    });
    if (d.accepted) apply({ communicationEvents: d.events });
    return d;
  };
  expect(call('a', { type: 'create', id: 'g', title: '居民自发选择的群组' }).accepted).toBe(true);
  const revision = () => s.communication!.groups.g!.revision;
  const control = (
    actorId: string,
    command: Parameters<typeof decideInformationResourceControl>[0]['command'],
  ) => {
    const d = decideInformationResourceControl({
      state: s,
      kind: 'group',
      id: 'g',
      expectedRevision: revision(),
      actorId,
      at: 10,
      policy: RESOURCE_CONTROL_POLICY,
      command,
      authorize: grant,
      available: (c) => (c.kind === 'resident' ? exists(c.id) : c.id === 'club'),
    });
    if (d.accepted) apply(d.effects);
    return d;
  };
  const adopt = () => {
    expect(
      control('a', {
        type: 'offer',
        expectedVersion: 1,
        target: { kind: 'collective', id: 'club' },
        expiresAt: 100,
        terms: '成员和作者保留',
      }).accepted,
    ).toBe(true);
    expect(control('b', { type: 'accept', expectedVersion: 2 }).accepted).toBe(true);
  };
  const manage = (operation: unknown, actorId = 'b') => {
    const op = parseInformationResourceOperation('group', operation);
    if (!op) throw Error('invalid test operation');
    const d = decideInformationResourceManagement({
      state: s,
      id: 'g',
      expectedRevision: revision(),
      expectedControlVersion: s.communication!.groups.g!.control?.version ?? 1,
      actorId,
      at: 10,
      operation: op,
      authorize: grant,
      exists,
    });
    if (d.accepted) apply(d.effects);
    return d;
  };
  const replay = () =>
    expect(
      events.reduce(
        applyCommunicationEvent,
        emptyCommunicationState(undefined, enabled ? GROUP_CONTROL_POLICY : undefined),
      ),
    ).toEqual(s.communication);
  return {
    get state() {
      return s.communication!;
    },
    call,
    revision,
    control,
    adopt,
    manage,
    replay,
  };
}
test('new groups require an independently accepted handover; old groups retain their explicit legacy semantics', () => {
  for (const enabled of [false, true]) {
    const t = fixture(enabled);
    t.call('a', { type: 'invite', id: 'i', groupId: 'g', residentId: 'c' });
    t.call('c', { type: 'accept', id: 'i', expectedRevision: t.revision() });
    const transfer = t.call('a', {
      type: 'transfer',
      groupId: 'g',
      expectedRevision: t.revision(),
      targetId: 'c',
    });
    if (!enabled) {
      expect(transfer.accepted).toBe(true);
      expect(t.state.groups.g!.ownerId).toBe('c');
      expect(t.state.groups.g).not.toHaveProperty('control');
    } else {
      expect(transfer).toMatchObject({
        accepted: false,
        reason: 'resource-control-offer-required',
      });
      expect(t.state.groups.g!.control?.controller).toEqual({ kind: 'resident', id: 'a' });
    }
    t.replay();
  }
});
test('collective controllers do not become members or authors and old creators lose administrative powers', () => {
  const t = fixture();
  t.call('a', { type: 'send', id: 'original', groupId: 'g', content: '原作者原话' });
  t.adopt();
  expect(t.state.groups.g!.members).toEqual(['a']);
  expect(canReadGroup(t.state, 'b', 'g')).toBe(false);
  expect(
    t.call('b', { type: 'send', id: 'forged', groupId: 'g', content: '不是成员' }),
  ).toMatchObject({ accepted: false, reason: 'member-required' });
  expect(
    t.call('a', { type: 'invite', id: 'old-invite', groupId: 'g', residentId: 'd' }),
  ).toMatchObject({ accepted: false, reason: 'owner-required' });
  expect(
    t.call('b', { type: 'invite', id: 'direct', groupId: 'g', residentId: 'd' }).accepted,
  ).toBe(false);
  expect(t.manage({ type: 'invite', invitationId: 'proper', residentId: 'd' }).accepted).toBe(true);
  expect(t.state.invitations.proper).toMatchObject({ invitedBy: 'b', status: 'pending' });
  expect(t.manage({ type: 'respond', invitationId: 'proper', accept: true })).toMatchObject({
    accepted: false,
    reason: 'recipient-response-required',
  });
  expect(t.state.groups.g!.members).not.toContain('d');
  expect(
    t.call('d', { type: 'accept', id: 'proper', expectedRevision: t.revision() }).accepted,
  ).toBe(true);
  expect(t.state.groups.g!.members).toEqual(['a', 'd']);
  expect(t.state.messages.original!.authorId).toBe('a');
  expect(
    t.call('a', { type: 'leave', groupId: 'g', expectedRevision: t.revision() }).accepted,
  ).toBe(true);
  expect(canReadGroup(t.state, 'a', 'g')).toBe(false);
  expect(t.state.messages.original!.content).toBe('原作者原话');
  t.replay();
});
test('handover cancels pending invitations and requests with actual resolution instead of forged personal rejection', () => {
  const t = fixture();
  t.call('a', { type: 'invite', id: 'i', groupId: 'g', residentId: 'c' });
  t.call('d', { type: 'join-request', id: 'request', groupId: 'g', residentId: 'd' });
  t.adopt();
  for (const id of ['i', 'request'])
    expect(t.state.invitations[id]).toMatchObject({
      status: 'rejected',
      resolvedBy: 'b',
      resolvedAt: 10,
      resolution: 'controller-transfer',
    });
  expect(t.call('c', { type: 'accept', id: 'i', expectedRevision: t.revision() })).toMatchObject({
    accepted: false,
    reason: 'invitation-already-resolved',
  });
  expect(t.state.groups.g!.members).toEqual(['a']);
  t.replay();
});
test('applicants can withdraw pending consent; collective authority cannot later revive it', () => {
  const t = fixture();
  t.adopt();
  t.call('d', { type: 'join-request', id: 'r1', groupId: 'g', residentId: 'd' });
  expect(
    t.call('c', { type: 'withdraw-request', id: 'r1', expectedRevision: t.revision() }).accepted,
  ).toBe(false);
  expect(
    t.call('d', { type: 'withdraw-request', id: 'r1', expectedRevision: t.revision() }).accepted,
  ).toBe(true);
  expect(t.state.invitations.r1).toMatchObject({
    resolution: 'request-withdrawn',
    resolvedBy: 'd',
  });
  expect(t.manage({ type: 'respond', invitationId: 'r1', accept: true })).toMatchObject({
    accepted: false,
    reason: 'invitation-already-resolved',
  });
  t.call('d', { type: 'join-request', id: 'r2', groupId: 'g', residentId: 'd' });
  expect(t.manage({ type: 'respond', invitationId: 'r2', accept: true }).accepted).toBe(true);
  expect(t.state.groups.g!.members).toContain('d');
  expect(
    t.call('d', { type: 'withdraw-request', id: 'r2', expectedRevision: t.revision() }).accepted,
  ).toBe(false);
  t.replay();
});
test('blocks apply to the actual inviter or current reviewer rather than a past owner', () => {
  const t = fixture();
  t.adopt();
  t.call('d', { type: 'block', targetId: 'b' });
  expect(t.manage({ type: 'invite', invitationId: 'blocked', residentId: 'd' })).toMatchObject({
    accepted: false,
    reason: 'communication-blocked',
  });
  t.call('d', { type: 'join-request', id: 'request', groupId: 'g', residentId: 'd' });
  expect(t.manage({ type: 'respond', invitationId: 'request', accept: true })).toMatchObject({
    accepted: false,
    reason: 'communication-blocked',
  });
  t.call('d', { type: 'unblock', targetId: 'b' });
  t.call('d', { type: 'block', targetId: 'a' });
  expect(t.manage({ type: 'invite', invitationId: 'new-contact', residentId: 'd' }).accepted).toBe(
    true,
  );
  expect(
    t.call('d', { type: 'accept', id: 'new-contact', expectedRevision: t.revision() }).accepted,
  ).toBe(true);
  t.replay();
});
test('controllers may withdraw their unaccepted invitation and close without becoming members; history survives', () => {
  const t = fixture();
  t.call('a', { type: 'send', id: 'original', groupId: 'g', content: '仍有历史' });
  t.adopt();
  t.manage({ type: 'invite', invitationId: 'i', residentId: 'c' });
  expect(t.manage({ type: 'withdraw-invitation', invitationId: 'i' }).accepted).toBe(true);
  expect(t.state.invitations.i).toMatchObject({
    status: 'rejected',
    resolution: 'controller-withdrew',
    resolvedBy: 'b',
  });
  t.call('d', { type: 'join-request', id: 'request', groupId: 'g', residentId: 'd' });
  expect(t.manage({ type: 'close' }).accepted).toBe(true);
  expect(t.state.groups.g!.closed).toBe(true);
  expect(t.state.invitations.request).toMatchObject({
    resolution: 'group-closed',
    resolvedBy: 'b',
  });
  expect(t.state.messages.original!.content).toBe('仍有历史');
  expect(
    t.control('b', {
      type: 'offer',
      expectedVersion: 4,
      target: { kind: 'resident', id: 'c' },
      expiresAt: 100,
      terms: '已关闭',
    }),
  ).toMatchObject({ accepted: false, reason: 'group-closed' });
  t.replay();
});
