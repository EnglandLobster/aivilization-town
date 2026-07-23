import { afterEach, describe, expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Server, ServerResponse } from 'node:http';
import {
  createTownStaticBearerAuthenticator,
  createTownNodeHttpServer,
  type TownHttpApiHandler,
  type TownServerSentEventRoute,
} from './index';
import { writeTownNodeHttpResponseChunk } from './nodeHttpServer';

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
  test('cleans up backpressure listeners after drain, close, or error', async () => {
    const drained = createBackpressuredResponse();
    const drainPromise = writeTownNodeHttpResponseChunk(drained.response, 'event');
    expect(listenerCounts(drained.events)).toEqual({ drain: 1, error: 1, close: 1 });
    drained.events.emit('drain');
    await expect(drainPromise).resolves.toBeUndefined();
    expect(listenerCounts(drained.events)).toEqual({ drain: 0, error: 0, close: 0 });

    const closed = createBackpressuredResponse();
    const closePromise = writeTownNodeHttpResponseChunk(closed.response, 'event');
    closed.events.emit('close');
    await expect(closePromise).resolves.toBeUndefined();
    expect(listenerCounts(closed.events)).toEqual({ drain: 0, error: 0, close: 0 });

    const failed = createBackpressuredResponse();
    const errorPromise = writeTownNodeHttpResponseChunk(failed.response, 'event');
    failed.events.emit('error', new Error('socket failed'));
    await expect(errorPromise).rejects.toThrow('socket failed');
    expect(listenerCounts(failed.events)).toEqual({ drain: 0, error: 0, close: 0 });
  });

  test('injects authenticated principals and rejects invalid Bearer credentials', async () => {
    const requests: unknown[] = [];
    const token = 'participant-token-0000000000000000000001';
    const server = await listen(
      createTownNodeHttpServer({
        authenticator: createTownStaticBearerAuthenticator({
          credentials: [
            {
              keyId: 'participant-primary',
              subjectId: 'participant-7',
              token,
              roles: ['participant'],
            },
          ],
        }),
        handler: (request) => {
          requests.push(request);
          return Promise.resolve({ status: 200, headers: {}, body: request.principal });
        },
      }),
    );

    const authenticated = await fetch(`${server.baseUrl}/access/session`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(authenticated.status).toBe(200);
    await expect(authenticated.json()).resolves.toEqual({
      subjectId: 'participant-7',
      roles: ['participant'],
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/access/session',
        query: {},
        principal: { subjectId: 'participant-7', roles: ['participant'] },
      },
    ]);

    const rejected = await fetch(`${server.baseUrl}/access/session`, {
      headers: { authorization: 'Bearer invalid-token-000000000000000000000000' },
    });
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get('www-authenticate')).toContain('Bearer');
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: 'invalid_access_token' },
    });
    expect(requests).toHaveLength(1);
  });

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

  test('serves same-origin static assets for GET and HEAD before API routing', async () => {
    const requests: unknown[] = [];
    const server = await listen(
      createTownNodeHttpServer({
        handler: (request) => {
          requests.push(request);
          return Promise.resolve({
            status: 404,
            headers: { 'content-type': 'application/json' },
            body: { error: { code: 'not_found' } },
          });
        },
        staticAssets: [
          {
            path: '/ui/app.js',
            contentType: 'text/javascript; charset=utf-8',
            body: 'globalThis.town = true;',
            cacheControl: 'public, max-age=60',
          },
        ],
      }),
    );

    const getResponse = await fetch(`${server.baseUrl}/ui/app.js?version=1`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(getResponse.headers.get('cache-control')).toBe('public, max-age=60');
    expect(getResponse.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(getResponse.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(getResponse.text()).resolves.toBe('globalThis.town = true;');

    const headResponse = await fetch(`${server.baseUrl}/ui/app.js`, { method: 'HEAD' });
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get('content-length')).toBe('23');
    await expect(headResponse.text()).resolves.toBe('');

    const missingResponse = await fetch(`${server.baseUrl}/ui/missing.js`);
    expect(missingResponse.status).toBe(404);
    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/ui/missing.js',
        query: {},
      },
    ]);
  });

  test('streams matching server-sent event routes without invoking the JSON handler', async () => {
    const requests: unknown[] = [];
    const routeRequests: unknown[] = [];
    const route: TownServerSentEventRoute = {
      match: (request) =>
        request.method === 'GET' &&
        request.path === '/simulations/sim-1/partitions/world-main/sync-stream',
      createStream: async function* (request) {
        routeRequests.push(request);
        await Promise.resolve();
        yield {
          id: '1',
          event: 'sync',
          data: {
            streamVersion: 1,
            nextAfterSequence: 1,
          },
        };
      },
    };
    const server = await listen(
      createTownNodeHttpServer({
        handler: (request) => {
          requests.push(request);
          return Promise.resolve({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: {},
          });
        },
        serverSentEventRoutes: [route],
      }),
    );

    const response = await fetch(
      `${server.baseUrl}/simulations/sim-1/partitions/world-main/sync-stream?afterSequence=0`,
      { headers: { accept: 'text/event-stream' } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await expect(response.text()).resolves.toBe(
      ['id: 1', 'event: sync', 'data: {"streamVersion":1,"nextAfterSequence":1}', '', ''].join(
        '\n',
      ),
    );
    expect(requests).toEqual([]);
    expect(routeRequests).toEqual([
      {
        method: 'GET',
        path: '/simulations/sim-1/partitions/world-main/sync-stream',
        query: { afterSequence: '0' },
      },
    ]);
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

function createBackpressuredResponse(): {
  readonly events: EventEmitter;
  readonly response: ServerResponse;
} {
  const events = new EventEmitter();
  const response = Object.assign(events, { write: () => false }) as unknown as ServerResponse;
  return { events, response };
}

function listenerCounts(events: EventEmitter): { drain: number; error: number; close: number } {
  return {
    drain: events.listenerCount('drain'),
    error: events.listenerCount('error'),
    close: events.listenerCount('close'),
  };
}

async function listen(
  server: Server,
): Promise<{ readonly server: Server; readonly baseUrl: string }> {
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
