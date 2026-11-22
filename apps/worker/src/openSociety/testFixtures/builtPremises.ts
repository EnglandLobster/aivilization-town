import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenSocietyRuntime } from '../runtime';
import { openPremisesFixture, premisesCleanup } from './openPremises';

/** A town with one finished production building, `home`, built by resident c. */
export function builtPremisesFixture(options: Parameters<typeof openPremisesFixture>[3] = {}) {
  const t = openPremisesFixture(
    true,
    true,
    { primaryUse: 'production', workstations: 1, storageUnits: 10 },
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
  return { ...t, building, replay };
}
