import type { SimulationSyncRequest, SimulationSyncPort } from './simulationApi';
import {
  delayUntilAbortable,
  type TownServerSentEvent,
  type TownServerSentEventRoute,
} from './serverSentEvents';
import type { TownHttpApiRequest } from './httpApi';

export type SimulationSyncSseEnvelope = {
  readonly streamVersion: number;
  readonly projectionSequence: number;
  readonly nextAfterSequence: number;
  readonly hasMoreEvents: boolean;
};

export type SimulationSyncSseRouteInput<TSync extends SimulationSyncSseEnvelope> = {
  readonly sync: SimulationSyncPort<TSync>;
  readonly pollIntervalMs?: number;
};

type ParsedSyncStreamRoute = {
  readonly simulationId: string;
  readonly partitionKey: string;
};

export function createSimulationSyncSseRoute<TSync extends SimulationSyncSseEnvelope>(
  input: SimulationSyncSseRouteInput<TSync>,
): TownServerSentEventRoute {
  return {
    match: (request) => request.method === 'GET' && parseSyncStreamPath(request.path) !== undefined,
    createStream: async function* (request, context) {
      yield* createSimulationSyncSseStream({
        sync: input.sync,
        request: createSyncRequest(request),
        pollIntervalMs: input.pollIntervalMs ?? 1000,
        signal: context.signal,
      });
    },
  };
}

async function* createSimulationSyncSseStream<TSync extends SimulationSyncSseEnvelope>(input: {
  readonly sync: SimulationSyncPort<TSync>;
  readonly request: SimulationSyncRequest;
  readonly pollIntervalMs: number;
  readonly signal: AbortSignal;
}): AsyncIterable<TownServerSentEvent> {
  let afterSequence = input.request.afterSequence;
  let isFirst = true;

  while (!input.signal.aborted) {
    const sync = await input.sync.getSync({
      ...input.request,
      ...(afterSequence === undefined ? {} : { afterSequence }),
    });
    const shouldEmit = isFirst || sync.nextAfterSequence !== afterSequence;
    if (shouldEmit) {
      yield {
        id: String(sync.nextAfterSequence),
        event: isFirst ? 'sync' : 'sync-batch',
        data: sync,
      };
      afterSequence = sync.nextAfterSequence;
      isFirst = false;
    }
    if (input.signal.aborted) {
      break;
    }
    await delayUntilAbortable({ ms: input.pollIntervalMs, signal: input.signal });
  }
}

function createSyncRequest(request: TownHttpApiRequest): SimulationSyncRequest {
  const route = parseSyncStreamPath(request.path);
  if (route === undefined) {
    throw new Error('sync-stream route not found');
  }
  return {
    simulationId: route.simulationId,
    partitionKey: route.partitionKey,
    ...optionalQueryInteger(request.query, 'afterSequence', {
      min: 0,
      description: 'a non-negative integer',
    }),
    ...optionalQueryInteger(request.query, 'limit', {
      min: 1,
      description: 'a positive integer',
    }),
  };
}

function parseSyncStreamPath(path: string): ParsedSyncStreamRoute | undefined {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (
    segments.length !== 5 ||
    segments[0] !== 'simulations' ||
    segments[2] !== 'partitions' ||
    segments[4] !== 'sync-stream'
  ) {
    return undefined;
  }
  const simulationId = segments[1];
  const partitionKey = segments[3];
  if (simulationId === undefined || partitionKey === undefined) {
    return undefined;
  }
  return {
    simulationId: decodeURIComponent(simulationId),
    partitionKey: decodeURIComponent(partitionKey),
  };
}

function optionalQueryInteger(
  query: TownHttpApiRequest['query'],
  field: string,
  rule: { readonly min: number; readonly description: string },
): Record<string, number> {
  const value = getSingleQueryValue(query, field);
  if (value === undefined) {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < rule.min) {
    throw new Error(`${field} must be ${rule.description}`);
  }
  return { [field]: parsed };
}

function getSingleQueryValue(
  query: TownHttpApiRequest['query'],
  field: string,
): string | undefined {
  const value = query?.[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  return value[0];
}
