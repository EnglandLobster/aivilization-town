import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { TownHttpApiHandler, TownHttpApiRequest, TownHttpMethod } from './httpApi';
import type {
  TownNodeHttpAuthenticator,
  TownNodeHttpAuthenticationResult,
} from './httpAuthentication';
import { formatServerSentEvent, type TownServerSentEventRoute } from './serverSentEvents';

export type TownNodeHttpServerInput = {
  readonly handler: TownHttpApiHandler;
  readonly authenticator?: TownNodeHttpAuthenticator;
  readonly serverSentEventRoutes?: readonly TownServerSentEventRoute[];
  readonly staticAssets?: readonly TownStaticAsset[];
};

export type TownStaticAsset = {
  readonly path: string;
  readonly contentType: string;
  readonly body: string | Uint8Array;
  readonly cacheControl?: string;
};

type AdapterError = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly headers: Readonly<Record<string, string>> | undefined;
};

class TownNodeHttpAdapterError extends Error implements AdapterError {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Readonly<Record<string, string>> | undefined = undefined,
  ) {
    super(message);
  }
}

const jsonHeaders = { 'content-type': 'application/json' };

export function createTownNodeHttpServer(input: TownNodeHttpServerInput): Server {
  return createServer(createTownNodeHttpRequestListener(input));
}

export function createTownNodeHttpRequestListener(input: TownNodeHttpServerInput): RequestListener {
  const staticAssets = indexStaticAssets(input.staticAssets ?? []);
  return (request, response) => {
    void handleNodeRequest(input, staticAssets, request, response);
  };
}

async function handleNodeRequest(
  input: TownNodeHttpServerInput,
  staticAssets: ReadonlyMap<string, TownStaticAsset>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (tryWriteStaticAssetResponse(staticAssets, request, response)) {
      return;
    }
    const townRequest = await createTownRequest(request, input.authenticator);
    if (isServerSentEventRequest(request)) {
      const handled = await tryWriteServerSentEventResponse(input, townRequest, request, response);
      if (handled) {
        return;
      }
    }
    const townResponse = await input.handler(townRequest);
    writeJsonResponse(response, townResponse.status, townResponse.headers, townResponse.body);
  } catch (error) {
    const adapterError = toAdapterError(error);
    writeJsonResponse(
      response,
      adapterError.status,
      { ...jsonHeaders, ...adapterError.headers },
      {
        error: {
          code: adapterError.code,
          message: adapterError.message,
        },
      },
    );
  }
}

function indexStaticAssets(
  assets: readonly TownStaticAsset[],
): ReadonlyMap<string, TownStaticAsset> {
  const assetsByPath = new Map<string, TownStaticAsset>();
  for (const asset of assets) {
    if (!asset.path.startsWith('/') || asset.path.includes('?') || asset.path.includes('#')) {
      throw new Error(`static asset path must be an absolute URL path: ${asset.path}`);
    }
    if (assetsByPath.has(asset.path)) {
      throw new Error(`duplicate static asset path: ${asset.path}`);
    }
    assetsByPath.set(asset.path, asset);
  }
  return assetsByPath;
}

function tryWriteStaticAssetResponse(
  assets: ReadonlyMap<string, TownStaticAsset>,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const asset = assets.get(url.pathname);
  if (asset === undefined) {
    return false;
  }

  const body = typeof asset.body === 'string' ? Buffer.from(asset.body, 'utf8') : asset.body;
  response.statusCode = 200;
  response.setHeader('content-type', asset.contentType);
  response.setHeader('content-length', body.byteLength);
  response.setHeader('cache-control', asset.cacheControl ?? 'no-cache');
  response.setHeader('content-security-policy', createStaticAssetContentSecurityPolicy());
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-frame-options', 'DENY');
  response.end(request.method === 'HEAD' ? undefined : body);
  return true;
}

function createStaticAssetContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "connect-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

