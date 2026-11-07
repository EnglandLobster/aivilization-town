/** Availability of a permission is distinct from attendance, labor and satisfaction. */
export const PREMISES_PROVISION_POLICY = {
  version: 'premises-provision-v1',
  basis: 'operational-permission-time',
} as const;
export type PremisesProvisionPolicy = typeof PREMISES_PROVISION_POLICY;
export type PremisesProvision = {
  readonly permitId: string;
  readonly orderId: string;
  readonly policyVersion: 'premises-provision-v1';
  readonly startedAt: number;
  readonly settledAt: number;
  readonly availableMs: number;
  readonly unavailableMs: number;
  readonly revision: number;
};
export type PremisesAvailabilityEvidence = {
  readonly buildingId: string;
  readonly buildingRevision: number;
  readonly buildingAt: number;
  readonly condition: number;
  readonly status: 'operational' | 'closed' | 'demolished';
};
export type PremisesProvisionEvent =
  | {
      readonly type: 'PremisesProvisionStarted';
      readonly provision: PremisesProvision;
      readonly actorId: string;
      readonly at: number;
      readonly policy: PremisesProvisionPolicy;
    }
  | {
      readonly type: 'PremisesProvisionSettled';
      readonly permitId: string;
      readonly revision: number;
      readonly at: number;
      readonly from: number;
      readonly until: number;
      readonly availableMs: number;
      readonly unavailableMs: number;
      readonly evidence: PremisesAvailabilityEvidence;
    };
export type PremisesProvisionDecision =
  | { readonly accepted: true; readonly events: readonly PremisesProvisionEvent[] }
  | { readonly accepted: false; readonly reason: string };
