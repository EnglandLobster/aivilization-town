import { expect, test } from 'vitest';
import { premisesConstructionFacts } from '@aivilization/premises';
import { observeConstructionTradeFacts } from '@aivilization/commerce';
import { residentConstructionFixture } from './testFixtures/residentConstruction';
import { residentConstructionTradeEvidence } from './constructionTradePorts';
import { applyWorldEvent } from './projection';
test('owning construction facts preserve one commitment across actual labor and full event replay', () => {
  const f = residentConstructionFixture();
  const original = residentConstructionTradeEvidence(f.w, 'p')!;
  expect(original).toMatchObject({
    status: 'open',
    progressMs: 0,
    basis: {
      projectId: 'p',
      beneficiary: { kind: 'resident', id: 'builder' },
      requiredWorkMs: 480000,
    },
  });
  expect(residentConstructionTradeEvidence(f.w, 'missing')).toBeUndefined();
  f.start();
  f.time(120000);
  f.tick();
  const partial = residentConstructionTradeEvidence(f.w, 'p')!;
  expect(partial.basis.specificationHash).toBe(original.basis.specificationHash);
  expect(
    observeConstructionTradeFacts(original.basis, original, partial, f.w.clock.now),
  ).toMatchObject({ accepted: true, observation: { objectiveDelivery: 'pending' } });
  f.time(360000);
  f.tick();
  const completed = residentConstructionTradeEvidence(f.w, 'p')!;
  expect(
    observeConstructionTradeFacts(original.basis, partial, completed, f.w.clock.now),
  ).toMatchObject({ accepted: true, observation: { objectiveDelivery: 'completed' } });
  const replay = f.events.reduce(applyWorldEvent, f.initial);
  expect(residentConstructionTradeEvidence(replay, 'p')).toEqual(completed);
  const serialized = JSON.parse(JSON.stringify(f.w.premises)) as NonNullable<typeof f.w.premises>;
  expect(residentConstructionTradeEvidence({ premises: serialized }, 'p')).toEqual(completed);
  f.replay();
});
test('returned specifications are detached and canonical hashes detect material or plan substitution', () => {
  const f = residentConstructionFixture(),
    original = residentConstructionTradeEvidence(f.w, 'p')!;
  const facts = premisesConstructionFacts(f.w.premises!, 'p')!;
  expect(facts.specification.plan).not.toBe(f.w.premises!.projects.p!.plan);
  const altered = structuredClone(f.w.premises!);
  const project = altered.projects.p!;
  const changed = {
    ...altered,
    projects: {
      ...altered.projects,
      p: { ...project, plan: { ...project.plan, materials: { Wood: 9 } } },
    },
  };
  const forged = residentConstructionTradeEvidence({ premises: changed }, 'p')!;
  expect(observeConstructionTradeFacts(original.basis, original, forged, 0)).toMatchObject({
    accepted: false,
    reason: 'construction-trade-basis-changed',
  });
  const reordered = {
    ...altered,
    projects: {
      ...altered.projects,
      p: {
        ...project,
        plan: {
          ...project.plan,
          blueprint: {
            ...project.plan.blueprint,
            fixtures: { storageUnits: 0, teachingStations: 0, careStations: 0, workstations: 0 },
          },
        },
      },
    },
  };
  expect(residentConstructionTradeEvidence({ premises: reordered }, 'p')).toEqual(original);
  expect(residentConstructionTradeEvidence(f.w, 'p')).toEqual(original);
});
