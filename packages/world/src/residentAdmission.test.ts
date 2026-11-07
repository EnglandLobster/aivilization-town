import { expect, test } from 'vitest';
import { asAgentId, createCommandEnvelope, createEventEnvelope } from '@aivilization/sim-core';
import {
  applyWorldEvent,
  normalizeLegacyWorldProjectionSnapshot,
  type WorldProjection,
} from './projection';
import { residentExitFixture, capturedResidentDeparture } from './testFixtures/residentExit';
import { enableResidentAdmissionEvent, assertResidentAdmissionSnapshot } from './residentAdmission';
import { handleRegisterAgentCommand } from './handlers/registration';
const command = (id = 'new') =>
  createCommandEnvelope({
    id: `register-${id}`,
    simulationId: 'sim-1',
    actorId: id,
    type: 'RegisterAgent',
    issuedAt: 0,
    payload: { agentId: id, creatorId: 'creator-1', displayName: id },
  });
const enable = (w: WorldProjection) =>
  enableResidentAdmissionEvent({
    projection: w,
    requestId: 'enable',
    simulationId: 'sim-1',
    nextSequence: 1,
  });
function full(count = 2000) {
  const f = residentExitFixture(),
    a = f.agents.a!;
  return {
    ...f,
    agents: Object.fromEntries(
      Array.from({ length: count }, (_, i) => {
        const id = i === 0 ? 'a' : `body-${i}`;
        return [id, i === 0 ? a : { ...a, agentId: asAgentId(id), balance: 0, inventory: {} }];
      }),
    ),
  };
}
const arrive = (w: WorldProjection, id: string) =>
  createEventEnvelope({
    id: `arrival-${id}`,
    simulationId: 'sim-1',
    sequence: 30,
    occurredAt: w.clock.now,
    type: 'AgentOwnershipArrived' as const,
    payload: {
      agentId: asAgentId(id),
      fromPartitionKey: 'partition-other',
      transferOperationId: 'transfer-1',
      circulatingBalanceTransferred: 0,
      agentState: {
        ...residentExitFixture().agents.a!,
        agentId: asAgentId(id),
        balance: 0,
        inventory: {},
      },
    },
  });
