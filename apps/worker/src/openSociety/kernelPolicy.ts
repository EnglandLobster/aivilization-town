import { COORDINATION_POLICY, type CoordinationPolicy } from '@aivilization/collaboration';
import { SHARED_RECORDS_POLICY, type SharedRecordsPolicy } from '@aivilization/information';

export type SocietyKernelPolicy = {
  readonly version: 'agent-driven-society-v1';
  readonly records: SharedRecordsPolicy;
  readonly coordination: CoordinationPolicy;
};
export const SOCIETY_KERNEL_POLICY: SocietyKernelPolicy = {
  version: 'agent-driven-society-v1',
  records: SHARED_RECORDS_POLICY,
  coordination: COORDINATION_POLICY,
};
