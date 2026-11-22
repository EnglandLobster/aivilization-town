import {
  enterpriseControlResource,
  enterpriseControlVersion,
  ENTERPRISE_CONTROL_VERSION,
} from '@aivilization/enterprise';
import {
  controlVersion,
  RESOURCE_CONTROL_POLICY,
  effectiveController,
  type ControlledResource,
  type LegacyControlledResource,
  type ResourceControl,
} from '@aivilization/authority';
import { tradeFactsEqual } from '@aivilization/commerce';
import type { ProgramResourceControl, ProgramStepAuthority } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyEffects } from './types';
import { ORDERED_EFFECT_FAMILIES } from './effectOrder';

/** Mechanical correspondence to the original signed command; owning reducers still validate the recorded resource facts. */
function expectedControl(
  before: ControlledResource,
  action: ProgramResourceControl,
  authority: ProgramStepAuthority,
  policyVersion: ResourceControl['policyVersion'],
): ResourceControl {
  if (before.control?.policyVersion === 'resource-principals-v2')
    throw Error('program-principal-control-not-supported');
  const legacy: LegacyControlledResource = {
    ownerId: before.ownerId,
    ...(before.control ? { control: before.control } : {}),
  };
  const c = action.control,
    controller = effectiveController(legacy),
    subject = c.type === 'accept' ? legacy.control?.offer?.target : controller;
  if (
    controlVersion(before) !== c.expectedVersion ||
    !subject ||
    subject.kind !== 'resident' ||
    subject.id !== authority.principalId
  )
    throw Error('program-resource-authority-or-version-mismatch');
  const base = {
    policyVersion,
    version: c.expectedVersion + 1,
    at: authority.at,
    changedBy: authority.principalId,
  };
  if (c.type === 'accept') return { ...base, controller: legacy.control!.offer!.target };
  if (c.type === 'cancel') return { ...base, controller };
  return {
    ...base,
    controller,
    offer: {
      target: c.target,
      expiresAt: c.expiresAt,
      terms: c.terms,
      offeredBy: authority.principalId,
      offeredAt: authority.at,
    },
  };
}
function familyOnly(effects: OpenSocietyEffects, allowed: readonly string[]) {
  if (ORDERED_EFFECT_FAMILIES.some((f) => !!effects[f]?.length && !allowed.includes(f)))
    throw Error('unrelated-program-resource-effect-family');
}
function same(actual: unknown, expected: unknown) {
  if (!tradeFactsEqual(actual, expected)) throw Error('program-resource-effect-mismatch');
}
export function assertProgramResourceEffects(
  state: OpenSocietyState,
  action: ProgramResourceControl,
  authority: ProgramStepAuthority,
  effects: OpenSocietyEffects,
) {
  const id = action.resourceId,
    at = authority.at;
  if (at !== state.world.clock.now) throw Error('program-resource-clock-mismatch');
  if (action.resourceKind === 'enterprise') {
    familyOnly(effects, ['worldEvents']);
    const old = state.world.enterprises[id],
      event = effects.worldEvents?.[0];
    if (!old || enterpriseControlVersion(old) !== action.expectedRevision)
      throw Error('program-enterprise-control-revision-mismatch');
    if (
      effects.worldEvents?.length !== 1 ||
      event?.type !== 'ResidentEnterpriseControlCommitted' ||
      event.occurredAt !== at
    )
      throw Error('invalid-program-enterprise-effects');
    const control = expectedControl(
      enterpriseControlResource(old),
      action,
      authority,
      RESOURCE_CONTROL_POLICY.version,
    );
    same(event.payload, {
      actorId: authority.principalId,
      event: {
        type: 'EnterpriseControlChanged',
        policyVersion: ENTERPRISE_CONTROL_VERSION,
        enterpriseId: id,
        operation: action.control.type,
        control,
      },
    });
    return;
  }
  if (action.resourceKind === 'premises') {
    familyOnly(effects, ['worldEvents']);
    const old = state.world.premises?.buildings[id];
    if (!old || old.revision !== action.expectedRevision)
      throw Error('program-resource-revision-mismatch');
    const control = expectedControl(
      old,
      action,
      authority,
      state.world.premises.policy.control.version,
    );
    let changed = 0;
    for (const e of effects.worldEvents ?? []) {
      if (e.occurredAt !== at) throw Error('program-resource-clock-mismatch');
      if (e.type === 'ResidentPremisesCommitted') {
        changed++;
        if (
          e.payload.reservation ||
          e.payload.release ||
          e.payload.efforts.length ||
          e.payload.materialEvents.length
        )
          throw Error('unrelated-program-resource-physical-effect');
        same(e.payload.events, [
          {
            type: 'PremisesBuildingChanged',
            building: { ...old, control, revision: old.revision + 1, at },
          },
        ]);
      } else throw Error('unrelated-program-resource-world-event');
    }
    if (changed !== 1) throw Error('program-resource-effect-required');
    return;
  }
  if (action.resourceKind === 'stock') {
    familyOnly(effects, ['worldEvents']);
    const old = state.world.materials?.stocks[id],
      e = effects.worldEvents?.[0];
    if (!old || old.revision !== action.expectedRevision)
      throw Error('program-resource-revision-mismatch');
    if (
      effects.worldEvents?.length !== 1 ||
      e?.type !== 'ResidentMaterialsCommitted' ||
      e.occurredAt !== at ||
      e.payload.reservation ||
      e.payload.release ||
      e.payload.events.length !== 2
    )
      throw Error('invalid-program-stock-effects');
    const control = expectedControl(
      old,
      action,
      authority,
      state.world.materials.policy.control.version,
    );
    same(e.payload.events[0], {
      type: 'MaterialStockChanged',
      stock: { ...old, control, revision: old.revision + 1, at },
    });
    const receipt = e.payload.events[1];
    if (receipt?.type !== 'MaterialReceiptRecorded') throw Error('program-stock-receipt-required');
    same(receipt.receipt, {
      id: receipt.receipt.id,
      actorId: authority.principalId,
      at,
      operation: 'control-stock',
      stockId: id,
      transfers: [],
      conversions: [],
      efforts: [],
    });
    return;
  }
  if (!state.resourceControlPolicy) throw Error('program-resource-control-not-enabled');
  if (action.resourceKind === 'space') {
    familyOnly(effects, ['informationEvents']);
    const old = state.information.spaces[id];
    if (!old || old.revision !== action.expectedRevision)
      throw Error('program-resource-revision-mismatch');
    const control = expectedControl(old, action, authority, state.resourceControlPolicy.version);
    same(effects.informationEvents, [
      { type: 'SpaceChanged', space: { ...old, control, revision: old.revision + 1 } },
    ]);
    return;
  }
  if (action.resourceKind === 'register') {
    familyOnly(effects, ['sharedRecordsEvents']);
    const old = state.sharedRecords?.registers[id];
    if (!old || old.revision !== action.expectedRevision)
      throw Error('program-resource-revision-mismatch');
    const control = expectedControl(old, action, authority, state.resourceControlPolicy.version);
    const { successorId, ...base } = old;
    void successorId;
    same(effects.sharedRecordsEvents, [
      {
        type: 'SharedRegisterChanged',
        register: { ...base, control, revision: old.revision + 1, at },
      },
    ]);
    return;
  }
  familyOnly(effects, ['communicationEvents']);
  const old = state.communication?.groups[id];
  if (!old || old.revision !== action.expectedRevision)
    throw Error('program-resource-revision-mismatch');
  const control = expectedControl(old, action, authority, state.resourceControlPolicy.version);
  const invitations =
    action.control.type === 'accept'
      ? Object.values(state.communication.invitations)
          .filter((i) => i.groupId === id && i.status === 'pending')
          .map((i) => ({
            type: 'GroupInvitationChanged',
            invitation: {
              ...i,
              status: 'rejected',
              resolvedBy: authority.principalId,
              resolvedAt: at,
              resolution: 'controller-transfer',
            },
          }))
      : [];
  same(effects.communicationEvents, [
    { type: 'GroupChanged', group: { ...old, control, revision: old.revision + 1 } },
    ...invitations,
  ]);
}
