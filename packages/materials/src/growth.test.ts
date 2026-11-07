import { expect, test } from 'vitest';
import {
  applyMaterialCommit,
  createMaterialsPolicy,
  decideMaterialProduction,
  decideMaterialStock,
  emptyMaterialsState,
  isProductionCommand,
  materialExpertiseMultiplier,
  materialSourceWorkAvailable,
  regrowMaterialSources,
  settleMaterialProduction,
  MATERIAL_EXPERTISE_POLICY,
  MATERIAL_EXTRACTION_POLICY,
  MATERIAL_REGROWTH_POLICY,
  type MaterialCommand,
  type MaterialDecision,
  type MaterialEvent,
  type MaterialPorts,
  type MaterialSource,
} from './index';

const UNIT_MS = 200_000;
const source: MaterialSource = {
  id: 'wood',
  commodity: 'Wood',
  locationId: 'site',
  initialQuantity: 10,
  remaining: 10,
  workMs: UNIT_MS,
  energyCost: 4,
  satietyCost: 1,
  capacity: 2,
  revision: 1,
  at: 0,
};

function fixture() {
  const initial = emptyMaterialsState(
    createMaterialsPolicy([
      {
        id: 'board',
        version: 'board-v1',
        inputs: { Wood: 1 },
        outputs: { Board: 1 },
        workMs: 1000,
        energyCost: 4,
        satietyCost: 1,
        minResidentialTier: 1,
      },
    ]),
  );
  let s = initial,
    at = 0,
    n = 0;
  const batches: (readonly MaterialEvent[])[] = [];
  const busy: Record<string, { startedAt: number; until: number }> = {};
  const ports: MaterialPorts = {
    exists: (id) => ['a', 'b'].includes(id),
    present: () => true,
    idle: (id) => !busy[id] || busy[id].until <= at,
    mayStoreAt: () => true,
    inventory: () => ({}),
    body: () => ({ energy: 1000, satiety: 1000, residentialTier: 1, capable: true }),
    controlAvailable: () => true,
    authorize: () => undefined,
    hasExternalObligation: () => false,
    sessionReserved: (j) =>
      !!j.session &&
      busy[j.session.actorId]?.startedAt === j.session.startedAt &&
      busy[j.session.actorId]?.until === j.session.until,
    workstationAvailable: (id, actor) => materialSourceWorkAvailable(s, id, actor, at),
  };
  const commit = (events: readonly MaterialEvent[]) => {
    s = applyMaterialCommit(s, events).state;
    batches.push(events);
  };
  const apply = (d: MaterialDecision) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) {
      commit(d.events);
      if (d.reservation)
        busy[d.reservation.actorId] = { startedAt: at, until: d.reservation.until };
    }
    return d;
  };
  const call = (actor: string, c: MaterialCommand) =>
    apply(
      isProductionCommand(c)
        ? decideMaterialProduction(s, actor, at, `r${++n}`, c, ports)
        : decideMaterialStock(s, actor, at, `r${++n}`, c, ports),
    );
  commit([
    { type: 'MaterialExtractionEnabled', policy: MATERIAL_EXTRACTION_POLICY, sources: [source] },
  ]);
  commit([
    { type: 'MaterialExpertiseEnabled', policy: MATERIAL_EXPERTISE_POLICY },
    { type: 'MaterialRegrowthEnabled', policy: MATERIAL_REGROWTH_POLICY, at: 0 },
  ]);
  for (const actor of ['a', 'b'])
    call(actor, { type: 'create-stock', id: actor, locationId: 'site', title: actor });
  const extract = (actor: string, id: string, quantity: number, workers = [actor]) =>
    call(actor, {
      type: 'create-extraction',
      id,
      stockId: actor,
      expectedRevision: s.stocks[actor]!.revision,
      sourceId: 'wood',
      sourceRevision: s.extraction!.sources.wood!.revision,
      quantity,
      workers,
      productName: 'Wood',
      description: '',
    });
  const work = (actor: string, id: string) => {
    const job = s.productions[id]!;
    call(actor, {
      type: 'start-production',
      id,
      expectedRevision: job.revision,
      until: at + job.quantity * job.recipe.workMs,
    });
    at += job.quantity * job.recipe.workMs;
    apply(settleMaterialProduction(s, id, at, `r${++n}`, 'system', ports));
    delete busy[actor];
  };
  return {
    get s() {
      return s;
    },
    extract,
    work,
    commit,
    setTime: (v: number) => {
      at = v;
    },
    replay: () =>
      expect(
        batches.reduce((state, batch) => applyMaterialCommit(state, batch).state, initial),
      ).toEqual(s),
  };
}

