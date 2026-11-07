import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
import { startResidentServer } from './server';
import { loadResidentCredentials } from './credentials';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup.length = 0;
});
test('admin resources expose paged owning facts only to admin, reject ambiguous queries, and leave journal untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'admin-resources-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 2,
    materials: true,
    societyKernel: true,
    premises: false,
  });
  const r = new OpenSocietyRuntime(root, m);
  cleanup.push(() => r.close());
  const actor = m.residents[0]!.id;
  for (const id of ['s-c', 's-a', 's-b']) {
    r.beginTurn(actor);
    const result = r.invoke(actor, {
      name: 'stocks.create',
      arguments: {
        id,
        title: '<img src=x onerror=alert(1)>',
        locationId: r.state.world.agents[actor]!.locationId,
      },
      requestId: id,
    });
    expect(result.ok, result.error).toBe(true);
    r.finishTurn(actor, { summary: 'engineering fixture' });
  }
  const credentials = loadResidentCredentials(
    root,
    m.residents.map((x) => x.id),
  );
  const server = await startResidentServer(r, credentials, 0);
  cleanup.push(() => server.close());
  const get = (query = '', token = credentials.admin) =>
    fetch(server.url + '/admin/resources' + query, {
      headers: { Authorization: 'Bearer ' + token },
    });
  const state = structuredClone(r.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  expect((await get('', credentials.residents[actor])).status).toBe(403);
  expect((await get('', 'invalid')).status).toBe(401);
  const index: unknown = await (await get()).json();
  const expectedSections: unknown = expect.arrayContaining([
    { id: 'stocks', title: '材料库存', statePath: 'materials', present: true, total: 3 },
    { id: 'buildings', title: '实体建筑', statePath: 'premises', present: false, total: 0 },
  ]);
  expect(index).toMatchObject({
    version: 'admin-resource-read-v1',
    revision: state.revision,
    sections: expectedSections,
  });
  const page: unknown = await (await get('?section=stocks&limit=2')).json();
  expect(page).toMatchObject({ items: [{ id: 's-a' }, { id: 's-b' }], nextOffset: 2 });
  expect(JSON.stringify(page)).not.toMatch(/"(?:inventory|control)":/);
  const second: unknown = await (await get('?section=stocks&limit=2&offset=2')).json();
  expect(second).toMatchObject({ items: [{ id: 's-c' }], nextOffset: null });
  const detail: unknown = await (await get('?section=stocks&id=s-a')).json();
  expect(detail).toMatchObject({ record: state.world.materials!.stocks['s-a'] });
  for (const query of [
    '?section=stocks&section=stocks',
    '?section=stocks&limit=31',
    '?section=stocks&limit=0',
    '?section=stocks&offset=-1',
    '?section=stocks&offset=1.2',
    '?section=stocks&id=s-a&limit=1',
    '?path=world.agents',
  ])
    expect((await get(query)).status, query).toBe(400);
  for (const query of [
    '?section=unknown',
    '?section=stocks&id=constructor',
    '?section=buildings&id=missing',
  ])
    expect((await get(query)).status, query).toBe(404);
  expect(r.state).toEqual(state);
  expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
});
