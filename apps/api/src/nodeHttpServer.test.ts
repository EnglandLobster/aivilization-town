import { afterEach, describe, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { createTownNodeHttpServer, type TownHttpApiHandler } from './index';

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server !== undefined) {
      await closeServer(server);
    }
  }
});

describe('Node HTTP API server adapter', () => {
  test('forwards method, path, query, and JSON body to the injected town handler', async () => {
    const requests: unknown[] = [];
    const server = await listen(
      createTownNodeHttpServer({
        handler: (request) => {
          requests.push(request);
          return Promise.resolve({
            status: 202,
            headers: { 'content-type': 'application/json', 'x-town-trace': 'trace-1' },
            body: { accepted: true, echo: request.body },
          });
        },
      }),
    );

    const response = await fetch(
      `${server.baseUrl}/runtime/start?manifestId=town-runtime&tag=alpha&tag=beta`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operationId: 'op-start-100', requestedAt: 100 }),
      },
    );

    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-town-trace')).toBe('trace-1');
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      echo: { operationId: 'op-start-100', requestedAt: 100 },
    });
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/runtime/start',
        query: {
          manifestId: 'town-runtime',
          tag: ['alpha', 'beta'],
        },
        body: { operationId: 'op-start-100', requestedAt: 100 },
      },
    ]);
  });

  test('returns adapter-level JSON errors without invoking the handler', async () => {
    const requests: unknown[] = [];
    const handler: TownHttpApiHandler = (request) => {
      requests.push(request);
      return Promise.resolve({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {},
      });
    };
    const server = await listen(createTownNodeHttpServer({ handler }));

    const unsupported = await fetch(`${server.baseUrl}/runtime/status`, { method: 'OPTIONS' });
    expect(unsupported.status).toBe(405);
    await expect(unsupported.json()).resolves.toEqual({
      error: { code: 'method_not_allowed', message: 'method not allowed' },
    });

    const invalidJson = await fetch(`${server.baseUrl}/runtime/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toEqual({
      error: { code: 'bad_request', message: 'request body must be valid JSON' },
    });
    expect(requests).toEqual([]);
  });

  test('serializes unexpected handler failures as 500 JSON responses', async () => {
    const server = await listen(
      createTownNodeHttpServer({
        handler: () => Promise.reject(new Error('database unavailable')),
      }),
    );

    const response = await fetch(`${server.baseUrl}/runtime/status`);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'internal_server_error', message: 'internal server error' },
    });
  });
});

async function listen(server: Server): Promise<{ readonly server: Server; readonly baseUrl: string }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected TCP server address');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}
