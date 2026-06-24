import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { TownHttpApiHandler, TownHttpApiRequest, TownHttpMethod } from './httpApi';
import { formatServerSentEvent, type TownServerSentEventRoute } from './serverSentEvents';

export type TownNodeHttpServerInput = {
  readonly handler: TownHttpApiHandler;
  readonly serverSentEventRoutes?: readonly TownServerSentEventRoute[];
};

type AdapterError = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
};

class TownNodeHttpAdapterError extends Error implements AdapterError {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const jsonHeaders = { 'content-type': 'application/json' };

export function createTownNodeHttpServer(input: TownNodeHttpServerInput): Server {
  return createServer(createTownNodeHttpRequestListener(input));
}

export function createTownNodeHttpRequestListener(input: TownNodeHttpServerInput): RequestListener {
  return (request, response) => {
    void handleNodeRequest(input, request, response);
  };
}

async function handleNodeRequest(
  input: TownNodeHttpServerInput,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const townRequest = await createTownRequest(request);
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
    writeJsonResponse(response, adapterError.status, jsonHeaders, {
      error: {
        code: adapterError.code,
        message: adapterError.message,
      },
    });
  }
}

async function createTownRequest(request: IncomingMessage): Promise<TownHttpApiRequest> {
  const method = normalizeMethod(request.method);
  if (method === undefined) {
    throw createAdapterError(405, 'method_not_allowed', 'method not allowed');
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const body = await readJsonBody(request);
  return {
    method,
    path: url.pathname,
    query: normalizeQuery(url.searchParams),
    ...(body === undefined ? {} : { body }),
  };
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
      await writeResponseChunk(response, formatServerSentEvent(event));
    }
  } finally {
    response.end();
  }

  return true;
}

function writeResponseChunk(response: ServerResponse, chunk: string): Promise<void> {
  if (response.write(chunk)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    response.once('drain', resolve);
    response.once('error', reject);
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
): TownNodeHttpAdapterError {
  return new TownNodeHttpAdapterError(status, code, message);
}
