import {
  assertResourceControlPolicy,
  controlVersion,
  effectiveController,
  sameController,
  validController,
  validControllerId,
  type ControlledResource,
  type ResourceControl,
  type ResourceControlPolicy,
  type ControlCommand,
} from './control';

/** Compare the recorded control schema, independent of JSON object key order. */
export function sameResourceControl(
  a: ResourceControl | undefined,
  b: ResourceControl | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (
    a.policyVersion !== b.policyVersion ||
    a.version !== b.version ||
    a.at !== b.at ||
    a.changedBy !== b.changedBy ||
    a.decisionId !== b.decisionId ||
    !sameController(a.controller, b.controller)
  )
    return false;
  const x = a.offer,
    y = b.offer;
  if (x === undefined || y === undefined) return x === y;
  return (
    sameController(x.target, y.target) &&
    x.expiresAt === y.expiresAt &&
    x.terms === y.terms &&
    x.offeredBy === y.offeredBy &&
    x.offeredAt === y.offeredAt &&
    x.decisionId === y.decisionId
  );
}

/** Mechanical replay invariant for an already decided control transition.
 * Collective decision existence/consumption is independently bound by the application transaction.
 */
export function assertResourceControlTransition(
  before: ControlledResource,
  after: ResourceControl,
  operation: ControlCommand['type'],
  policy: ResourceControlPolicy,
) {
  assertResourceControlPolicy(policy);
  const controller = effectiveController(before),
    offer = before.control?.offer,
    subject = operation === 'accept' ? offer?.target : controller;
  if (
    !['offer', 'accept', 'cancel'].includes(operation) ||
    !subject ||
    after.policyVersion !== policy.version ||
    !Number.isSafeInteger(after.version) ||
    after.version !== controlVersion(before) + 1 ||
    !Number.isSafeInteger(after.at) ||
    after.at < (before.control?.at ?? 0) ||
    !validControllerId(after.changedBy) ||
    !validController(after.controller) ||
    (subject.kind === 'resident'
      ? after.changedBy !== subject.id || after.decisionId !== undefined
      : typeof after.decisionId !== 'string' || !validControllerId(after.decisionId))
  )
    throw Error('invalid-recorded-control-authority');
  if (operation === 'offer') {
    const next = after.offer;
    if (
      !sameController(after.controller, controller) ||
      !next ||
      !validController(next.target) ||
      sameController(next.target, controller) ||
      next.offeredAt !== after.at ||
      next.offeredBy !== after.changedBy ||
      next.decisionId !== after.decisionId ||
      !Number.isSafeInteger(next.expiresAt) ||
      next.expiresAt <= after.at ||
      next.expiresAt > after.at + policy.maxOfferHorizonMs ||
      typeof next.terms !== 'string' ||
      !next.terms.trim() ||
      next.terms.length > policy.maxTermsChars
    )
      throw Error('invalid-recorded-control-offer');
  } else if (
    !offer ||
    after.offer !== undefined ||
    (operation === 'accept'
      ? after.at >= offer.expiresAt || !sameController(after.controller, offer.target)
      : !sameController(after.controller, controller))
  )
    throw Error('invalid-recorded-control-resolution');
}
