import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { createTownManifest } from './runProfile';
import { OpenSocietyRuntime } from './runtime';
import { applyOpenSocietyEffects, hasExperience, initialOpenSocietyState } from './state';
import type { OpenSocietyState, ResidentExperience } from './types';

const manifest = createOpenSocietyManifest({ count: 2 });
const [a, b] = manifest.residents.map((r) => r.id) as [string, string];
const experience = (ownerId: string, id: string): ResidentExperience => ({
  id,
  ownerId,
  at: 0,
  kind: 'observation',
  summary: id,
  sourceIds: [],
  people: [],
  provenance: 'firsthand',
});
const append = (state: OpenSocietyState, ...items: ResidentExperience[]) =>
  applyOpenSocietyEffects(state, { experiences: items });

test('experiences append in order per owner and reject duplicates within and across commits', () => {
  const s0 = initialOpenSocietyState(manifest);
  const s1 = append(s0, experience(a, 'a1'), experience(b, 'b1'), experience(a, 'a2'));
  expect(s1.experiences[a]!.map((e) => e.id)).toEqual(['a1', 'a2']);
  expect(s1.experiences[b]!.map((e) => e.id)).toEqual(['b1']);
  expect(hasExperience(s1, a, 'a2')).toBe(true);
  expect(hasExperience(s1, b, 'a2')).toBe(false);
  expect(() => append(s1, experience(a, 'a3'), experience(a, 'a3'))).toThrow(
    'duplicate-experience-id',
  );
  expect(() => append(s1, experience(b, 'b2'), experience(a, 'a1'))).toThrow(
    'duplicate-experience-id',
  );
  // A refused commit leaves no trace: the IDs it carried are still free.
  const s2 = append(s1, experience(a, 'a3'), experience(b, 'b2'));
  expect(s2.experiences[a]!.map((e) => e.id)).toEqual(['a1', 'a2', 'a3']);
  // Earlier states stay valid and can be extended on their own branch.
  expect(hasExperience(s1, a, 'a3')).toBe(false);
  const branch = append(s1, experience(a, 'a3'));
  expect(branch.experiences[a]!.map((e) => e.id)).toEqual(['a1', 'a2', 'a3']);
  expect(s1.experiences[a]!.map((e) => e.id)).toEqual(['a1', 'a2']);
  // No experiences: nothing is copied.
  expect(append(s2).experiences).toBe(s2.experiences);
});

test('appending stays fast as a resident accumulates many experiences', () => {
  let state = initialOpenSocietyState(manifest);
  const started = performance.now();
  // 2,000 commits of 25 experiences each: the old one-by-one copy took quadratic time here.
  for (let commit = 0; commit < 2000; commit++)
    state = append(
      state,
      ...Array.from({ length: 25 }, (_, i) => experience(i % 2 ? a : b, `e-${commit}-${i}`)),
    );
  expect(state.experiences[a]!.length + state.experiences[b]!.length).toBe(50_000);
  expect(performance.now() - started).toBeLessThan(5_000);
});

test('clock-driven bookkeeping is current state, not a memory per tick', () => {
  const root = mkdtempSync(join(tmpdir(), 'tick-memories-'));
  try {
    const m = createTownManifest({ count: 2, initialization: 'settled' });
    const runtime = new OpenSocietyRuntime(root, m);
    try {
      const actor = m.residents[0]!.id;
      const before = runtime.state.experiences[actor]?.length ?? 0;
      for (let hour = 0; hour < 24; hour++)
        expect(runtime.advanceTime(3_600_000, `tick-${hour}`).ok).toBe(true);
      const events = runtime.journal.commits.flatMap((c) => c.worldEvents ?? []);
      // The day really charged upkeep and moved bodies; none of it became a memory.
      expect(events.some((e) => e.type === 'PhysiologyChanged')).toBe(true);
      const added = (runtime.state.experiences[actor] ?? []).slice(before);
      const tick =
        /^(ResidentialUpkeepCharged|ResidentialUpkeepArrearsUpdated|SubsidyPaid):|^PhysiologyChanged:.*"reason":"elapsed-physiology"/;
      expect(added.filter((e) => tick.test(e.summary))).toEqual([]);
      // Events that change a body for another reason, such as falling ill, are still remembered.
      const illness = events.filter(
        (e) =>
          e.type === 'PhysiologyChanged' &&
          e.payload.reason === 'stochastic-illness' &&
          e.payload.agentId === actor,
      ).length;
      expect(added.filter((e) => e.summary.includes('stochastic-illness')).length).toBe(illness);
      const { self } = runtime.context(actor) as unknown as {
        self: { physiology: unknown; balance: unknown };
      };
      expect(self.physiology).toBeTypeOf('object');
      expect(self.balance).toBeTypeOf('number');
    } finally {
      runtime.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
