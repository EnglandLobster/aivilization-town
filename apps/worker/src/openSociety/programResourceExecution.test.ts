import { expect, test } from 'vitest';
import {
  PROGRAM_ACTIONS_POLICY,
  ENTERPRISE_PROGRAM_ACTIONS_POLICY,
  parseProgramResourceControl,
} from '@aivilization/collaboration';
import { assertProgramResourceEffects } from './programResourceProof';
import { programResourceFixture as fixture } from './testFixtures/programResourceExchange';
test('an internal resource step uses independently mandated authority and retains the actual executor without starting anyone body', () => {
  const f = fixture(),
    before = f.state;
  const first = f.execute(f.authority(0));
  const action = parseProgramResourceControl(
    f.state.coordination!.programs.exchange!.steps[0]!.arguments,
    PROGRAM_ACTIONS_POLICY,
  )!;
  expect(() => assertProgramResourceEffects(f.state, action, first.authority, {})).toThrow(
    'program-resource-effect-required',
  );
  const event = first.effects.worldEvents!.find((e) => e.type === 'ResidentPremisesCommitted')!;
  if (event.type !== 'ResidentPremisesCommitted') throw Error('fixture');
  const change = event.payload.events[0]!;
  if (change.type !== 'PremisesBuildingChanged') throw Error('fixture');
  expect(() =>
    assertProgramResourceEffects(f.state, action, first.authority, {
      worldEvents: [
        {
          ...event,
          payload: {
            ...event.payload,
            events: [{ ...change, building: { ...change.building, condition: 0 } }],
          },
        },
      ],
    }),
  ).toThrow('program-resource-effect-mismatch');
  expect(first.authority).toMatchObject({ principalId: f.t.b, executedBy: f.t.a, stepIndex: 0 });
  f.apply(first.effects);
  expect(f.state.world.premises!.buildings.home!.control.offer!.target.id).toBe(f.t.c);
  const second = f.execute(f.authority(1));
  f.apply(second.effects);
  expect(f.state.world.premises!.buildings.home!.control.controller).toEqual({
    kind: 'resident',
    id: f.t.c,
  });
  expect(second.authority).toMatchObject({ principalId: f.t.c, executedBy: f.t.a, stepIndex: 1 });
  expect(f.state.world.agents).toEqual(before.world.agents);
  expect(f.state.world.activityTimeByAgent).toEqual(before.world.activityTimeByAgent);
  expect(f.state.coordination!.mandates).toEqual(before.coordination!.mandates);
  // These are temporary effects. The runtime journal is unchanged until the enclosing full program is committed.
  expect(f.t.r.state.world.premises!.buildings.home!.control.controller.id).toBe(f.t.b);
});
test('modified authority, unrelated capabilities, revoked consent and changed resource versions cannot execute a resource step', () => {
  const f = fixture(),
    proof = f.authority(0);
  expect(() => f.execute({ ...proof, principalId: f.t.c })).toThrow(
    'program-step-authority-changed',
  );
  expect(() => f.execute({ ...proof, mandateRevision: 2 })).toThrow(
    'program-step-authority-changed',
  );
  expect(() => f.execute(f.authority(2))).toThrow('program-resource-step-required');
  f.apply(f.execute(proof).effects);
  expect(() => f.execute(proof)).toThrow(/revision-conflict/);
  const valid = f.authority(1);
  f.command(f.t.c, {
    type: 'mandates.revoke',
    id: valid.mandateId,
    expectedRevision: valid.mandateRevision,
  });
  expect(() => f.execute(valid)).toThrow('program-mandate-required');
  expect(f.state.world.premises!.buildings.home!.control.controller.id).toBe(f.t.b);
});

test.each(['stock', 'space', 'register', 'view', 'group'] as const)(
  '%s keeps its owning resource semantics through the same independently authorized resource adapter',
  (resourceKind) => {
    const f = fixture(resourceKind),
      before = f.state,
      original = f.resource();
    const first = f.execute(f.authority(0));
    f.apply(first.effects);
    const second = f.execute(f.authority(1));
    f.apply(second.effects);
    expect(f.resource().control?.controller).toEqual({ kind: 'resident', id: f.t.c });
    expect(f.resource().ownerId).toBe(original.ownerId);
    expect(f.state.world.agents).toEqual(before.world.agents);
    expect(f.state.world.moneySupply).toBe(before.world.moneySupply);
    if (resourceKind === 'stock')
      expect(f.state.world.materials!.stocks.asset!.inventory).toEqual({ Wood: 1 });
    if (resourceKind === 'space')
      expect(f.state.information.documents).toEqual(before.information.documents);
    if (resourceKind === 'group') {
      expect(f.state.communication!.groups.asset!.members).toEqual(
        before.communication!.groups.asset!.members,
      );
      const invitations = Object.values(f.state.communication!.invitations).filter(
        (i) => i.groupId === 'asset',
      );
      expect(invitations).toHaveLength(1);
      expect(invitations[0]).toMatchObject({
        status: 'rejected',
        resolution: 'controller-transfer',
      });
    }
  },
);

test('enterprise proof binds exact management facts and rejects unrelated financial or forged authority events', () => {
  const f = fixture('enterprise'),
    proof = f.authority(0),
    first = f.execute(proof);
  const action = parseProgramResourceControl(
    f.state.coordination!.programs.exchange!.steps[0]!.arguments,
    ENTERPRISE_PROGRAM_ACTIONS_POLICY,
  )!;
  const event = first.effects.worldEvents![0]!;
  if (event.type !== 'ResidentEnterpriseControlCommitted') throw Error('fixture');
  const verify = (e: typeof event) =>
    assertProgramResourceEffects(f.state, action, proof, { worldEvents: [e] });
  expect(() => verify({ ...event, payload: { ...event.payload, actorId: f.t.d } })).toThrow(
    'program-resource-effect-mismatch',
  );
  expect(() =>
    verify({
      ...event,
      payload: { ...event.payload, event: { ...event.payload.event, enterpriseId: 'unrelated' } },
    }),
  ).toThrow('program-resource-effect-mismatch');
  expect(() =>
    verify({
      ...event,
      payload: {
        ...event.payload,
        event: { ...event.payload.event, control: { ...event.payload.event.control, version: 99 } },
      },
    }),
  ).toThrow('program-resource-effect-mismatch');
  expect(() =>
    assertProgramResourceEffects(f.state, action, proof, { worldEvents: [event, event] }),
  ).toThrow('invalid-program-enterprise-effects');
  const before = f.state.world.enterprises.asset!;
  f.apply(first.effects);
  f.apply(f.execute(f.authority(1)).effects);
  const { control, ...rest } = f.state.world.enterprises.asset!;
  void control;
  expect(rest).toEqual(before);
  expect(f.state.world.agents).toEqual(f.t.r.state.world.agents);
});
