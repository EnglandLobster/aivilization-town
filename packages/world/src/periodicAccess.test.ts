import { expect, test } from 'vitest';
import { asAgentId, createEventEnvelope, advanceClock } from '@aivilization/sim-core';
import type { PeriodicCommand } from '@aivilization/commerce';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { residentExitFixture } from './testFixtures/residentExit';
import { enablePeriodicAccessEvent } from './periodicAccess';
import { worldPeriodicAccount } from './periodicObligationPorts';
import {
  residentPeriodicOperation,
  worldPeriodicRequest,
  advancePeriodicObligations,
  enablePeriodicObligationsEvent,
} from './periodicObligations';

function fixture() {
  const base = residentExitFixture();
  const initial: WorldProjection = {
    ...base,
    agents: {
      ...base.agents,
      b: { ...base.agents.a!, agentId: asAgentId('b'), balance: 0, inventory: {} },
    },
  };
  let world = initial;
  const events: WorldEvent[] = [];
  let serial = 0;
  const context = () => ({
    projection: world,
    requestId: `access-${++serial}`,
    simulationId: 'test',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    for (const event of es) {
      world = applyWorldEvent(world, event);
      events.push(event);
    }
  };
  const operate = (actorId: string, command: PeriodicCommand) => {
    const result = residentPeriodicOperation({
      ...context(),
      actorId,
      request: worldPeriodicRequest(world, command),
    });
    if (result.accepted) commit(result.events);
    return result;
  };
  return { initial, context, commit, operate, events, world: () => world };
}

test('private periodic access creates no public authority; independent consent and actual due payment conserve and replay', () => {
  const f = fixture();
  // Historical activation still requires public authority.
  expect(enablePeriodicObligationsEvent(f.context()).accepted).toBe(false);
  f.commit([enablePeriodicAccessEvent(f.context())]);
  const { periodicAccess, periodicObligations, ...rest } = f.world();
  expect(rest).toEqual(f.initial);
  expect(periodicAccess?.version).toBe('independent-periodic-access-v1');
  expect(periodicObligations?.contracts).toEqual({});
  expect(
    worldPeriodicAccount(f.world(), { sector: 'treasury', id: 'public-treasury' }),
  ).toBeUndefined();
  expect(
    f.operate('a', {
      type: 'offer',
      id: 'promise',
      title: '约定',
      terms: '双方现金承诺',
      payer: { sector: 'agent', id: 'a' },
      revenue: { sector: 'agent', id: 'b' },
      amount: 2,
      firstDueAt: 60000,
      periodMs: 60000,
      periods: 2,
      acceptBy: 1000,
    }).accepted,
  ).toBe(true);
  const offered = f.world();
  expect(f.operate('a', { type: 'accept', id: 'promise', expectedRevision: 1 }).accepted).toBe(
    false,
  );
  expect(f.world()).toBe(offered);
  expect(f.operate('b', { type: 'accept', id: 'promise', expectedRevision: 1 }).accepted).toBe(
    true,
  );
  const previous = f.world().clock;
  f.commit([
    createEventEnvelope({
      id: 'time',
      simulationId: 'test',
      sequence: f.events.length + 1,
      occurredAt: 60000,
      type: 'SimulationTimeAdvanced',
      payload: { previous, next: advanceClock(previous, 60000), deltaMs: 60000 },
    }),
  ]);
  f.commit(advancePeriodicObligations(f.context()));
  expect(f.world().agents.a!.balance).toBeCloseTo(f.initial.agents.a!.balance - 2, 10);
  expect(f.world().agents.b!.balance).toBe(2);
  expect(f.world().moneySupply).toBe(f.initial.moneySupply);
  expect(f.world().agents.a!.inventory).toEqual(f.initial.agents.a!.inventory);
  expect(f.world().periodicObligations!.contracts.promise!.installments['1']?.status).toBe('paid');
  expect(advancePeriodicObligations(f.context())).toEqual([]);
  expect(f.world().publicGovernance).toBeUndefined();
  expect(f.events.reduce(applyWorldEvent, f.initial)).toEqual(f.world());
});

test('independent access refuses duplicate activation and invalid event time without altering the old snapshot', () => {
  const f = fixture();
  const event = enablePeriodicAccessEvent(f.context());
  expect(event.type).toBe('ResidentPeriodicAccessEnabled');
  if (event.type !== 'ResidentPeriodicAccessEnabled') throw Error('wrong-event');
  expect(() => applyWorldEvent(f.initial, { ...event, occurredAt: 1 })).toThrow(
    'invalid-periodic-access-activation',
  );
  f.commit([event]);
  const before = structuredClone(f.world());
  expect(() => enablePeriodicAccessEvent(f.context())).toThrow(
    'invalid-periodic-access-activation',
  );
  expect(f.world()).toEqual(before);
});