async function createTownRequest(
  request: IncomingMessage,
  authenticator: TownNodeHttpAuthenticator | undefined,
): Promise<TownHttpApiRequest> {
  const method = normalizeMethod(request.method);
  if (method === undefined) {
    throw createAdapterError(405, 'method_not_allowed', 'method not allowed');
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const authentication =
    authenticator === undefined
      ? ({ status: 'anonymous' } as const)
      : await authenticator.authenticate({
          method,
          path: url.pathname,
          headers: normalizeHeaders(request),
        });
  assertAuthenticationAccepted(authentication);
  const body = await readJsonBody(request);
  return {
    method,
    path: url.pathname,
    query: normalizeQuery(url.searchParams),
    ...(body === undefined ? {} : { body }),
    ...(authentication.status === 'authenticated' ? { principal: authentication.principal } : {}),
  };
}

function normalizeHeaders(
  request: IncomingMessage,
): Readonly<Record<string, string | readonly string[] | undefined>> {
  const headers: Record<string, string | readonly string[] | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name.toLowerCase()] = value;
  }
  return headers;
}

function assertAuthenticationAccepted(result: TownNodeHttpAuthenticationResult): void {
  if (result.status !== 'rejected') {
    return;
  }
  throw createAdapterError(401, result.code, result.message, {
    'www-authenticate': 'Bearer realm="aivilization-town"',
  });
}

function normalizeMethod(method: string | undefined): TownHttpMethod | undefined {
  if (
    method === 'GET' ||
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE'
  ) {
    return method;
  }
  return undefined;
}

function normalizeQuery(
  searchParams: URLSearchParams,
): Readonly<Record<string, string | readonly string[] | undefined>> {
  const query: Record<string, string | readonly string[]> = {};
  for (const key of searchParams.keys()) {
    const values = searchParams.getAll(key);
    if (values.length === 1) {
      const first = values[0];
      if (first !== undefined) {
        query[key] = first;
      }
    } else if (values.length > 1) {
      query[key] = values;
    }
  }
  return query;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const raw = await readRequestBody(request);
  if (raw.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw createAdapterError(400, 'bad_request', 'request body must be valid JSON');
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      resolve(body);
    });
    request.on('error', reject);
  });
}

function writeJsonResponse(
  response: ServerResponse,
  status: number,
  headers: Readonly<Record<string, string>>,
  body: unknown,
): void {
  response.statusCode = status;
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  if (response.getHeader('content-type') === undefined) {
    response.setHeader('content-type', 'application/json');
  }
  response.end(JSON.stringify(body));
}

function isServerSentEventRequest(request: IncomingMessage): boolean {
  const accept = request.headers.accept;
  if (accept === undefined) {
    return false;
  }
  return accept.split(',').some((value) => value.trim().startsWith('text/event-stream'));
}

async function tryWriteServerSentEventResponse(
  input: TownNodeHttpServerInput,
  townRequest: TownHttpApiRequest,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  const route = input.serverSentEventRoutes?.find((candidate) => candidate.match(townRequest));
  if (route === undefined) {
    return false;
  }

  const abort = new AbortController();
  const abortStream = () => abort.abort();
  request.on('close', abortStream);
  response.on('close', abortStream);
  response.statusCode = 200;
  response.setHeader('content-type', 'text/event-stream; charset=utf-8');
  response.setHeader('cache-control', 'no-cache, no-transform');
  response.setHeader('connection', 'keep-alive');
  response.flushHeaders();

  try {
    for await (const event of route.createStream(townRequest, { signal: abort.signal })) {
      if (abort.signal.aborted) {
        break;
      }
      await writeTownNodeHttpResponseChunk(response, formatServerSentEvent(event));
    }
  } finally {
    response.end();
  }

  return true;
}

export function writeTownNodeHttpResponseChunk(
  response: ServerResponse,
  chunk: string,
): Promise<void> {
  if (response.write(chunk)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.off('drain', handleDrain);
      response.off('error', handleError);
      response.off('close', handleClose);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleClose = () => {
      cleanup();
      resolve();
    };
    response.once('drain', handleDrain);
    response.once('error', handleError);
    response.once('close', handleClose);
  });
}

function toAdapterError(error: unknown): AdapterError {
  if (error instanceof TownNodeHttpAdapterError) {
    return error;
  }
  return createAdapterError(500, 'internal_server_error', 'internal server error');
}

function createAdapterError(
  status: number,
  code: string,
  message: string,
  headers?: Readonly<Record<string, string>>,
): TownNodeHttpAdapterError {
  return new TownNodeHttpAdapterError(status, code, message, headers);
}
