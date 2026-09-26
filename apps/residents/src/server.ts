import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { OpenSocietyRuntime } from '@aivilization/worker';
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
) {
  const server = createServer((request, response) => {
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
      const actor = Object.entries(credentials.residents).find(([, token]) =>
        equal(bearer, token),
      )?.[0];
      if (!admin && actor === undefined) {
        respond(response, 401, { error: 'unauthorized' });
        return;
      }
      if (url.pathname.startsWith('/admin/')) {
        if (!admin) {
          respond(response, 403, { error: 'admin-required' });
          return;
        }
        if (request.method === 'GET' && url.pathname === '/admin/report') {
          respond(response, 200, residentReport(runtime));
          return;
        }
        if (request.method === 'POST') {
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
  });
  server.requestTimeout = 15_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('invalid-listen-address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