test('the experience curve halves effort only after sustained practice and never passes its floor', () => {
  const p = MATERIAL_EXPERTISE_POLICY;
  expect(materialExpertiseMultiplier(p, 0)).toBe(1);
  expect(materialExpertiseMultiplier(p, p.referenceWorkMs)).toBeCloseTo(0.8, 8);
  expect(materialExpertiseMultiplier(p, 3 * p.referenceWorkMs)).toBeCloseTo(0.64, 8);
  expect(materialExpertiseMultiplier(p, 1e12)).toBe(p.floorMultiplier);
});

test('committed working time makes the same person faster, not a partner who never practiced', () => {
  const f = fixture();
  f.extract('a', 'first', 9);
  expect(f.s.productions.first!.expertise).toBeUndefined();
  f.work('a', 'first');
  expect(f.s.expertise!.experienceMs.a).toEqual({ Wood: 9 * UNIT_MS });

  f.extract('a', 'practiced', 1);
  const practiced = f.s.productions.practiced!;
  expect(practiced.expertise).toEqual({
    version: MATERIAL_EXPERTISE_POLICY.version,
    multiplier: 0.64,
  });
  expect(practiced.recipe).toMatchObject({
    workMs: Math.round(UNIT_MS * 0.64),
    energyCost: 2.56,
    satietyCost: 0.64,
  });
  f.work('a', 'practiced');
  expect(f.s.stocks.a!.inventory.Wood).toBe(10);

  // A shared batch moves at the pace of its least experienced listed worker.
  f.commit(regrowMaterialSources(f.s, 86_400_000));
  f.setTime(86_400_000);
  f.extract('a', 'shared', 1, ['a', 'b']);
  expect(f.s.productions.shared!.expertise).toBeUndefined();
  f.replay();
});

test('a forged faster recipe is rejected by replay validation', () => {
  const f = fixture();
  f.extract('a', 'job', 1);
  const job = f.s.productions.job!;
  expect(() =>
    f.commit([
      {
        type: 'MaterialProductionChanged',
        production: {
          ...job,
          id: 'forged',
          expertise: { version: MATERIAL_EXPERTISE_POLICY.version, multiplier: 0.5 },
          recipe: { ...job.recipe, workMs: 1 },
          revision: 1,
        },
      },
    ]),
  ).toThrow('invalid-extraction-production-source');
});

test('sources regrow in whole units up to their original endowment, carrying fractions forward', () => {
  const f = fixture();
  f.extract('a', 'job', 10);
  f.work('a', 'job');
  expect(f.s.extraction!.sources.wood!.remaining).toBe(0);
  const day = MATERIAL_REGROWTH_POLICY.dayMs;
  const lastAt = f.s.regrowth!.lastAt;
  // 0.25 day of 20%/day on 10 units is 0.5 unit: nothing yet, but the fraction is kept.
  f.commit(regrowMaterialSources(f.s, lastAt + day / 4));
  expect(f.s.extraction!.sources.wood!.remaining).toBe(0);
  expect(f.s.regrowth!.carry.wood).toBeCloseTo(0.5, 8);
  f.commit(regrowMaterialSources(f.s, lastAt + day / 2));
  expect(f.s.extraction!.sources.wood!.remaining).toBe(1);
  f.commit(regrowMaterialSources(f.s, lastAt + 100 * day));
  expect(f.s.extraction!.sources.wood!.remaining).toBe(10);
  expect(f.s.regrowth!.carry).toEqual({});
  f.replay();
});

test('regrowth cannot be inflated beyond what the policy computes', () => {
  const f = fixture();
  f.extract('a', 'job', 10);
  f.work('a', 'job');
  const honest = regrowMaterialSources(f.s, f.s.regrowth!.lastAt + MATERIAL_REGROWTH_POLICY.dayMs);
  const inflated = honest.map((e) =>
    e.type === 'MaterialSourceChanged' ? { ...e, source: { ...e.source, remaining: 9 } } : e,
  );
  expect(() => f.commit(inflated)).toThrow('material-regrowth-must-match-policy');
  f.commit(honest);
  expect(f.s.extraction!.sources.wood!.remaining).toBe(2);
});

test('full sources write no regrowth events and a later depletion is not regrown retroactively', () => {
  const f = fixture();
  const day = MATERIAL_REGROWTH_POLICY.dayMs;
  expect(regrowMaterialSources(f.s, 10 * day)).toEqual([]);
  // Deplete on day 10: growth starts then, not from the enabling time at 0.
  f.setTime(10 * day);
  f.extract('a', 'late', 10);
  f.work('a', 'late');
  f.commit(regrowMaterialSources(f.s, 10 * day + day / 2));
  expect(f.s.extraction!.sources.wood!.remaining).toBe(1);
  f.replay();
});
