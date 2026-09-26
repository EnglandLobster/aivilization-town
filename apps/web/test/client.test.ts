import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTownClient } from '../client/store';
import type { TownClient } from '../client/store';
import { text } from '../client/model';
const requestPath = (value: RequestInfo | URL) =>
  typeof value === 'string' ? value : value instanceof URL ? value.href : value.url;
let client: TownClient;
const partition = (key: string) => ({ simulationId: 'sim', partitionKey: key });
function response(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
}
function backend(path: string): unknown {
  if (path === '/runtime/status') return { partitions: [partition('p1'), partition('p2')] };
  if (path === '/runtime/daemon/status') return { health: 'healthy' };
  if (path === '/access/session')
    return {
      policy: { mode: 'authenticated', consentPolicyVersion: 'consent-v1' },
      authentication: { authenticated: true },
    };
  if (path.endsWith('/projection'))
    return {
      projection: { agents: {}, clock: { now: path.includes('/p2/') ? 222 : 111 } },
      lastAppliedSequence: 5,
    };
  return [];
}
beforeEach(() => {
  vi.stubGlobal('window', {
    location: { hash: '#map' },
    history: { replaceState: vi.fn() },
    sessionStorage: { getItem: () => '', setItem: vi.fn(), removeItem: vi.fn() },
  });
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string) => Promise.resolve(response(backend(path)))),
  );
  client = createTownClient();
});
afterEach(() => {
  client.destroy();
  vi.unstubAllGlobals();
});

test('the map loads basic observations without requesting hidden cognition or market panels', async () => {
  await client.refresh();
  expect(client.getSnapshot().town.clock).toBe(111);
  const paths = vi.mocked(fetch).mock.calls.map(([path]) => requestPath(path));
  expect(paths.some((path) => path.includes('agent-cycle-traces'))).toBe(false);
  expect(paths.some((path) => path.includes('market-observations'))).toBe(false);
  client.setView('market');
  await vi.waitFor(() => expect(client.getSnapshot().resources).toHaveProperty('trades'));
  expect(
    vi.mocked(fetch).mock.calls.some(([path]) => requestPath(path).includes('trades?limit=50')),
  ).toBe(true);
});

test('a response from a previous partition cannot overwrite the new observation', async () => {
  await client.refresh();
  let release: (value: Response) => void = () => {
    throw new Error('request was not started');
  };
  vi.mocked(fetch).mockImplementation((input) => {
    const path = requestPath(input);
    if (path.includes('/p1/projection'))
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return Promise.resolve(response(backend(path)));
  });
  const previous = client.refresh();
  await vi.waitFor(() => expect(client.getSnapshot().loading).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  client.setPartition('sim/p2');
  release(response({ projection: { clock: { now: 999 } }, lastAppliedSequence: 99 }));
  await previous;
  await vi.waitFor(() => expect(client.getSnapshot().town.clock).toBe(222));
  expect(client.getSnapshot().partition.partitionKey).toBe('p2');
  expect(client.getSnapshot().town.sequence).toBe(5);
});

test('participant commands require consent and carry the current consent version', async () => {
  await client.refresh();
  await expect(client.mutate('/objectives', { agentId: 'a' }, true)).rejects.toThrow('consent');
  await client.authenticate('test-token', true);
  await client.mutate('/objectives', { agentId: 'a', statement: 'Study' }, true);
  const call = vi
    .mocked(fetch)
    .mock.calls.find(
      ([path, options]) => requestPath(path).endsWith('/objectives') && options?.method === 'POST',
    );
  expect(call?.[1]?.headers).toMatchObject({ authorization: 'Bearer test-token' });
  expect(JSON.parse(text(call?.[1]?.body, '{}'))).toEqual({
    agentId: 'a',
    statement: 'Study',
    consentPolicyVersion: 'consent-v1',
  });
});
