import {
  isPrincipalPremisesPermit,
  applyPremisesRightsEvent,
  type PremisesRightsEvent,
} from '@aivilization/premises';
import { effectiveController, controlVersion, sameController } from '@aivilization/authority';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
import { tradeSourceStartFailure } from '@aivilization/commerce';
import { premisesPermitConflict, premisesPermitReleaseBlocked } from '../premisesRightsPorts';
/** Verify consent evidence against the resource that existed before the atomic commit. */
export function applyPremisesRightsProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPremisesRightsCommitted') return undefined;
  const p = e.payload;
  if (
    !w.premises ||
    p.policyVersion !== 'resident-premises-rights-v1' ||
    e.occurredAt !== w.clock.now ||
    !p.events.length
  )
    throw Error('invalid-premises-rights-commit');
  for (const event of p.events)
    if (
      event.type === 'PremisesPermitAccepted' &&
      tradeSourceStartFailure(w.residentTrade, { kind: 'permit', id: event.id })
    )
      throw Error('permit-paid-acceptance-required');
  return applyPremisesRightsEffects(w, p.actorId, e.occurredAt, p.events);
}
/** Used only by the standalone rights envelope and the validated atomic paid-rights commit. */
export function applyPremisesRightsEffects(
  w: WorldProjection,
  actorId: string,
  at: number,
  events: readonly PremisesRightsEvent[],
): WorldProjection {
  if (!w.premises || at !== w.clock.now || !events.length)
    throw Error('invalid-premises-rights-effects');
  let state = w.premisesRights;
  for (const event of events) {
    if (event.type === 'PremisesRightsEnabled') {
      if (actorId !== 'system' || events.length !== 1)
        throw Error('invalid-premises-rights-enable');
    } else {
      if (event.signature.actorId !== actorId || event.signature.at !== at)
        throw Error('invalid-permit-commit-signature');
      const terms = event.type === 'PremisesPermitOffered' ? event.terms : state?.permits[event.id];
      if (
        terms &&
        isPrincipalPremisesPermit(terms) &&
        !(event.type === 'PremisesPermitClosed' && event.reason === 'expired')
      )
        throw Error('principal-permit-operation-required');
      if (!terms || terms.users.some((id) => !w.agents[id])) throw Error('permit-users-missing');
      if (event.type === 'PremisesPermitOffered' || event.type === 'PremisesPermitAccepted') {
        const b = w.premises.buildings[terms.buildingId];
        if (
          !b ||
          (event.type === 'PremisesPermitOffered' &&
            b.control.policyVersion === 'resource-principals-v2') ||
          b.status !== 'operational' ||
          b.condition <= 0 ||
          !sameController(effectiveController(b), terms.issuer) ||
          controlVersion(b) !== terms.issuerVersion
        )
          throw Error('permit-control-evidence-mismatch');
        if (event.type === 'PremisesPermitAccepted' && premisesPermitConflict(w, terms, at))
          throw Error('permit-existing-obligation-conflict');
      }
      if (
        event.type === 'PremisesPermitClosed' &&
        event.reason === 'released' &&
        premisesPermitReleaseBlocked(w, state!.permits[event.id]!)
      )
        throw Error('permit-active-work-must-end-first');
    }
    state = applyPremisesRightsEvent(state, event);
  }
  if (!state) throw Error('premises-rights-not-enabled');
  return { ...w, premisesRights: state };
}
