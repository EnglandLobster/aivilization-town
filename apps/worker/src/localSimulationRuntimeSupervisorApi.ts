import {
  createRuntimeSupervisorApiService,
  type RuntimeSupervisorApiService,
} from '@aivilization/api';
import type {
  LocalSimulationRuntimeOperationCommand,
  LocalSimulationRuntimeOperationTrace,
} from './localSimulationRuntimeOperationTrace';
import type { LocalSimulationRuntimeRunSessionState } from './localSimulationRuntimeRunSession';
import type {
  LocalSimulationRuntimeSupervisor,
  LocalSimulationRuntimeSupervisorPauseAllResult,
  LocalSimulationRuntimeSupervisorRunCyclesResult,
  LocalSimulationRuntimeSupervisorStartAllResult,
  LocalSimulationRuntimeSupervisorStatus,
} from './localSimulationRuntimeSupervisor';

export type LocalSimulationRuntimeSupervisorApiService = RuntimeSupervisorApiService<
  LocalSimulationRuntimeSupervisorStatus,
  LocalSimulationRuntimeSupervisorStartAllResult,
  LocalSimulationRuntimeSupervisorPauseAllResult,
  LocalSimulationRuntimeSupervisorRunCyclesResult,
  LocalSimulationRuntimeOperationTrace,
  LocalSimulationRuntimeOperationCommand,
  LocalSimulationRuntimeRunSessionState
>;

export function createLocalSimulationRuntimeSupervisorApiService(input: {
  readonly supervisor: LocalSimulationRuntimeSupervisor;
}): LocalSimulationRuntimeSupervisorApiService {
  return createRuntimeSupervisorApiService({
    control: input.supervisor,
  });
}
