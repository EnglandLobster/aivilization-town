import { expect, test } from 'vitest';
import { executeResidentProgram, mergeProgramEffects } from './programExecution';
import { programResourceFixture as fixture } from './testFixtures/programResourceExchange';
import { applyOpenSocietyEffects } from './state';
import { validatedEffectOrder } from './effectOrder';
import type { OpenSocietyEffects } from './types';
import { programEffectCommitments } from './programEffectCommitments';
import { executeCommerceTool } from './commerceTools';

function run(f: ReturnType<typeof fixture>, runId = 'exchange-run') {
  return executeResidentProgram({
    state: f.state,
    manifest: f.t.manifest,
    runnerId: f.t.a,
    programId: 'exchange',
    programRevision: 1,
    runId,
  });
}
test.each(['premises', 'stock', 'space', 'register', 'group'] as const)(
  '%s paid control exchange commits every signed step and exactly one balanced payment',
  (kind) => {
    const f = fixture(kind),
      before = f.state,
      execution = run(f);
    expect(execution.error).toBeUndefined();
    expect(execution.effects.effectOrder).toBeDefined();
    f.apply(execution.effects);
    expect(f.resource().control?.controller).toEqual({ kind: 'resident', id: f.t.c });
    expect(f.state.world.agents[f.t.c]!.balance).toBe(before.world.agents[f.t.c]!.balance - 30);
    expect(f.state.world.agents[f.t.b]!.balance).toBe(before.world.agents[f.t.b]!.balance + 30);
    expect(f.state.world.moneySupply).toBe(before.world.moneySupply);
    expect(f.state.coordination!.runs['exchange-run']).toMatchObject({
      status: 'succeeded',
      execution: {
        steps: [
          { authority: { principalId: f.t.b, executedBy: f.t.a, stepIndex: 0 } },
          { authority: { principalId: f.t.c, executedBy: f.t.a, stepIndex: 1 } },
          { authority: { principalId: f.t.c, executedBy: f.t.a, stepIndex: 2 } },
        ],
      },
    });
    expect(Object.values(f.state.coordination!.mandates).map((m) => m.usedRuns)).toEqual([1, 1]);
    expect(run(f).effects).toEqual({});
    expect(
      applyOpenSocietyEffects(
        before,
        JSON.parse(JSON.stringify(execution.effects)) as OpenSocietyEffects,
      ),
    ).toEqual(f.state);
  },
);
test('insufficient payment discards the successful temporary offer and acceptance without consuming mandates', () => {
  const f = fixture();
  // A separate, authorized payment empties the buyer's funds before this transaction.
  const buyer = f.state.world.agents[f.t.c]!;
  const payment = executeCommerceTool(
    f.state,
    f.t.manifest,
    f.t.c,
    'payments.transfer',
    { targetId: f.t.d, amount: buyer.balance, note: '先前独立支出' },
    'drain',
  );
  f.apply(payment.effects);
  const before = f.state,
    execution = run(f);
  expect(execution.error).toBe('insufficient-balance');
  expect(execution.effects.worldEvents?.length ?? 0).toBe(0);
  f.apply(execution.effects);
  expect(f.state.world).toEqual(before.world);
  expect(f.state.coordination!.mandates).toEqual(before.coordination!.mandates);
  expect(f.state.coordination!.runs['exchange-run']).toMatchObject({
    status: 'failed',
    reason: 'insufficient-balance',
  });
  expect(f.state.coordination!.runs['exchange-run']!.execution).toBeUndefined();
});
test('replay rejects missing, reordered, substituted or unproved steps even when effect references are repaired', () => {
  const f = fixture('space'),
    good = run(f).effects;
  const mutate = (change: (e: OpenSocietyEffects) => OpenSocietyEffects) =>
    expect(() => applyOpenSocietyEffects(f.state, change(structuredClone(good)))).toThrow();
  mutate(({ effectOrder: _order, ...e }) => {
    void _order;
    return e;
  });
  mutate((e) => ({ ...e, worldEvents: [] }));
  mutate((e) => ({
    ...e,
    effectOrder: { ...e.effectOrder!, entries: [...e.effectOrder!.entries].reverse() },
  }));
  mutate((e) => ({
    ...e,
    coordinationEvents: e.coordinationEvents!.map((v) => {
      if (v.type !== 'ProgramRunRecorded') return v;
      const { execution, ...run } = v.run;
      void execution;
      return { ...v, run };
    }),
  }));
  const world = good.worldEvents![0]!;
  if (world.type !== 'ResidentCommerceCommitted') throw Error('fixture');
  // Corrupt an amount and repair its SHA references: original signed arguments still reject it.
  const forged = {
    ...world,
    payload: {
      ...world.payload,
      transactions: world.payload.transactions.map((t) => ({
        ...t,
        entries: t.entries.map((e) => ({ ...e, amount: e.amount / 2 })),
      })),
    },
  };
  const newId = programEffectCommitments({ worldEvents: [forged] })[0]!.id;
  mutate((e) => ({
    ...e,
    worldEvents: [forged],
    coordinationEvents: e.coordinationEvents!.map((v) =>
      v.type === 'ProgramRunRecorded'
        ? {
            ...v,
            run: {
              ...v.run,
              execution: {
                ...v.run.execution!,
                steps: v.run.execution!.steps.map((s, n) =>
                  n === 2 ? { ...s, effectIds: [newId] } : s,
                ),
              },
            },
          }
        : v,
    ),
  }));
  expect(f.resource().control?.controller).not.toEqual({ kind: 'resident', id: f.t.c });
});
test('appending metadata preserves all ordered references and does not drop other domain families', () => {
  const f = fixture('group'),
    execution = run(f),
    merged = mergeProgramEffects({}, execution.effects);
  expect(validatedEffectOrder(merged)).toEqual(execution.effects.effectOrder);
  expect(applyOpenSocietyEffects(f.state, merged)).toEqual(
    applyOpenSocietyEffects(f.state, execution.effects),
  );
});
