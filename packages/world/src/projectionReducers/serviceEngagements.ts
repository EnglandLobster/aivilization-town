import { serviceEstateCashSource } from '../serviceEstateAccounting';
import { serviceFacilityFitsLocation } from '../serviceFacilityRegistration';
import { assertMaterialConsumerEnvelope } from '../materialConsumerEnvelope';
import { enterpriseController } from '@aivilization/enterprise';
import { applyServiceCompensation } from '../serviceCompensation';
import { assertServiceEnterpriseAccounting } from '../serviceEnterpriseAccounting';
import { assertServiceElapsedBody, assertServiceAttendanceBody } from '../serviceTime';
import {
  applyServiceEngagementCommit,
  SERVICE_ENGAGEMENT_ESCROW,
  engagementEscrowBalance,
} from '@aivilization/services';
import { applyEscrowAccounting } from '../residentEscrowAccounting';
import { tradeSourceStartFailure } from '@aivilization/commerce';
import { applyMaterialCommit } from '@aivilization/materials';
import { applyPremisesEvent } from '@aivilization/premises';
import { asAgentId } from '@aivilization/sim-core';
import type { WorldProjection } from '../projection';
import { EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION, type WorldEvent } from '../events';
import { serviceMaterialAllocations } from '../residentServiceEngagements';
import {
  serviceParticipantCondition,
  servicePresenceReserved,
  servicePremisesWindowFailure,
} from '../serviceEngagementPorts';
import { serviceFactsEqual as equal } from '@aivilization/services';
import type { PublicServiceFundingProof } from '../publicServiceProcurement';
export function applyServiceEngagementsProjection(
  w: WorldProjection,
  event: WorldEvent,
  publicFundingProof?: PublicServiceFundingProof,
): WorldProjection | undefined {
  if (event.type !== 'ResidentServiceEngagementsCommitted') return undefined;
  const p = event.payload;
  if (p.events.some((e) => e.type === 'ServicePublicFundingEnabled'))
    throw Error('public-service-funding-needs-explicit-world-activation');
  if (
    publicFundingProof &&
    (p.events.length !== 1 ||
      p.events[0]?.type !== 'ServiceEngagementChanged' ||
      p.events[0].engagement.id !== publicFundingProof.engagementId ||
      p.events[0].engagement.status !== 'funded' ||
      p.events[0].engagement.payer.sector !== 'treasury' ||
      p.actorId !== publicFundingProof.actorId ||
      p.materialEvents.length ||
      p.materialInstructions.length ||
      p.premisesEvents.length)
  )
    throw Error('unrelated-public-service-effects');
  if (
    p.policyVersion !== 'resident-service-engagements-v1' ||
    (w.serviceTime ? event.occurredAt > w.clock.now : event.occurredAt !== w.clock.now)
  )
    throw Error('invalid-service-commit-version-or-time');
  if (p.elapsedBody) {
    if (p.elapsedBody.until !== event.occurredAt)
      throw Error('service-elapsed-event-time-mismatch');
    assertServiceElapsedBody(w, p.elapsedBody);
  }
  if (p.elapsedAttendance) {
    if (p.elapsedBody || p.elapsedAttendance.until !== event.occurredAt)
      throw Error('service-attendance-event-time-mismatch');
    assertServiceAttendanceBody(w, p.elapsedAttendance);
    const before = w.serviceEngagements!.engagements[p.elapsedAttendance.engagementId]!,
      changed = p.events.find(
        (e) => e.type === 'ServiceEngagementChanged' && e.engagement.id === before.id,
      );
    if (
      changed?.type !== 'ServiceEngagementChanged' ||
      changed.engagement.progressMs !== before.progressMs ||
      changed.engagement.settledAt !== p.elapsedAttendance.until ||
      (p.elapsedAttendance.exhausted && changed.engagement.status !== 'ended') ||
      p.events.some((e) => e.type === 'ServiceEngagementSettled')
    )
      throw Error('attendance-cannot-invent-delivered-service');
  }
  if (w.serviceEmployment)
    for (const change of p.events) {
      if (change.type !== 'ServiceEngagementChanged') continue;
      const before = w.serviceEngagements?.engagements[change.engagement.id];
      if (
        p.actorId === 'system' &&
        before?.providerPresence &&
        !before.recipientPresence &&
        change.engagement.settledAt > before.settledAt &&
        !p.elapsedAttendance
      )
        throw Error('actual-service-attendance-proof-required');
    }
  for (const f of p.events.filter((e) => e.type === 'ServiceEngagementSettled')) {
    if (
      !!w.serviceTime !== !!f.settlement.elapsedBody ||
      (f.settlement.elapsedBody && !equal(f.settlement.elapsedBody, p.elapsedBody))
    )
      throw Error('service-elapsed-proof-required');
  }
  assertMaterialConsumerEnvelope(w.materials, p.materialEvents, 'services');
  const result = applyServiceEngagementCommit(
      w.serviceEngagements,
      p.events,
      p.transactions,
      p.materialInstructions,
    ),
    material = applyMaterialCommit(
      w.materials,
      p.materialEvents,
      serviceMaterialAllocations(p.materialInstructions),
    );
  if (Object.keys(material.residentDeltas).length || material.efforts.length)
    throw Error('unrelated-service-material-effects');
  const receipts = p.materialEvents.filter((e) => e.type === 'MaterialReceiptRecorded');
  if (receipts.length !== p.materialInstructions.length)
    throw Error('service-material-receipt-mismatch');
  for (const i of p.materialInstructions) {
    const before = w.materials?.reservations?.records[i.reservationId],
      after = material.state.reservations?.records[i.reservationId];
    if (
      !before ||
      !after ||
      before.revision !== i.expectedRevision ||
      after.revision !== before.revision + 1 ||
      after.status !== (i.finish ? 'settled' : 'bound') ||
      after.consumer.domain !== 'services' ||
      after.consumer.id !== i.engagementId ||
      after.beneficiary.kind !== i.controller.kind ||
      after.beneficiary.id !== i.controller.id
    )
      throw Error('service-material-binding-mismatch');
  }
  const allowedStocks = new Set(
    p.materialInstructions.map((i) => w.materials?.reservations?.records[i.reservationId]?.stockId),
  );
  for (const e of p.materialEvents) {
    if (e.type === 'MaterialStockChanged') {
      const old = w.materials?.stocks[e.stock.id];
      if (
        !old ||
        !allowedStocks.has(old.id) ||
        !equal({ ...e.stock, inventory: old.inventory, revision: old.revision, at: old.at }, old)
      )
        throw Error('unrelated-service-stock-change');
    } else if (e.type === 'MaterialReservationChanged') {
      if (!p.materialInstructions.some((i) => i.reservationId === e.reservation.id))
        throw Error('unrelated-service-reservation-change');
    } else if (
      e.type !== 'MaterialReceiptRecorded' ||
      e.receipt.operation !== 'consumer-materials' ||
      !allowedStocks.has(e.receipt.stockId) ||
      e.receipt.conversions.length
    )
      throw Error('unrelated-service-material-event');
  }
  assertServiceEnterpriseAccounting(w, p.events, p.enterpriseAccounting ?? []);
  const estateSource = serviceEstateCashSource(w, p.events, p.transactions);
  if (!!estateSource !== !!p.estateCashBatch)
    throw Error('service-estate-receipt-coverage-mismatch');
  const { common, agents, treasury, enterprises, residentExits } = applyEscrowAccounting({
    ...(estateSource && p.estateCashBatch
      ? {
          estateCashBatch: {
            source: estateSource,
            originalTransactions: p.transactions,
            batch: p.estateCashBatch,
          },
        }
      : {}),
    world: w,
    settlementAt: event.occurredAt,
    context: 'services',
    actorId: p.actorId,
    referenceIds: p.events
      .filter((e) => e.type === 'ServiceEngagementChanged')
      .map((e) => e.engagement.id),
    transactions: p.estateCashBatch
      ? p.estateCashBatch.effects.flatMap((e) => e.resolution.transactions)
      : p.transactions,
    commonEvents: p.commonAccountEvents,
    ...(p.enterpriseAccounting ? { serviceEnterpriseEvents: p.enterpriseAccounting } : {}),
    escrowAccount: SERVICE_ENGAGEMENT_ESCROW,
    beforeEscrow: engagementEscrowBalance(w.serviceEngagements),
    afterEscrow: engagementEscrowBalance(result.state),
    allowTreasury: !!w.serviceEngagements?.publicFunding,
  });
  let premises = w.premises;
  for (const e of p.premisesEvents) {
    if (w.serviceEngagements || p.actorId !== 'system' || e.type !== 'ServiceFacilityEndowed')
      throw Error('invalid-service-facility-event');
    if (!serviceFacilityFitsLocation(w, e.endowment))
      throw Error('service-endowment-exceeds-location');
    premises = applyPremisesEvent(premises, e);
  }
  const activityTimeByAgent = { ...w.activityTimeByAgent };
  if (p.elapsedAttendance) {
    const e = w.serviceEngagements!.engagements[p.elapsedAttendance.engagementId]!;
    const { educationScore, ...physiology } = p.elapsedAttendance.providerAfter;
    agents[e.providerId] = { ...agents[e.providerId]!, physiology, educationScore };
  }
  if (p.elapsedBody) {
    const e = w.serviceEngagements!.engagements[p.elapsedBody.engagementId]!;
    if (!p.events.some((v) => v.type === 'ServiceEngagementChanged' && v.engagement.id === e.id))
      throw Error('orphan-service-body');
    for (const [id, condition] of [
      [e.providerId, p.elapsedBody.providerAfter],
      [e.recipientId, p.elapsedBody.recipientAfter],
    ] as const) {
      const { educationScore, ...physiology } = condition;
      agents[id] = { ...agents[id]!, physiology, educationScore };
    }
  }
  for (const f of result.settlements) {
    const e = w.serviceEngagements?.engagements[f.engagementId];
    if (
      !e?.providerPresence ||
      !e.recipientPresence ||
      !servicePresenceReserved(w, e.providerPresence) ||
      !servicePresenceReserved(w, e.recipientPresence) ||
      !equal(serviceParticipantCondition(w, e.providerId), f.providerBefore) ||
      !equal(serviceParticipantCondition(w, e.recipientId), f.recipientBefore)
    )
      throw Error('service-physical-proof-mismatch');
    for (const [id, condition] of [
      [e.providerId, f.providerAfter],
      [e.recipientId, f.recipientAfter],
    ] as const) {
      const a = agents[id];
      if (!a || a.locationId !== e.locationId || w.transitByAgent?.[id])
        throw Error('service-actual-presence-required');
      const { educationScore, ...physiology } = condition;
      agents[id] = { ...a, physiology, educationScore };
    }
  }
  for (const r of result.reserves) {
    const a = agents[r.actorId];
    if (
      !a ||
      p.actorId !== r.actorId ||
      w.transitByAgent?.[r.actorId] ||
      (w.activityTimeByAgent[r.actorId]?.availableAt ?? 0) > w.clock.now ||
      r.startedAt !== w.clock.now
    )
      throw Error('invalid-service-personal-time-reservation');
    activityTimeByAgent[r.actorId] = {
      agentId: asAgentId(r.actorId),
      activity: 'participation',
      commandType: 'ResidentServiceWork',
      policyVersion: EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
      settlementTiming: 'effects-at-completion',
      startedAt: r.startedAt,
      availableAt: r.until,
      durationSeconds: (r.until - r.startedAt) / 1000,
      committedAt: w.clock.now,
    };
  }
  for (const r of result.releases) {
    // Keep historical release semantics outside the explicitly enabled employment mode.
    // During a multi-boundary advance, the final world clock may be beyond the
    // original reservation; the source interval still proves an earlier release.
    if (!servicePresenceReserved(w, r) || (!w.serviceEmployment && r.until <= w.clock.now))
      continue;
    const old = activityTimeByAgent[r.actorId]!;
    const sourceEnd = p.elapsedBody
      ? p.elapsedBody.from + p.elapsedBody.workedMs
      : p.elapsedAttendance
        ? p.elapsedAttendance.from + p.elapsedAttendance.attendedMs
        : w.serviceEmployment
          ? event.occurredAt
          : w.clock.now;
    const availableAt = w.serviceEmployment ? Math.min(r.until, sourceEnd) : sourceEnd;
    activityTimeByAgent[r.actorId] = {
      ...old,
      availableAt,
      durationSeconds: (availableAt - old.startedAt) / 1000,
    };
  }
  for (const e of p.events)
    if (e.type === 'ServiceEngagementChanged') {
      const before = w.serviceEngagements?.engagements[e.engagement.id],
        after = e.engagement;
      for (const role of ['providerPresence', 'recipientPresence'] as const) {
        const presence = after[role];
        if (
          !before?.[role] &&
          presence &&
          servicePremisesWindowFailure(w, after, presence.actorId, presence.until)
        )
          throw Error('service-permit-window-exceeded');
      }
      if (
        ((!before?.providerPresence && after.providerPresence) ||
          (!before?.recipientPresence && after.recipientPresence)) &&
        tradeSourceStartFailure(w.residentTrade, { kind: 'service', id: after.id })
      )
        throw Error('trade-unfunded-service-cannot-start');
      if (!before && after.createdBy !== p.actorId) throw Error('service-creator-mismatch');
      if (
        before?.status === 'offered' &&
        after.status === 'accepted' &&
        p.actorId !== after.recipientId
      )
        throw Error('service-recipient-consent-mismatch');
      if (before?.status === 'accepted' && after.status === 'funded') {
        if (
          after.payer.sector === 'treasury' &&
          (!publicFundingProof ||
            before.revision !== publicFundingProof.expectedRevision ||
            after.maximumCharge !== publicFundingProof.maximumCharge ||
            after.fundingDecisionId !== publicFundingProof.proposalId ||
            after.fundedBy !== publicFundingProof.actorId ||
            (treasury ?? 0) < (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0))
        )
          throw Error('exact-public-procurement-composite-event-required');
        if (
          after.fundedBy !== p.actorId ||
          (after.payer.sector === 'agent' && after.payer.id !== p.actorId) ||
          (after.payer.sector === 'enterprise' &&
            (() => {
              const firm = w.enterprises[after.payer.id];
              if (!firm) return true;
              const controller = enterpriseController(firm);
              return controller.kind === 'resident'
                ? controller.id !== p.actorId
                : !after.fundingDecisionId;
            })()) ||
          (after.payer.sector === 'collective' && !after.fundingDecisionId)
        )
          throw Error('service-funding-authority-mismatch');
      }
    }
  return applyServiceCompensation({
    before: w,
    ...(p.elapsedAttendance ? { attendance: p.elapsedAttendance } : {}),
    events: p.events,
    actorId: p.actorId,
    eventId: event.id,
    ...(p.employment ? { employment: p.employment } : {}),
    after: {
      ...w,
      serviceEngagements: result.state,
      ...(residentExits ? { residentExits } : {}),
      materials: material.state,
      ...(common ? { commonAccounts: common } : {}),
      ...(premises ? { premises } : {}),
      agents,
      enterprises,
      ...(treasury === undefined ? {} : { treasury }),
      activityTimeByAgent,
    },
  });
}
