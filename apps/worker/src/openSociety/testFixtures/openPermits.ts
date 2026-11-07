import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenSocietyRuntime } from '../runtime';
import { openPremisesFixture, premisesCleanup } from './openPremises';

export function openPermitsFixture(
  rights = true,
  options: Parameters<typeof openPremisesFixture>[4] = {},
) {
  const t = openPremisesFixture(
    true,
    true,
    { primaryUse: 'production', workstations: 1, storageUnits: 10 },
    rights,
    options,
  );
  t.reserve(undefined, { Wood: 8.1, 'Iron Ingot': 1 });
  t.create();
  t.ok(t.c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + t.project().plan.workMs,
  });
  t.time(t.project().plan.workMs);
  const building = () => t.r.state.world.premises!.buildings.home!;
  const offer = (id = 'permit', extra: Record<string, unknown> = {}) => ({
    id,
    buildingId: 'home',
    buildingRevision: building().revision,
    granteeKind: 'resident',
    granteeId: t.c,
    users: [t.c],
    scopes: ['operate', 'store'],
    mode: 'shared',
    title: '居民的工坊约定',
    terms: '原文不自动变成劳动或评价',
    startAt: t.r.state.world.clock.now,
    endAt: t.r.state.world.clock.now + 3600000,
    acceptBy: t.r.state.world.clock.now + 60000,
    ...extra,
  });
  const replay = () => {
    const state = t.r.state,
      journal = readFileSync(join(t.root, 'journal.jsonl'), 'utf8');
    t.r.close();
    const r = new OpenSocietyRuntime(t.root);
    premisesCleanup.push(() => r.close());
    expect(r.state).toEqual(state);
    expect(readFileSync(join(t.root, 'journal.jsonl'), 'utf8')).toBe(journal);
    return r;
  };
  return { ...t, building, offer, replay };
}
