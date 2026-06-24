import {
  createRuntimeRunQueueWorkerApiService,
  type RuntimeRunQueueWorkerApiService,
} from '@aivilization/api';
import type {
  LocalSimulationRuntimeRunQueueWorkerHost,
  LocalSimulationRuntimeRunQueueWorkerHostDrainResult,
  LocalSimulationRuntimeRunQueueWorkerHostStatus,
} from './localSimulationRuntimeRunQueueWorkerHost';

export type LocalSimulationRuntimeRunQueueWorkerApiService = RuntimeRunQueueWorkerApiService<
  LocalSimulationRuntimeRunQueueWorkerHostStatus,
  LocalSimulationRuntimeRunQueueWorkerHostDrainResult
>;

export function createLocalSimulationRuntimeRunQueueWorkerApiService(input: {
  readonly host: LocalSimulationRuntimeRunQueueWorkerHost;
}): LocalSimulationRuntimeRunQueueWorkerApiService {
  return createRuntimeRunQueueWorkerApiService({
    control: {
      getStatus: () => input.host.getStatus(),
      start: () => {
        input.host.start();
        return input.host.getStatus();
      },
      stop: () => {
        input.host.stop();
        return input.host.getStatus();
      },
      drain: (request) => input.host.drain(request),
    },
  });
}
