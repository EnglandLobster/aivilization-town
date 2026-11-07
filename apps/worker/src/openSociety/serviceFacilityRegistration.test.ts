import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { applyWorldEvent, parseDeclaredServiceFacilities } from '@aivilization/world';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
import { activateSocietyFoundations } from './societyActivation';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'facility-declaration-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({ count: 2, life: false, societyKernel: false });
  const r = new OpenSocietyRuntime(root, m);
  clean.push(() => r.close());
  expect(activateSocietyFoundations(r).status).toBe('enabled');
  expect(r.enableServiceEngagements().ok).toBe(true);
  return { r, root, m };
}
const declaration = [
  {
    locationId: 'clinic',
    careStations: 2,
    teachingStations: 0,
    sourceId: 'new-explicit-facility-1',
  },
  {
    locationId: 'school',
    careStations: 0,
    teachingStations: 2,
    sourceId: 'new-explicit-facility-1',
  },
];
test('explicit post-activation facilities preserve old facts, expose original sources, retry and replay', () => {
  const { r, root, m } = fixture();
  const before = structuredClone(r.state),
    manifest = readFileSync(join(root, 'manifest.json'));
  expect(before.world.premises?.serviceFacilityEndowments ?? {}).toEqual({});
  expect(r.registerServiceFacilities(declaration).ok).toBe(true);
  for (const field of [
    'agents',
    'moneySupply',
    'treasury',
    'clock',
    'materials',
    'enterprises',
    'serviceEngagements',
  ] as const)
    expect(r.state.world[field]).toEqual(before.world[field]);
  expect(r.state.world.premises!.buildings).toEqual(before.world.premises!.buildings);
  expect(r.state.world.premises!.serviceFacilityEndowments!.clinic).toEqual({
    ...declaration[0],
    source: 'authorized-extension',
  });
  const actor = m.residents[0]!.id;
  r.beginTurn(actor);
  const query = r.invoke(actor, {
    name: 'engagements.facilities',
    arguments: {},
    requestId: 'query-new-facts',
  });
  expect(query.ok).toBe(true);
  expect(JSON.stringify(query.data)).toContain('new-explicit-facility-1');
  r.finishTurn(actor, { summary: 'Source query only' });
  const state = structuredClone(r.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  expect(r.registerServiceFacilities(declaration).ok).toBe(true);
  expect(r.state).toEqual(state);
  expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  expect(readFileSync(join(root, 'manifest.json'))).toEqual(manifest);
  r.close();
  const reopened = new OpenSocietyRuntime(root);
  clean.push(() => reopened.close());
  expect(reopened.state).toEqual(state);
});
test('batch failure is atomic, finite location capacity is checked, and existing sources cannot be overwritten', () => {
  const { r } = fixture();
  const before = structuredClone(r.state);
  expect(
    r.registerServiceFacilities([declaration[0], { ...declaration[1], teachingStations: 21 }]).ok,
  ).toBe(false);
  expect(r.state).toEqual(before);
  for (const input of [
    [],
    [{ ...declaration[0], careStations: 0 }],
    [{ ...declaration[0], careStations: 1.5 }],
    [{ ...declaration[0], locationId: 'missing' }],
    [{ ...declaration[0], sourceId: '' }],
    [declaration[0], declaration[0]],
  ]) {
    expect(r.registerServiceFacilities(input).ok).toBe(false);
    expect(r.state).toEqual(before);
  }
  expect(r.registerServiceFacilities([{ ...declaration[0], careStations: 10 }]).ok).toBe(true);
  const state = structuredClone(r.state);
  expect(
    r.registerServiceFacilities([{ ...declaration[0], careStations: 1, sourceId: 'replacement' }])
      .ok,
  ).toBe(false);
  expect(r.state).toEqual(state);
  expect(() =>
    parseDeclaredServiceFacilities([{ ...declaration[0], ownerId: 'forged' }]),
  ).toThrow();
});
test('unfinished turns refuse operator injection and replay verifies source and real capacity', () => {
  const { r, m } = fixture();
  const actor = m.residents[0]!.id;
  r.beginTurn(actor);
  const during = structuredClone(r.state);
  expect(r.registerServiceFacilities(declaration).error).toBe('resident-turn-active');
  expect(r.state).toEqual(during);
  r.finishTurn(actor, { summary: 'finished' });
  const before = structuredClone(r.state.world);
  expect(r.registerServiceFacilities(declaration).ok).toBe(true);
  const event = r.journal.commits.at(-1)!.worldEvents![0]!;
  if (event.type !== 'ResidentServiceFacilitiesRegistered') throw Error('wrong-event');
  expect(() =>
    applyWorldEvent(before, {
      ...event,
      payload: {
        ...event.payload,
        facilities: [{ ...event.payload.facilities[0]!, careStations: 11 }],
      },
    }),
  ).toThrow('service-facility-source-or-location-invalid');
  expect(() =>
    applyWorldEvent(before, {
      ...event,
      payload: {
        ...event.payload,
        facilities: [{ ...event.payload.facilities[0]!, source: 'scenario-seed' }],
      },
    }),
  ).toThrow('service-facility-source-or-location-invalid');
  expect(applyWorldEvent(before, event)).toEqual(r.state.world);
});
