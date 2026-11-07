import {
  RESOURCE_CONTROL_POLICY,
  assertResourceControlPolicy,
  type ResourceControlPolicy,
  type ResourceControl,
  type ControlCommand,
} from '@aivilization/authority';

export const SERVICE_CONTROL_POLICY = {
  version: 'resident-service-control-v1',
  control: RESOURCE_CONTROL_POLICY,
} as const;
export type ServiceControlPolicy = {
  readonly version: typeof SERVICE_CONTROL_POLICY.version;
  readonly control: ResourceControlPolicy;
};
export type ServiceControlEvent =
  | { readonly type: 'ServiceControlEnabled'; readonly policy: ServiceControlPolicy }
  | {
      readonly type: 'ServiceControlChanged';
      readonly serviceId: string;
      readonly expectedRevision: number;
      readonly operation: ControlCommand['type'];
      readonly control: ResourceControl;
    };
export function assertServiceControlPolicy(policy: ServiceControlPolicy) {
  if (policy.version !== SERVICE_CONTROL_POLICY.version)
    throw Error('unsupported-service-control-policy');
  assertResourceControlPolicy(policy.control);
}
