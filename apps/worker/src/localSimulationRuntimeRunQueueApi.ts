import { createRuntimeRunQueueApiService, type RuntimeRunQueueApiService } from '@aivilization/api';
import type {
  LocalSimulationRuntimeRunQueueJob,
  LocalSimulationRuntimeRunQueueRepository,
} from './localSimulationRuntimeRunQueue';

export type LocalSimulationRuntimeRunQueueApiService =
  RuntimeRunQueueApiService<LocalSimulationRuntimeRunQueueJob>;

export function createLocalSimulationRuntimeRunQueueApiService(input: {
  readonly repository: Pick<
    LocalSimulationRuntimeRunQueueRepository,
    'enqueue' | 'get' | 'query' | 'replayDeadLetter'
  >;
  readonly manifestId: string;
}): LocalSimulationRuntimeRunQueueApiService {
  assertNonEmpty(input.manifestId, 'manifestId');
  return createRuntimeRunQueueApiService({
    control: {
      enqueueRun: (request) =>
        input.repository.enqueue({
          jobId: request.jobId,
          manifestId: input.manifestId,
          enqueuedAt: request.enqueuedAt,
          runRequest: {
            ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
            requestedAt: request.requestedAt,
            cycleCount: request.cycleCount,
            ...(request.cycleIntervalMs === undefined
              ? {}
              : { cycleIntervalMs: request.cycleIntervalMs }),
            ...(request.stopOnAttention === undefined
              ? {}
              : { stopOnAttention: request.stopOnAttention }),
          },
        }),
      getRunJob: (jobId) => input.repository.get(jobId),
      queryRunJobs: (request) => input.repository.query(request),
      replayRunJob: (request) => input.repository.replayDeadLetter(request),
    },
  });
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
