import { expect, test } from 'vitest';
import {
  emptyElapsedStudyState,
  startElapsedStudy,
  progressElapsedStudy,
  stopElapsedStudy,
  applyElapsedStudyEvent,
  elapsedStudyEffects,
  studyAllocationAt,
  ELAPSED_STUDY_POLICY,
  type ElapsedStudyEvent,
  type StudyTerms,
} from './elapsedStudy';

const terms: StudyTerms = {
  modelVersion: 'external-study-model-v1',
  sourceKind: 'external-course',
  sourceId: 'external-education',
  fundingAuthorityId: 'personal-course-quote-1',
  allocation: {
    residentMicros: 100_000_007,
    treasuryMicros: 50_000_003,
    inventoryNanoUnits: { Book: 1_000_000_000 },
    educationNanoPoints: 3_000_000_000,
  },
};
function fixture() {
  const initial = emptyElapsedStudyState();
  let state = initial;
  const events: ElapsedStudyEvent[] = [];
  const commit = (d: ReturnType<typeof startElapsedStudy>) => {
    if (!d.accepted) throw Error(d.reason);
    const effects = d.events.map((e) => {
      const effect = elapsedStudyEffects(state, e);
      state = applyElapsedStudyEvent(state, e);
      events.push(e);
      return effect;
    });
    return effects;
  };
  const start = () =>
    commit(
      startElapsedStudy({
        state,
        actorId: 'alice',
        id: 'course',
        locationId: 'school',
        at: 0,
        durationMs: 1000,
        terms,
      }),
    );
  return {
    initial,
    events,
    commit,
    start,
    get state() {
      return state;
    },
    get session() {
      return state.sessions.course!;
    },
    progress: (at: number) => commit(progressElapsedStudy(state, 'course', at)),
    replay: () => expect(events.reduce(applyElapsedStudyEvent, initial)).toEqual(state),
  };
}
test('study reserves resources without prepaid knowledge; actual progress consumes only its share and early stop refunds unperformed resources', () => {
  const f = fixture();
  const [start] = f.start();
  expect(start).toEqual({
    reserve: { ...terms.allocation, educationNanoPoints: 0 },
    applied: {
      residentMicros: 0,
      treasuryMicros: 0,
      inventoryNanoUnits: {},
      educationNanoPoints: 0,
    },
    refund: {
      residentMicros: 0,
      treasuryMicros: 0,
      inventoryNanoUnits: {},
      educationNanoPoints: 0,
    },
    reserveTime: true,
    releaseTime: false,
  });
  const [part] = f.progress(333);
  expect(f.session).toMatchObject({ elapsedMs: 333, status: 'active' });
  expect(part!.applied.educationNanoPoints).toBe(999_000_000);
  expect(part!.applied.residentMicros).toBe(33_300_002);
  expect(part!.applied.inventoryNanoUnits).toEqual({ Book: 333_000_000 });
  const [end] = f.commit(
    stopElapsedStudy({
      state: f.state,
      id: 'course',
      actorId: 'alice',
      expectedRevision: f.session.revision,
      at: 333,
    }),
  );
  expect(end!.applied.educationNanoPoints).toBe(0);
  expect(end!.refund.educationNanoPoints).toBe(0);
  expect(part!.applied.residentMicros + end!.refund.residentMicros).toBe(
    terms.allocation.residentMicros,
  );
  expect(part!.applied.treasuryMicros + end!.refund.treasuryMicros).toBe(
    terms.allocation.treasuryMicros,
  );
  expect(part!.applied.inventoryNanoUnits.Book! + end!.refund.inventoryNanoUnits.Book!).toBe(
    1_000_000_000,
  );
  expect(f.session).toMatchObject({ status: 'interrupted', endReason: 'participant-left' });
  expect(f.state.activeByActor.alice).toBeUndefined();
  expect(progressElapsedStudy(f.state, 'course', 1000)).toEqual({
    accepted: false,
    reason: 'study-not-active',
  });
  f.replay();
});
test('only the participant or the system with an explicit physical/permission reason can stop the settled current version', () => {
  const f = fixture();
  f.start();
  f.progress(500);
  const args = {
    state: f.state,
    id: 'course',
    actorId: 'alice',
    expectedRevision: f.session.revision,
    at: 500,
  };
  expect(stopElapsedStudy({ ...args, actorId: 'bob' })).toEqual({
    accepted: false,
    reason: 'study-stop-authority-required',
  });
  expect(stopElapsedStudy({ ...args, expectedRevision: 1 })).toEqual({
    accepted: false,
    reason: 'study-revision-conflict',
  });
  expect(stopElapsedStudy({ ...args, at: 750 })).toEqual({
    accepted: false,
    reason: 'study-progress-must-be-settled',
  });
  expect(stopElapsedStudy({ ...args, actorId: 'bob', reason: 'permission-ended' })).toEqual({
    accepted: false,
    reason: 'study-stop-authority-required',
  });
  f.commit(stopElapsedStudy({ ...args, actorId: 'system', reason: 'permission-ended' }));
  expect(f.session.endReason).toBe('permission-ended');
  f.replay();
});
test('irregular partitions and redundant progress leave exactly the same resource totals and knowledge as one complete interval', () => {
  const one = fixture(),
    many = fixture();
  one.start();
  many.start();
  const [all] = one.progress(1800);
  const slices = [1, 19, 120, 120, 333, 997, 1000].flatMap((at) => many.progress(at));
  for (const field of ['residentMicros', 'treasuryMicros', 'educationNanoPoints'] as const)
    expect(slices.reduce((n, e) => n + e.applied[field], 0)).toBe(all!.applied[field]);
  expect(slices.reduce((n, e) => n + (e.applied.inventoryNanoUnits.Book ?? 0), 0)).toBe(
    1_000_000_000,
  );
  expect(many.session.applied).toEqual(one.session.applied);
  expect(many.session).toMatchObject({
    status: 'completed',
    endReason: 'completed',
    elapsedMs: 1000,
    settledAt: 1000,
  });
  expect(slices.at(-1)!.refund.residentMicros).toBe(0);
  one.replay();
  many.replay();
});
test('invalid definitions, duplicates, impossible time and oversized fixed units are rejected without producing an event', () => {
  const f = fixture();
  const args = {
    state: f.state,
    id: 'course',
    actorId: 'alice',
    locationId: 'school',
    at: 0,
    durationMs: 1000,
    terms,
  };
  for (const durationMs of [0, -1, 0.5, Infinity, ELAPSED_STUDY_POLICY.maxDurationMs + 1])
    expect(startElapsedStudy({ ...args, durationMs }).accepted).toBe(false);
  expect(startElapsedStudy({ ...args, at: Number.MAX_SAFE_INTEGER }).accepted).toBe(false);
  expect(
    startElapsedStudy({
      ...args,
      terms: { ...terms, allocation: { ...terms.allocation, residentMicros: 0.5 } },
    }).accepted,
  ).toBe(false);
  expect(
    startElapsedStudy({
      ...args,
      terms: {
        ...terms,
        allocation: { ...terms.allocation, residentMicros: Number.MAX_SAFE_INTEGER },
      },
    }).accepted,
  ).toBe(false);
  f.start();
  expect(startElapsedStudy({ ...args, state: f.state }).accepted).toBe(false);
  expect(startElapsedStudy({ ...args, state: f.state, id: 'second' })).toEqual({
    accepted: false,
    reason: 'study-already-active',
  });
  f.progress(500);
  expect(progressElapsedStudy(f.state, 'course', 499)).toEqual({
    accepted: false,
    reason: 'invalid-study-progress-time',
  });
  expect(() => studyAllocationAt(terms.allocation, 1001, 1000)).toThrow(
    'invalid-study-allocation-time',
  );
  const invalidPolicy = { ...ELAPSED_STUDY_POLICY };
  Reflect.set(invalidPolicy, 'maxDurationMs', 1000);
  expect(() => emptyElapsedStudyState(invalidPolicy)).toThrow('unsupported-elapsed-study-policy');
});
test('replay rejects invented knowledge, changed funding/source/terms, time regression and replayed refunds', () => {
  const f = fixture();
  f.start();
  const before = f.state;
  f.progress(400);
  const progress = f.events[1]!;
  const fake: ElapsedStudyEvent = {
    ...progress,
    session: {
      ...progress.session,
      applied: { ...progress.session.applied, educationNanoPoints: 3_000_000_000 },
    },
  };
  expect(() => applyElapsedStudyEvent(before, fake)).toThrow('invalid-study-event');
  const changed = {
    ...progress,
    session: {
      ...progress.session,
      terms: { ...progress.session.terms, fundingAuthorityId: 'someone-elses-grant' },
    },
  };
  expect(() => applyElapsedStudyEvent(before, changed)).toThrow('invalid-study-transition');
  // A serializer's key order must never change replay semantics.
  const reordered = JSON.parse(
    JSON.stringify(progress, (_: string, v: unknown): unknown =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse())
        : v,
    ),
  ) as ElapsedStudyEvent;
  expect(applyElapsedStudyEvent(before, reordered)).toEqual(f.state);
  f.commit(
    stopElapsedStudy({
      state: f.state,
      id: 'course',
      actorId: 'alice',
      expectedRevision: f.session.revision,
      at: 400,
    }),
  );
  expect(() => elapsedStudyEffects(f.state, f.events.at(-1)!)).toThrow('invalid-study-transition');
  f.replay();
});

test('population study interruption preserves applied allocation and refunds only unperformed work', () => {
  const f = fixture();
  f.start();
  f.progress(400);
  const applied = structuredClone(f.session.applied);
  const request = {
    state: f.state,
    id: 'course',
    expectedRevision: f.session.revision,
    at: 400,
    reason: 'population-departure' as const,
  };
  expect(stopElapsedStudy({ ...request, actorId: 'alice' }).accepted).toBe(false);
  const effects = f.commit(stopElapsedStudy({ ...request, actorId: 'system' }))[0]!;
  expect(f.session).toMatchObject({
    status: 'interrupted',
    endReason: 'population-departure',
    applied,
  });
  expect(effects.applied.educationNanoPoints).toBe(0);
  expect(effects.refund.residentMicros).toBe(
    terms.allocation.residentMicros - applied.residentMicros,
  );
  expect(effects.refund.treasuryMicros).toBe(
    terms.allocation.treasuryMicros - applied.treasuryMicros,
  );
  f.replay();
});