test('explicit activation observes real limits and records reservation without creating a body or moving cash', () => {
  const w = residentExitFixture(),
    e = enable(w),
    after = applyWorldEvent(w, e);
  expect(e.payload.reservation).toEqual({ reserved: 1, capacity: 2000, remaining: 1999 });
  expect(after.moneySupply).toBe(w.moneySupply);
  expect(after.agents).toEqual(w.agents);
  expect(applyWorldEvent(w, JSON.parse(JSON.stringify(e)) as typeof e)).toEqual(after);
  const events = handleRegisterAgentCommand({
    command: command(),
    projection: after,
    nextSequence: 2,
  });
  expect(events[0]?.type).toBe('AgentRegistered');
  const registered = events.reduce(applyWorldEvent, after);
  expect(registered.agents.new?.balance).toBe(100);
  expect(registered.moneySupply).toBe(w.moneySupply + 100);
  assertResidentAdmissionSnapshot(registered);
});
test('last reserved slot accepts; full capacity rejects before publication and forged registration/arrival cannot bypass it', () => {
  const w = full(1999),
    enabled = applyWorldEvent(w, enable(w));
  const accepted = handleRegisterAgentCommand({
    command: command(),
    projection: enabled,
    nextSequence: 2,
  });
  const after = accepted.reduce(applyWorldEvent, enabled);
  expect(Object.keys(after.agents)).toHaveLength(2000);
  const rejected = handleRegisterAgentCommand({
    command: command('next'),
    projection: after,
    nextSequence: 3,
  });
  expect(rejected[0]).toMatchObject({
    type: 'AgentRegistrationRejected',
    payload: { reason: 'resident-exit-capacity-unreserved' },
  });
  expect(rejected.reduce(applyWorldEvent, after).moneySupply).toBe(after.moneySupply);
  const forged = structuredClone(accepted[0]!);
  if (forged.type !== 'AgentRegistered') throw Error('expected');
  Object.assign(forged.payload, { agentId: asAgentId('next') });
  expect(() => applyWorldEvent(after, forged)).toThrow('resident-exit-capacity-unreserved');
  expect(() => applyWorldEvent(after, arrive(after, 'incoming'))).toThrow(
    'resident-exit-capacity-unreserved',
  );
  expect(after.agents.next).toBeUndefined();
});
test('real death at full reservation is not blocked; original identity and custody remain reserved', () => {
  const w = full(),
    enabled = applyWorldEvent(w, enable(w));
  const death = capturedResidentDeparture(enabled),
    after = applyWorldEvent(enabled, death);
  expect(Object.keys(after.agents)).toHaveLength(1999);
  expect(Object.keys(after.residentExits!.records)).toHaveLength(1);
  expect(after.moneySupply).toBe(enabled.moneySupply);
  assertResidentAdmissionSnapshot(after);
  for (const id of ['a', 'next']) {
    const rejected = handleRegisterAgentCommand({
      command: command(id),
      projection: after,
      nextSequence: 11,
    });
    expect(rejected[0]).toMatchObject({
      type: 'AgentRegistrationRejected',
      payload: {
        reason: id === 'a' ? 'agent-id-permanently-reserved' : 'resident-exit-capacity-unreserved',
      },
    });
  }
});
test('permanent subject cannot resurrect by registration or shard arrival even before explicit capacity activation', () => {
  const w = residentExitFixture(),
    after = applyWorldEvent(w, capturedResidentDeparture(w));
  const old = handleRegisterAgentCommand({
    command: command('a'),
    projection: w,
    nextSequence: 2,
  })[0];
  const usable = handleRegisterAgentCommand({
    command: command('a'),
    projection: { ...w, agents: {} },
    nextSequence: 2,
  })[0]!;
  expect(old?.type).toBe('AgentRegistrationRejected');
  expect(() => applyWorldEvent(after, usable)).toThrow('agent-id-permanently-reserved');
  expect(() => applyWorldEvent(after, arrive(after, 'a'))).toThrow('agent-id-permanently-reserved');
  expect(after.residentExits!.cash.accounts['estate-10']?.balance).toBe(25.12345678);
});
test('owning source, policy and overcommitted activation/snapshot reject; old no-capacity mode stays optional', () => {
  const w = residentExitFixture(),
    e = enable(w),
    forged = structuredClone(e);
  Object.assign(forged.payload.reservation, { remaining: 9999 });
  expect(() => applyWorldEvent(w, forged)).toThrow('owning-reservation-mismatch');
  expect(() => enable(full(2001))).toThrow('capacity-overcommitted');
  const enabled = applyWorldEvent(w, e);
  expect(() => applyWorldEvent(enabled, e)).toThrow('activation-source-mismatch');
  expect(() =>
    normalizeLegacyWorldProjectionSnapshot({
      ...full(2001),
      residentAdmissionPolicy: enabled.residentAdmissionPolicy!,
    }),
  ).toThrow('capacity-overcommitted');
  expect(normalizeLegacyWorldProjectionSnapshot(w).residentAdmissionPolicy).toBeUndefined();
});
test('ownership transfer is not permanent departure; new mode refuses unported reservation migration while legacy transfers keep their facts', () => {
  const w = residentExitFixture(),
    enabled = applyWorldEvent(w, enable(w));
  const transfer = createEventEnvelope({
    id: 'shard-out',
    simulationId: 'sim-1',
    sequence: 2,
    occurredAt: 0,
    type: 'AgentOwnershipDeparted' as const,
    payload: {
      agentId: asAgentId('a'),
      toPartitionKey: 'partition-other',
      transferOperationId: 'transfer-1',
      circulatingBalanceTransferred: w.agents.a!.balance,
    },
  });
  expect(() => applyWorldEvent(enabled, transfer)).toThrow(
    'partition-reservation-transfer-not-supported',
  );
  expect(() => applyWorldEvent(enabled, arrive(enabled, 'incoming'))).toThrow(
    'partition-reservation-transfer-not-supported',
  );
  const departed = applyWorldEvent(w, transfer);
  expect(departed.residentExits!.records).toEqual({});
  const back = applyWorldEvent(departed, arrive(departed, 'a'));
  expect(back.agents.a).toBeDefined();
  expect(back.residentExits!.cash.accounts).toEqual({});
});
