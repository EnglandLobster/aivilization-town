import { readAdminResources, AdminResourceQueryError } from './adminResources';
import { createServer as createHttpsServer } from 'node:https';
import { resolveResidentListener, type ResidentListenerOptions } from './residentListener';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ResidentPartitionExecution,
  type ResidentPartitionConfiguration,
} from './partitionExecution';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type RequestListener,
} from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readSocietyCommitPage, type OpenSocietyRuntime } from '@aivilization/worker';
import type { ResidentCredentials } from './credentials';
import { OBSERVER_HTML, OBSERVER_JS } from './observer';
import { residentReport } from './report';

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected-object');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected-string');
  return value;
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > 65_536) throw new Error('request-too-large');
    chunks.push(bytes);
  }
  return record(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function respond(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}
export async function startResidentServer(
  runtime: OpenSocietyRuntime,
  credentials: ResidentCredentials,
  port = 0,
  options: ResidentListenerOptions & {
    readonly ownsScheduling?: boolean;
    readonly partitions?: ResidentPartitionConfiguration;
  } = {},
) {
  const listener = resolveResidentListener(options);
  if (!options.partitions && existsSync(join(runtime.journal.rootDir, 'partition-bindings.json')))
    throw Error('partition-configuration-required');
  const partitions = options.partitions
    ? new ResidentPartitionExecution(runtime, options.partitions)
    : undefined;
  if (options.partitions) {
    const tokens = [
      credentials.admin,
      ...Object.values(credentials.residents),
      ...options.partitions.partitions.map((p) => p.token),
    ];
    if (new Set(tokens).size !== tokens.length) throw Error('partition-credential-collision');
  }
  const handler: RequestListener = (request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/observer.js')) {
        response.writeHead(200, {
          'content-type':
            url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
          'content-security-policy':
            "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end(url.pathname === '/' ? OBSERVER_HTML : OBSERVER_JS);
        return;
      }
      const bearer = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const admin = equal(bearer, credentials.admin);
      const partition = partitions?.partition(bearer);
      const actor = partitions
        ? partitions.actor(bearer)
        : Object.entries(credentials.residents).find(([, token]) => equal(bearer, token))?.[0];
      if (!admin && actor === undefined && partition === undefined) {
        respond(response, 401, { error: 'unauthorized' });
        return;
      }
      if (url.pathname.startsWith('/partition/')) {
        if (!partitions || !partition) {
          respond(response, 403, { error: 'partition-required' });
          return;
        }
        if (request.method === 'GET' && url.pathname === '/partition/identity') {
          respond(response, 200, partitions.identity(partition));
          return;
        }
        if (request.method === 'POST' && url.pathname === '/partition/claim') {
          const value = await body(request);
          if (Object.keys(value).some((k) => !['claimId', 'authorityId'].includes(k)))
            throw Error('unknown-request-field');
          respond(
            response,
            200,
            partitions.claim(
              partition,
              string(value.claimId),
              value.authorityId === undefined ? undefined : string(value.authorityId),
            ),
          );
          return;
        }
        if (request.method === 'POST' && url.pathname === '/partition/finish') {
          const value = await body(request);
          if (
            Object.keys(value).some(
              (k) => !['token', 'summary', 'status', 'sessionId'].includes(k),
            ) ||
            !['completed', 'provider-error'].includes(string(value.status))
          )
            throw Error('invalid-partition-finish');
          respond(
            response,
            200,
            partitions.finish(partition, string(value.token), {
              summary: string(value.summary),
              status: value.status as 'completed' | 'provider-error',
              ...(value.sessionId === undefined ? {} : { sessionId: string(value.sessionId) }),
            }),
          );
          return;
        }
      }
      if (url.pathname.startsWith('/admin/')) {
        if (!admin) {
          respond(response, 403, { error: 'admin-required' });
          return;
        }
        // Complete private facts are infrastructure data, never a resident capability.
        if (request.method === 'GET' && url.pathname === '/admin/replication/manifest') {
          respond(response, 200, runtime.manifest);
          return;
        }
        if (request.method === 'GET' && url.pathname === '/admin/replication/commits') {
          const sequence = url.searchParams.get('sequence');
          const hash = url.searchParams.get('hash');
          const limit = url.searchParams.get('limit') ?? '32';
          if (sequence === null || !/^\d+$/.test(sequence) || hash === null || !/^\d+$/.test(limit))
            throw Error('invalid-delivery-query');
          respond(
            response,
            200,
            readSocietyCommitPage(
              runtime.journal,
              { sequence: Number(sequence), hash },
              Number(limit),
            ),
          );
          return;
        }
        if (request.method === 'GET' && url.pathname === '/admin/resources') {
          try {
            respond(response, 200, readAdminResources(runtime, url.searchParams));
          } catch (error) {
            if (!(error instanceof AdminResourceQueryError)) throw error;
            respond(response, error.status, { error: error.message });
          }
          return;
        }
        if (request.method === 'GET' && url.pathname === '/admin/report') {
          respond(response, 200, residentReport(runtime));
          return;
        }
        if (request.method === 'POST') {
          if (
            (options.ownsScheduling || partitions) &&
            ['/admin/start', '/admin/finish', '/admin/advance'].includes(url.pathname)
          ) {
            respond(response, 409, { error: 'daemon-owns-scheduling' });
            return;
          }
          const value = await body(request);
          if (url.pathname === '/admin/start') {
            respond(response, 200, runtime.beginTurn(string(value.actorId)));
            return;
          }
          if (url.pathname === '/admin/finish') {
            respond(
              response,
              200,
              runtime.finishTurn(string(value.actorId), { summary: string(value.summary) }),
            );
            return;
          }
          if (url.pathname === '/admin/advance') {
            if (typeof value.deltaMs !== 'number') throw new Error('expected-number');
            respond(response, 200, runtime.advanceTime(value.deltaMs, string(value.requestId)));
            return;
          }
        }
      } else if (actor !== undefined) {
        if (request.method === 'GET' && url.pathname === '/context') {
          respond(response, 200, runtime.context(actor));
          return;
        }
        if (request.method === 'GET' && url.pathname === '/capabilities') {
          respond(response, 200, runtime.discover(url.searchParams.get('query') ?? ''));
          return;
        }
        if (request.method === 'POST' && url.pathname === '/invoke') {
          const value = await body(request);
          if (partitions && partitions.actor(bearer) !== actor)
            throw Error('expired-partition-grant');
          if (Object.keys(value).some((key) => !['name', 'arguments', 'requestId'].includes(key)))
            throw new Error('unknown-request-field');
          respond(
            response,
            200,
            runtime.invoke(actor, {
              name: string(value.name),
              arguments: record(value.arguments),
              requestId: string(value.requestId),
            }),
          );
          return;
        }
      }
      respond(response, 404, { error: 'not-found' });
    })().catch((error: unknown) =>
      respond(response, 400, { error: error instanceof Error ? error.message : 'request-failed' }),
    );
  };
  const server = options.tls ? createHttpsServer(options.tls, handler) : createServer(handler);
  server.requestTimeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, listener.host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('invalid-listen-address');
  return {
    url: `${listener.protocol}://${listener.advertised}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
