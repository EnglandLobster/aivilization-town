import {
  decideCommunication,
  type CommunicationState,
  type CommunicationEvent,
  type ResidentGroup,
  type CommunicationCommand,
} from './communication';
import {
  controlVersion,
  decideResourceControl,
  effectiveController,
  sameController,
  resourceAdministration,
  revisedResourceControl,
  type ResourceControl,
  type ResourceControlPolicy,
  type ControlCommand,
  type ControlAuthorizationPort,
  type Controller,
} from '@aivilization/authority';
import {
  type InformationState,
  type InformationSpace,
  type InformationPolicy,
  type InformationEvent,
  validInformationId,
} from './model';
import {
  decideSharedRecords,
  type SharedRecordsState,
  type SharedRegister,
  type SharedRecordsEvent,
} from './sharedRecords';
export type InformationResourceKind = 'space' | 'register' | 'group';
export type InformationResources = {
  readonly information: InformationState;
  readonly communication?: CommunicationState;
  readonly informationPolicy: InformationPolicy;
  readonly sharedRecords?: SharedRecordsState;
};
export type InformationControlledResource = InformationSpace | SharedRegister | ResidentGroup;
export type InformationResourceEffects = {
  readonly informationEvents?: readonly InformationEvent[];
  readonly communicationEvents?: readonly CommunicationEvent[];
  readonly sharedRecordsEvents?: readonly SharedRecordsEvent[];
};
export function getInformationResource(
  s: InformationResources,
  kind: InformationResourceKind,
  id: string,
): InformationControlledResource | undefined {
  if (!validInformationId(id)) return undefined;
  if (kind === 'space') return s.information.spaces[id];
  if (kind === 'register') return s.sharedRecords?.registers[id];
  return s.communication?.groupControlPolicy ? s.communication.groups[id] : undefined;
}
export function allInformationResources(
  s: InformationResources,
): readonly { kind: InformationResourceKind; resource: InformationControlledResource }[] {
  return [
    ...Object.values(s.communication?.groupControlPolicy ? s.communication.groups : {}).map(
      (resource) => ({
        kind: 'group' as const,
        resource,
      }),
    ),
    ...Object.values(s.information.spaces).map((resource) => ({
      kind: 'space' as const,
      resource,
    })),
    ...Object.values(s.sharedRecords?.registers ?? {}).map((resource) => ({
      kind: 'register' as const,
      resource,
    })),
  ];
}
export function informationResourceMetadata(
  kind: InformationResourceKind,
  r: InformationControlledResource,
) {
  return {
    kind,
    id: r.id,
    revision: r.revision,
    controller: effectiveController(r),
    controlVersion: controlVersion(r),
    ...(kind === 'group' && 'closed' in r ? { closed: r.closed } : {}),
    ...(r.control?.offer ? { offer: r.control.offer } : {}),
    readWith: `town resources read --kind ${kind} --id ${r.id}`,
  };
}
const no = (reason: string) => ({ accepted: false as const, reason });
const yes = (effects: InformationResourceEffects) => ({ accepted: true as const, effects });
function replaceControl(
  s: InformationResources,
  kind: InformationResourceKind,
  id: string,
  control: ResourceControl,
  at: number,
  transferred: boolean,
): InformationResourceEffects {
  if (kind === 'group') {
    const r = s.communication!.groups[id]!;
    return {
      communicationEvents: [
        { type: 'GroupChanged', group: { ...r, control, revision: r.revision + 1 } },
        ...(transferred
          ? Object.values(s.communication!.invitations)
              .filter((i) => i.groupId === id && i.status === 'pending')
              .map((i) => ({
                type: 'GroupInvitationChanged' as const,
                invitation: {
                  ...i,
                  status: 'rejected' as const,
                  resolvedBy: control.changedBy,
                  resolvedAt: at,
                  resolution: 'controller-transfer' as const,
                },
              }))
          : []),
      ],
    };
  }
  if (kind === 'space') {
    const r = s.information.spaces[id]!;
    return {
      informationEvents: [
        { type: 'SpaceChanged', space: { ...r, control, revision: r.revision + 1 } },
      ],
    };
  }
  if (kind === 'register') {
    const r = s.sharedRecords!.registers[id]!,
      { successorId: previousOffer, ...base } = r;
    void previousOffer;
    return {
      sharedRecordsEvents: [
        {
          type: 'SharedRegisterChanged',
          register: { ...base, control, revision: r.revision + 1, at },
        },
      ],
    };
  }
  throw new Error('unsupported-information-resource');
}
export function decideInformationResourceControl(input: {
  state: InformationResources;
  kind: InformationResourceKind;
  id: string;
  expectedRevision: number;
  actorId: string;
  at: number;
  policy: ResourceControlPolicy;
  command: ControlCommand;
  authorize: ControlAuthorizationPort;
  available: (c: Controller) => boolean;
}) {
  const { state: s, kind, id, actorId, at } = input,
    r = getInformationResource(s, kind, id);
  if (!r) return no('information-resource-not-found');
  if (kind === 'group' && 'closed' in r && r.closed) return no('group-closed');
  if (r.revision !== input.expectedRevision) return no('revision-conflict');
  if (r.revision >= Number.MAX_SAFE_INTEGER) return no('revision-limit');
  const decision = decideResourceControl({
    resource: r,
    actorId,
    at,
    command: input.command,
    policy: input.policy,
    authorize: input.authorize,
    available: input.available,
  });
  if (!decision.accepted) return decision;
  if (input.command.type === 'accept') {
    const target = decision.control.controller;
    const count = allInformationResources(s).filter(
      (v) =>
        v.kind === kind &&
        !(v.kind === 'group' && 'closed' in v.resource && v.resource.closed) &&
        sameController(effectiveController(v.resource), target),
    ).length;
    const limit =
      kind === 'space'
        ? s.informationPolicy.maxSpacesPerOwner
        : kind === 'register'
          ? s.sharedRecords!.policy.maxRegistersPerOwner
          : s.communication!.policy.maxGroups;
    if (count >= limit) return no('recipient-resource-quota');
  }
  return yes(replaceControl(s, kind, id, decision.control, at, input.command.type === 'accept'));
}
export type InformationResourceOperation =
  | {
      readonly kind: 'group';
      readonly type: 'invite';
      readonly invitationId: string;
      readonly residentId: string;
    }
  | {
      readonly kind: 'group';
      readonly type: 'respond';
      readonly invitationId: string;
      readonly accept: boolean;
    }
  | { readonly kind: 'group'; readonly type: 'withdraw-invitation'; readonly invitationId: string }
  | { readonly kind: 'group'; readonly type: 'close' }
  | {
      readonly kind: 'space';
      readonly type: 'configure';
      readonly visibility: 'public' | 'private';
      readonly posting: 'owner' | 'members' | 'everyone';
      readonly members: readonly string[];
    }
  | {
      readonly kind: 'register';
      readonly type: 'configure';
      readonly visibility: 'public' | 'private';
      readonly readers: readonly string[];
      readonly editors: readonly string[];
    };
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
export function parseInformationResourceOperation(
  kind: InformationResourceKind,
  value: unknown,
): InformationResourceOperation | undefined {
  if (!object(value) || JSON.stringify(value).length > 12000) return undefined;
  if (kind === 'group') {
    if (value.type === 'close' && exact(value, ['type'])) return { kind, type: 'close' };
    if (typeof value.invitationId !== 'string' || !validInformationId(value.invitationId))
      return undefined;
    if (
      value.type === 'invite' &&
      exact(value, ['type', 'invitationId', 'residentId']) &&
      typeof value.residentId === 'string' &&
      validInformationId(value.residentId)
    )
      return {
        kind,
        type: 'invite',
        invitationId: value.invitationId,
        residentId: value.residentId,
      };
    if (
      value.type === 'respond' &&
      exact(value, ['type', 'invitationId', 'accept']) &&
      typeof value.accept === 'boolean'
    )
      return { kind, type: 'respond', invitationId: value.invitationId, accept: value.accept };
    if (value.type === 'withdraw-invitation' && exact(value, ['type', 'invitationId']))
      return { kind, type: 'withdraw-invitation', invitationId: value.invitationId };
    return undefined;
  }
  if (value.visibility !== 'public' && value.visibility !== 'private') return undefined;
  if (
    kind === 'space' &&
    value.type === 'configure' &&
    exact(value, ['type', 'visibility', 'posting', 'members']) &&
    strings(value.members) &&
    (value.posting === 'owner' || value.posting === 'members' || value.posting === 'everyone')
  )
    return {
      kind,
      type: 'configure',
      visibility: value.visibility,
      posting: value.posting,
      members: value.members,
    };
  if (
    kind === 'register' &&
    value.type === 'configure' &&
    exact(value, ['type', 'visibility', 'readers', 'editors']) &&
    strings(value.readers) &&
    strings(value.editors)
  )
    return {
      kind,
      type: 'configure',
      visibility: value.visibility,
      readers: value.readers,
      editors: value.editors,
    };
  return undefined;
}
export function decideInformationResourceManagement(input: {
  state: InformationResources;
  id: string;
  expectedRevision: number;
  expectedControlVersion: number;
  actorId: string;
  at: number;
  operation: InformationResourceOperation;
  authorize: ControlAuthorizationPort;
  exists: (id: string) => boolean;
}) {
  const { state: s, id, actorId, at, operation: op } = input,
    r = getInformationResource(s, op.kind, id);
  if (!r) return no('information-resource-not-found');
  if (!input.exists(actorId) || !Number.isSafeInteger(at) || at < 0)
    return no('invalid-actor-or-time');
  if (input.expectedRevision !== r.revision) return no('revision-conflict');
  if (input.expectedControlVersion !== controlVersion(r)) return no('control-version-conflict');
  if (r.revision >= Number.MAX_SAFE_INTEGER || controlVersion(r) >= Number.MAX_SAFE_INTEGER)
    return no('revision-limit');
  const grant = resourceAdministration(r, actorId, input.authorize);
  if (!grant) return no('resource-controller-authority-required');
  if (op.kind === 'group') {
    if (!s.communication) return no('communication-not-enabled');
    let command: CommunicationCommand;
    if (op.type === 'invite')
      command = { type: 'invite', id: op.invitationId, groupId: id, residentId: op.residentId };
    else if (op.type === 'close')
      command = { type: 'close', groupId: id, expectedRevision: r.revision };
    else {
      const invitation = s.communication.invitations[op.invitationId];
      if (!invitation || invitation.groupId !== id) return no('invitation-not-found');
      if (op.type === 'respond' && invitation.kind !== 'request')
        return no('recipient-response-required');
      command = {
        type:
          op.type === 'withdraw-invitation'
            ? 'withdraw-invitation'
            : op.accept
              ? 'accept'
              : 'reject',
        id: op.invitationId,
        expectedRevision: r.revision,
      };
    }
    const d = decideCommunication({
      state: s.communication,
      actorId,
      at,
      exists: input.exists,
      controlAuthorization: input.authorize,
      command,
    });
    return d.accepted ? yes({ communicationEvents: d.events }) : d;
  }
  if (op.kind === 'space') {
    if (
      op.members.length > 100 ||
      new Set(op.members).size !== op.members.length ||
      !op.members.every((v) => validInformationId(v) && input.exists(v))
    )
      return no('invalid-members');
    const space = s.information.spaces[id]!;
    return yes({
      informationEvents: [
        {
          type: 'SpaceChanged',
          space: {
            ...space,
            visibility: op.visibility,
            posting: op.posting,
            members: [...op.members],
            revision: space.revision + 1,
            ...(space.control ? { control: revisedResourceControl(space, grant, at)! } : {}),
          },
        },
      ],
    });
  }
  if (op.kind === 'register') {
    const d = decideSharedRecords({
      state: s.sharedRecords!,
      actorId,
      at,
      controlAuthorization: input.authorize,
      exists: input.exists,
      command: {
        type: 'registers.configure',
        id,
        expectedRevision: r.revision,
        visibility: op.visibility,
        readers: op.readers,
        editors: op.editors,
      },
    });
    return d.accepted ? yes({ sharedRecordsEvents: d.events }) : d;
  }
  return no('unsupported-information-resource');
}
