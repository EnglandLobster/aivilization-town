import type {
  CustodyConsentRole,
  FreightCustodyCommand,
  FreightCustodyHandoff,
} from '@aivilization/logistics';
/** Owning collective journal validates fresh consumption and previously consumed exact consent separately. */
export type FreightCustodyCollectivePort = {
  authorize(input: {
    collectiveId: string;
    actorId: string;
    freightId: string;
    command: FreightCustodyCommand;
    decisionId?: string;
  }): { decisionId: string } | undefined;
  consentValid(proposal: FreightCustodyHandoff, role: CustodyConsentRole): boolean;
};
export type FreightCustodyAuthorization = {
  readonly collectiveId: string;
  readonly decisionId: string;
};
export function freightCustodyRecordedCommand(
  old: FreightCustodyHandoff | undefined,
  v: FreightCustodyHandoff,
): FreightCustodyCommand {
  if (!old)
    return {
      type: 'propose',
      id: v.id,
      nextCarrierId: v.nextCarrierId,
      expiresAt: v.expiresAt,
      ...(v.vehicleId ? { vehicleId: v.vehicleId } : {}),
    };
  if (v.status === 'accepted' || v.status === 'withdrawn')
    return {
      type: v.status === 'accepted' ? 'accept' : 'withdraw',
      id: v.id,
      expectedRevision: old.revision,
    };
  const roles = (Object.keys(v.consents) as CustodyConsentRole[]).filter((r) => !old.consents[r]);
  if (roles.length !== 1) throw Error('custody-one-consent-required');
  return { type: 'consent', id: v.id, role: roles[0]!, expectedRevision: old.revision };
}
