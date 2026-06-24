import {
  createRuntimeSchedulerApiService,
  type RuntimeSchedulerApiService,
} from '@aivilization/api';
import type {
  LocalSimulationRuntimeSchedulerDecision,
  LocalSimulationRuntimeSchedulerHost,
  LocalSimulationRuntimeSchedulerHostStatus,
} from './localSimulationRuntimeScheduler';

export type LocalSimulationRuntimeSchedulerApiService = RuntimeSchedulerApiService<
  LocalSimulationRuntimeSchedulerHostStatus,
  LocalSimulationRuntimeSchedulerDecision
>;

export function createLocalSimulationRuntimeSchedulerApiService(input: {
  readonly host: LocalSimulationRuntimeSchedulerHost;
}): LocalSimulationRuntimeSchedulerApiService {
  return createRuntimeSchedulerApiService({
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
      runOnce: () => input.host.runOnce(),
    },
  });
}
