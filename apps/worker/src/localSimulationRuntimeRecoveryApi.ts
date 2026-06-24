import { createRuntimeRecoveryApiService, type RuntimeRecoveryApiService } from '@aivilization/api';
import type {
  LocalSimulationRuntimeRecoveryHost,
  LocalSimulationRuntimeRecoveryHostStatus,
  LocalSimulationRuntimeRecoveryReport,
} from './localSimulationRuntimeRecovery';

export type LocalSimulationRuntimeRecoveryApiService = RuntimeRecoveryApiService<
  LocalSimulationRuntimeRecoveryHostStatus,
  LocalSimulationRuntimeRecoveryReport
>;

export function createLocalSimulationRuntimeRecoveryApiService(input: {
  readonly host: LocalSimulationRuntimeRecoveryHost;
}): LocalSimulationRuntimeRecoveryApiService {
  return createRuntimeRecoveryApiService({
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
