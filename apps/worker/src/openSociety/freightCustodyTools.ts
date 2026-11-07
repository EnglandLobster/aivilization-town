import { parseFreightCustodyCommand } from './freightCustodyCommands';
import { freightCustodyCollectiveAuthority } from './freightCustodyCollectiveAuthority';
import type { FreightCustodyAuthorization } from '@aivilization/world';
import {
  FREIGHT_CUSTODY_HANDOFF_POLICY,
  freightCustodian,
  type FreightCustodyHandoff,
} from '@aivilization/logistics';
import { residentFreightCustodyEvent } from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { stringArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';

export const freightCustodyRules = (s: OpenSocietyState) => ({
  enabled: !!s.world.logistics?.custody,
  policy: FREIGHT_CUSTODY_HANDOFF_POLICY,
  source: 'explicit-initial-contract-protocol',
  scope: s.world.logistics?.custody?.collectiveGrantsVersion
    ? 'personal-and-collective-stationary-handoff'
    : 'personal-stationary-handoff',
  collectiveAuthorization: s.world.logistics?.custody?.collectiveGrantsVersion ?? 'not-enabled',
  readWith: 'town freight handoffs --id FREIGHT_ID',
  actWith: 'town freight handoff --action propose|consent|accept|withdraw',
});
export function invitedCustodian(s: OpenSocietyState, freightId: string, actorId: string) {
  const freight = s.world.logistics?.freight[freightId];
  return Object.values(s.world.logistics?.custody?.proposals ?? {}).some(
    (p) =>
      p.freightId === freightId &&
      p.nextCarrierId === actorId &&
      p.status === 'proposed' &&
      p.expiresAt > s.world.clock.now &&
      p.freightRevision === freight?.revision &&
      !!freight &&
      p.previousCarrierId === freightCustodian(s.world.logistics?.custody, freight).carrierId,
  );
}
function participant(p: FreightCustodyHandoff, actorId: string) {
  return (
    p.nextCarrierId === actorId ||
    p.previousCarrierId === actorId ||
    p.createdBy === actorId ||
    Object.values(p.consents).some((c) => c.actorId === actorId)
  );
}
export function executeFreightCustodyTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
  originalParty: boolean,
  collectiveAuthorization?: FreightCustodyAuthorization,
): ToolExecution {
  const state = s.world.logistics?.custody;
  if (!state) throw new ToolRefusal('freight-custody-not-enabled');
  const freightId = stringArg(args, 'id');
  if (name === 'freight.handoffs') {
    const proposals = Object.values(state.proposals).filter(
      (p) => p.freightId === freightId && (originalParty || participant(p, actorId)),
    );
    if (!originalParty && !proposals.length) throw new ToolRefusal('freight-not-found');
    return {
      data: pageItems(
        proposals.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)),
        args,
      ),
      effects: {},
    };
  }
  const d = residentFreightCustodyEvent({
    projection: s.world,
    actorId,
    freightId,
    command: parseFreightCustodyCommand(args),
    collective: freightCustodyCollectiveAuthority(s),
    ...(collectiveAuthorization ? { collectiveAuthorization } : {}),
    requestId: `freight-handoff-${digest([actorId, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: {
      committed: true,
      id: freightId,
      handoffId: stringArg(args, 'handoffId'),
      readWith: `town freight handoffs --id ${freightId}`,
    },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events, actorId) },
  };
}
