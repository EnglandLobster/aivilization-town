import { enterpriseControlResource, enterpriseControlVersion } from '@aivilization/enterprise';
import {
  PROGRAM_ACTIONS_POLICY,
  ENTERPRISE_PROGRAM_ACTIONS_POLICY,
  decideCoordination,
  prepareProgramStepAuthority,
  type CoordinationCommand,
  type ProgramStepAuthority,
  type ProgramResourceKind,
} from '@aivilization/collaboration';
import { controlVersion } from '@aivilization/authority';
import { executeProgramResourceControl } from '../programResourceExecution';
import { applyOpenSocietyEffects } from '../state';
import { builtPremisesFixture } from './builtPremises';
import type { OpenSocietyState } from '../types';
export function programResourceFixture(
  resourceKind: ProgramResourceKind = 'premises',
  durable = false,
) {
  const t = builtPremisesFixture(),
    at = t.r.state.world.clock.now;
  const resourceId = resourceKind === 'premises' ? 'home' : 'asset';
  const policy =
    resourceKind === 'enterprise' ? ENTERPRISE_PROGRAM_ACTIONS_POLICY : PROGRAM_ACTIONS_POLICY;
  if (resourceKind === 'enterprise')
    t.ok(t.b, 'world.found_enterprise', {
      enterpriseId: resourceId,
      name: 'Management is distinct from capital',
      occupationName: 'Helper',
      initialCapital: 100,
      maxEmployees: 2,
    });
  if (resourceKind === 'stock') {
    t.ok(t.b, 'stocks.create', { id: resourceId, title: '实际存货', locationId: t.location });
    t.ok(t.b, 'stocks.deposit', { id: resourceId, expectedRevision: 1, items: { Wood: 1 } });
  }
  if (resourceKind === 'space') {
    t.ok(t.b, 'spaces.create', {
      id: resourceId,
      title: '原文',
      visibility: 'private',
      posting: 'owner',
      members: [],
    });
    t.ok(t.b, 'files.create', {
      spaceId: resourceId,
      path: 'original.md',
      content: '作者不会因为交割而改变',
    });
  }
  if (resourceKind === 'register')
    t.ok(t.b, 'registers.create', {
      id: resourceId,
      title: '记录',
      visibility: 'private',
      readers: [],
      editors: [],
      fields: { value: 'number' },
    });
  if (resourceKind === 'group') {
    t.ok(t.b, 'groups.create', { id: resourceId, title: '居民组' });
    t.ok(t.b, 'groups.invite', { groupId: resourceId, residentId: t.d });
  }
  const read = (s: OpenSocietyState) =>
    resourceKind === 'enterprise'
      ? {
          ...enterpriseControlResource(s.world.enterprises[resourceId]!),
          revision: enterpriseControlVersion(s.world.enterprises[resourceId]!),
        }
      : resourceKind === 'premises'
        ? s.world.premises!.buildings[resourceId]!
        : resourceKind === 'stock'
          ? s.world.materials!.stocks[resourceId]!
          : resourceKind === 'space'
            ? s.information.spaces[resourceId]!
            : resourceKind === 'register'
              ? s.sharedRecords!.registers[resourceId]!
              : s.communication!.groups[resourceId]!;
  const resource = read(t.r.state);
  if (
    durable &&
    !(resourceKind === 'enterprise' ? t.r.enableEnterprisePrograms() : t.r.enableProgramActions())
      .ok
  )
    throw Error('fixture-actions-enable');
  let state = durable
    ? t.r.state
    : applyOpenSocietyEffects(t.r.state, {
        coordinationEvents: [{ type: 'ProgramActionsEnabled', policy }],
      });
  const command = (actorId: string, command: CoordinationCommand) => {
    if (durable) {
      const { type, ...args } = command;
      t.ok(actorId, type, args);
      state = t.r.state;
      return;
    }
    const d = decideCoordination({
      state: state.coordination!,
      actorId,
      at,
      command,
      exists: (id) => !!state.world.agents[id],
    });
    if (!d.accepted) throw Error(d.reason);
    state = applyOpenSocietyEffects(state, { coordinationEvents: d.events });
  };
  command(t.b, {
    type: 'programs.publish',
    id: 'exchange',
    title: '居民自己的交换',
    purpose: '不指定经营组织',
    runners: [t.a],
    definition: {
      actionPolicyVersion: policy.version,
      steps: [
        {
          principalId: t.b,
          capability: 'resource.control',
          arguments: {
            resourceKind,
            resourceId,
            expectedRevision: resource.revision,
            control: {
              type: 'offer',
              expectedVersion: controlVersion(resource),
              target: { kind: 'resident', id: t.c },
              expiresAt: at + 60000,
              terms: '固定版本的移交',
            },
          },
        },
        {
          principalId: t.c,
          capability: 'resource.control',
          arguments: {
            resourceKind,
            resourceId,
            expectedRevision: resource.revision + 1,
            control: { type: 'accept', expectedVersion: controlVersion(resource) + 1 },
          },
        },
        {
          principalId: t.c,
          capability: 'payments.transfer',
          arguments: { targetId: t.b, amount: 30, note: '双方自主定价' },
        },
      ],
    },
  });
  for (const actor of [t.b, t.c])
    command(actor, {
      type: 'mandates.grant',
      id: `mandate-${actor}`,
      programId: 'exchange',
      programRevision: 1,
      runnerId: t.a,
      maxRuns: 1,
      expiresAt: at + 60000,
    });
  const authority = (stepIndex: number) => {
    const d = prepareProgramStepAuthority({
      state: state.coordination!,
      executorId: t.a,
      programId: 'exchange',
      programRevision: 1,
      runId: 'exchange-run',
      stepIndex,
      at,
      exists: (id) => !!state.world.agents[id],
    });
    if (!d.accepted) throw Error(d.reason);
    return d.authority;
  };
  const execute = (proof: ProgramStepAuthority) =>
    executeProgramResourceControl({
      state,
      manifest: t.manifest,
      authority: proof,
      requestId: `step-${proof.stepIndex}`,
    });
  return {
    t,
    resource: () => read(durable ? t.r.state : state),
    get state() {
      return durable ? t.r.state : state;
    },
    authority,
    execute,
    command,
    apply: (effects: Parameters<typeof applyOpenSocietyEffects>[1]) => {
      if (durable) throw Error('use-runtime-for-durable-fixture');
      state = applyOpenSocietyEffects(state, effects);
    },
  };
}
