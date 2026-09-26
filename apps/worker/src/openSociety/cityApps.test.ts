import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { CITY_APPS, CITY_SERVICES_AUTHOR } from '@aivilization/content';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';

const roots: string[] = [];
const runtimes: OpenSocietyRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(cityApps = true) {
  const root = mkdtempSync(join(tmpdir(), 'city-apps-'));
  roots.push(root);
  const manifest = createOpenSocietyManifest({ count: 2, cityApps });
  const runtime = new OpenSocietyRuntime(root, manifest);
  runtimes.push(runtime);
  const a = manifest.residents[0]!.id,
    b = manifest.residents[1]!.id;
  runtime.beginTurn(a);
  runtime.beginTurn(b);
  let ordinal = 0;
  const call = (name: string, args: Record<string, unknown>, actor = a) =>
    runtime.invoke(actor, { name, arguments: args, requestId: `app-request-${++ordinal}` });
  return { runtime, root, manifest, a, b, call };
}
test('new towns install six apps once; context provides only bounded entry points', () => {
  const { runtime, manifest, a, call } = setup();
  expect(runtime.state.cityApps?.apps).toHaveLength(6);
  expect(Object.values(runtime.state.information.spaces)).toHaveLength(8);
  expect(Object.values(runtime.state.information.documents)).toHaveLength(15);
  expect(
    Object.values(runtime.state.information.documents).every(
      (doc) => doc.authorId === CITY_SERVICES_AUTHOR,
    ),
  ).toBe(true);
  expect(runtime.state.world).toEqual(manifest.initialWorld);
  expect(runtime.context(a).publicServices?.apps).toHaveLength(6);
  expect(JSON.stringify(runtime.context(a).publicServices)).not.toContain('可选空模板');
  expect(call('files.index', { prefix: 'posts/' })).toMatchObject({ ok: true, data: { total: 0 } });
  expect(call('files.read', { spaceId: 'city-directory', path: 'index.md' })).toMatchObject({
    ok: true,
    data: { authorId: CITY_SERVICES_AUTHOR },
  });
  for (const app of CITY_APPS)
    for (const channel of app.channels) {
      expect(call('files.read', { spaceId: channel.spaceId, path: 'README.md' }).ok).toBe(true);
      expect(call('files.read', { spaceId: channel.spaceId, path: 'TEMPLATE.md' }).ok).toBe(true);
    }
  const revision = runtime.state.revision;
  runtime.installCityApps();
  expect(runtime.state.revision).toBe(revision);
});
test('two residents discover and read original posts; foreign edits and guide edits are refused', () => {
  const { runtime, a, b, call } = setup();
  const original = '  不要求大家同意我的感受。\n<script>globalThis.injected=true</script>\n';
  expect(
    call('files.create', {
      spaceId: 'app-shops',
      path: 'posts/my-shop.md',
      title: '我的开店想法',
      relatedTo: 'restaurant',
      content: original,
    }).ok,
  ).toBe(true);
  const indexed = call(
    'files.index',
    { spaceId: 'app-shops', relatedTo: 'restaurant', prefix: 'posts/' },
    b,
  );
  expect(indexed).toMatchObject({
    ok: true,
    data: { total: 1, items: [{ authorId: a, title: '我的开店想法', relatedTo: 'restaurant' }] },
  });
  expect(JSON.stringify(indexed)).not.toContain(original);
  expect(JSON.stringify(indexed)).not.toContain('content');
  expect(call('files.read', { spaceId: 'app-shops', path: 'posts/my-shop.md' }, b)).toMatchObject({
    data: { content: original },
  });
  expect(
    call(
      'files.create',
      {
        spaceId: 'app-reviews',
        path: 'posts/b.md',
        title: '尚未去过，想问问',
        relatedTo: 'restaurant',
        tags: ['询问'],
        content: '我没有消费过，仅表达兴趣。',
      },
      b,
    ).ok,
  ).toBe(true);
  expect(call('files.index', { relatedTo: 'restaurant', prefix: 'posts/' })).toMatchObject({
    data: { total: 2 },
  });
  for (const [spaceId, path] of [
    ['app-shops', 'posts/my-shop.md'],
    ['app-reviews', 'README.md'],
  ]) {
    expect(
      call('files.update', { spaceId, path, content: '覆盖', expectedRevision: 1 }, b),
    ).toMatchObject({ ok: false, error: 'permission-denied' });
    expect(call('files.delete', { spaceId, path, expectedRevision: 1 }, b)).toMatchObject({
      ok: false,
      error: 'permission-denied',
    });
  }
  expect(Object.keys(runtime.state.world.enterprises)).toHaveLength(0);
});
test('legacy installation is explicit, idempotent and replays exactly including originals', () => {
  const { runtime, root, manifest, a, call } = setup(false);
  expect(runtime.context(a)).not.toHaveProperty('publicServices');
  runtime.installCityApps();
  call('files.create', {
    spaceId: 'app-community',
    path: 'posts/a.md',
    title: '原话',
    content: '\n原文  \n',
  });
  const expected = structuredClone(runtime.state);
  runtime.close();
  const reopened = new OpenSocietyRuntime(root);
  runtimes.push(reopened);
  expect(reopened.state).toEqual(expected);
  expect(reopened.manifest).toEqual(manifest);
  reopened.installCityApps();
  expect(reopened.state.revision).toBe(expected.revision);
});
test('an occupied app ID aborts all seed writes and preserves previous user data', () => {
  const { runtime, call } = setup(false);
  call('spaces.create', {
    id: 'app-reviews',
    title: '居民先创建的空间',
    visibility: 'public',
    posting: 'owner',
  });
  const before = structuredClone(runtime.state);
  expect(() => runtime.installCityApps()).toThrow('city-app-install-conflict');
  expect(runtime.state).toEqual(before);
  expect(runtime.state.information.spaces['city-directory']).toBeUndefined();
});
