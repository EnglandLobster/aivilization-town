export const DISTRIBUTION_POLICY_VERSION = 'information-distribution-v1';
export type DistributionPolicy = {
  readonly version: typeof DISTRIBUTION_POLICY_VERSION;
  readonly maxSubscriptions: number;
  readonly maxCommentLength: number;
  readonly contextItems: number;
};
export const DEFAULT_DISTRIBUTION_POLICY: DistributionPolicy = {
  version: DISTRIBUTION_POLICY_VERSION,
  maxSubscriptions: 100,
  maxCommentLength: 2000,
  contextItems: 6,
};
export function assertDistributionPolicy(policy: DistributionPolicy): void {
  if (
    policy.version !== DISTRIBUTION_POLICY_VERSION ||
    [policy.maxSubscriptions, policy.maxCommentLength, policy.contextItems].some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    ) ||
    policy.contextItems > 30 ||
    policy.maxCommentLength > 8000
  )
    throw new Error('invalid-distribution-policy');
}
export type SubscriptionKind = 'author' | 'space';
export type InformationSubscription = {
  readonly ownerId: string;
  readonly kind: SubscriptionKind;
  readonly targetId: string;
  readonly active: boolean;
  readonly revision: number;
  readonly sinceSequence: number;
  readonly updatedAt: number;
};
export type InformationPublication = {
  readonly id: string;
  readonly sequence: number;
  readonly publisherId: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly kind: 'published' | 'revised' | 'shared';
  readonly at: number;
  readonly comment?: string;
};
export type DistributionState = {
  readonly policy: DistributionPolicy;
  readonly sequence: number;
  readonly subscriptions: Readonly<
    Record<string, Readonly<Record<string, InformationSubscription>>>
  >;
  readonly publications: Readonly<Record<string, InformationPublication>>;
  readonly readByOwner: Readonly<Record<string, Readonly<Record<string, number>>>>;
};
export function emptyDistributionState(policy: DistributionPolicy): DistributionState {
  assertDistributionPolicy(policy);
  return { policy, sequence: 0, subscriptions: {}, publications: {}, readByOwner: {} };
}
export type DistributionEvent =
  | { readonly type: 'DistributionEnabled'; readonly policy: DistributionPolicy }
  | { readonly type: 'SubscriptionChanged'; readonly subscription: InformationSubscription }
  | { readonly type: 'PublicationRecorded'; readonly publication: InformationPublication }
  | {
      readonly type: 'PublicationRead';
      readonly ownerId: string;
      readonly activityId: string;
      readonly at: number;
    };
export type DistributionDecision =
  | { readonly accepted: true; readonly events: readonly DistributionEvent[] }
  | { readonly accepted: false; readonly reason: string };
export type DistributionCommand =
  | {
      readonly type: 'subscription.follow' | 'subscription.unfollow';
      readonly kind: SubscriptionKind;
      readonly targetId: string;
    }
  | {
      readonly type: 'publication.share';
      readonly documentId: string;
      readonly revision: number;
      readonly comment?: string;
    }
  | { readonly type: 'notification.read'; readonly activityId: string };
export const subscriptionKey = (kind: SubscriptionKind, targetId: string) => `${kind}:${targetId}`;
