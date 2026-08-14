import {
  buyFromPool,
  getInventoryQuantity,
  sellToPool,
  type AmmTradeResult,
} from '@aivilization/economy';
import type { CommandEnvelope } from '@aivilization/sim-core';
import { isEnterpriseOperational } from '@aivilization/enterprise';
import {
  calculateApplicationQuota,
  calculateRecruitmentCycleNumber,
  deriveEducationLevel,
  evaluateEffectiveEducationScoreForOccupation,
  evaluateOccupationApplication,
  evaluateResourceTransferSocialOutcome,
  evaluateResidentialTierUpgrade,
  evaluateTradeTax,
  resolveOccupation,
  type EducationSystemPolicy,
  type RecruitmentCyclePolicy,
  type ResidentialTierUpgradePolicy,
  type TaxPolicy,
} from '@aivilization/society';
import {
  assertAgentApplyJobPayload,
  assertAgentGiveResourcePayload,
  assertAgentTradePayload,
  assertAgentUpgradeResidentialTierPayload,
} from '../commands';
import type { WorldEvent } from '../events';
import type { WorldAgentState, WorldProjection } from '../projection';
import { resolveAgentRegion, resolveMarketPool } from '../regionalMarkets';
import type { SocialMattersPolicy } from '../matters';
import { appendMatterFulfillmentEvents } from './matters';
import {
  makeAgentActivityTimeCommittedEvent,
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  planSocialInteractionEvent,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

export function handleAgentGiveResourceCommand(input: {
  readonly command: CommandEnvelope<'AgentGiveResource', unknown>;
  readonly projection: WorldProjection;
  readonly socialMatters?: SocialMattersPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const sourceAgent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentGiveResourcePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentGiveResource', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const targetAgent = input.projection.agents[payload.targetAgentId];
  if (targetAgent === undefined) {
    return rejectCommand(
      input,
      'AgentGiveResource',
      `unknown target agent ${payload.targetAgentId}`,
    );
  }
  if (sourceAgent.agentId === targetAgent.agentId) {
    return rejectCommand(input, 'AgentGiveResource', 'resource transfer target must differ');
  }
  if (
    sourceAgent.locationId === null ||
    targetAgent.locationId === null ||
    sourceAgent.locationId !== targetAgent.locationId
  ) {
    return rejectCommand(
      input,
      'AgentGiveResource',
      'resource transfer participants must be co-located at a known location',
    );
  }
  const availableQuantity = getInventoryQuantity(sourceAgent.inventory, payload.commodityName);
  if (availableQuantity < payload.quantity) {
    return rejectCommand(
      input,
      'AgentGiveResource',
      `insufficient ${payload.commodityName}: required ${payload.quantity}, available ${availableQuantity}`,
    );
  }

  const socialOutcome = evaluateResourceTransferSocialOutcome({
    recipientAgentId: targetAgent.agentId,
    providerAgentId: sourceAgent.agentId,
    quantity: payload.quantity,
  });
  const summary = `${sourceAgent.agentId} gave ${payload.quantity} ${payload.commodityName} to ${targetAgent.agentId}${
    payload.note === undefined ? '.' : `: ${payload.note}`
  }`;
  const recipientRelation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: targetAgent.agentId,
    targetAgentId: sourceAgent.agentId,
    summary,
    relationDelta: socialOutcome.relationDelta,
    attitudeDelta: socialOutcome.attitudeDelta,
    outcomePolicyVersion: socialOutcome.policyVersion,
    outcomeSignals: socialOutcome.signals,
  });
  if (recipientRelation.status === 'invalid') {
    return rejectCommand(input, 'AgentGiveResource', recipientRelation.reason);
  }

  const events: WorldEvent[] = [
    makeEvent(input, 0, 'ResourceTransferred', {
      sourceAgentId: sourceAgent.agentId,
      targetAgentId: targetAgent.agentId,
      commodityName: payload.commodityName,
      quantity: payload.quantity,
      ...(payload.note === undefined ? {} : { note: payload.note }),
    }),
    makeEvent(input, 1, 'SocialInteractionCompleted', recipientRelation.payload),
    makeMemoryEvent(input, 2, {
      agentId: sourceAgent.agentId,
      kind: 'action',
      summary,
      status: 'succeeded',
      sourceEventOffsets: [0, 1],
      tags: ['resource-transfer', 'provided-help', payload.commodityName, targetAgent.agentId],
    }),
    makeMemoryEvent(input, 3, {
      agentId: targetAgent.agentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      sourceEventOffsets: [0, 1],
      tags: [
        'resource-transfer',
        'received-help',
        payload.commodityName,
        sourceAgent.agentId,
        ...socialOutcome.signals,
      ],
      consolidationHint: {
        kind: 'social',
        targetAgentId: sourceAgent.agentId,
        relationDelta: socialOutcome.relationDelta,
        attitudeDelta: socialOutcome.attitudeDelta,
        summary,
        outcomePolicyVersion: socialOutcome.policyVersion,
        outcomeSignals: socialOutcome.signals,
      },
    }),
  ];
  // World-verified fulfillment: the transfer itself counts as delivery
  // progress against any matching assigned matter (never self-report).
  appendMatterFulfillmentEvents({
    input,
    events,
    sourceAgentId: sourceAgent.agentId,
    targetAgentId: targetAgent.agentId,
    commodityName: payload.commodityName,
    quantity: payload.quantity,
    transferEventId: `${input.command.id}:event:0`,
    ...(input.socialMatters === undefined ? {} : { policy: input.socialMatters }),
  });
  return events;
}

export function handleAgentTradeCommand(input: {
  readonly command: CommandEnvelope<'AgentTrade', unknown>;
  readonly projection: WorldProjection;
  readonly activityDurationSeconds?: number;
  readonly regionalMarketsEnabled?: boolean;
  readonly tax?: TaxPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentTradePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentTrade', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const enterprise =
    payload.enterpriseId === undefined
      ? undefined
      : input.projection.enterprises[payload.enterpriseId];
  if (payload.enterpriseId !== undefined) {
    if (enterprise === undefined || !isEnterpriseOperational(enterprise)) {
      return rejectCommand(input, 'AgentTrade', 'enterprise is missing or closed');
    }
    if (
      enterprise.ownerAgentId !== agent.agentId &&
      !enterprise.employeeAgentIds.includes(agent.agentId)
    ) {
      return rejectCommand(input, 'AgentTrade', 'agent is not authorized for enterprise');
    }
  }
  const regionalMarketsEnabled = input.regionalMarketsEnabled === true;

  // Resolve which regional pool the trade settles against. When regional
  // markets are disabled this always resolves to the default region, so the
  // pool key is the bare commodity name — identical to the legacy global lookup.
  const agentRegionId = resolveAgentRegion({
    projection: input.projection,
    agentLocationId: agent.locationId,
  });
  const requestedRegionId = regionalMarketsEnabled
    ? (payload.regionId ?? agentRegionId)
    : undefined;

  if (regionalMarketsEnabled) {
    // Co-location gate: an agent may only trade against the region it currently
    // stands in. This is the friction that makes regional price divergence
    // durable — exploiting a cheaper foreign region requires physically moving
    // there first. It mirrors the existing co-location gate used by conversation
    // and resource transfer. A locationless agent is treated as standing in the
    // default region and may still trade there.
    if (
      agent.locationId !== null &&
      payload.regionId !== undefined &&
      payload.regionId !== agentRegionId
    ) {
      return rejectCommand(
        input,
        'AgentTrade',
        `trade-requires-regional-co-location: agent in region ${agentRegionId}, requested ${payload.regionId}`,
      );
    }
  }

  const pool = resolveMarketPool(input.projection, {
    regionId: requestedRegionId,
    commodity: payload.commodityName,
  });
  if (pool === undefined) {
    const regionHint =
      regionalMarketsEnabled && requestedRegionId !== undefined
        ? ` in region ${requestedRegionId}`
        : '';
    return rejectCommand(
      input,
      'AgentTrade',
      `missing AMM pool for ${payload.commodityName}${regionHint}`,
    );
  }

  if (payload.side === 'buy') {
    const tradeResult = parsePayload(() => buyFromPool(pool, payload.quantity));
    if (tradeResult.status === 'invalid') {
      return rejectCommand(input, 'AgentTrade', tradeResult.reason);
    }
    const currencyRequired = tradeResult.payload.currencyDelta;
    const availableBalance = enterprise?.balance ?? agent.balance;
    if (availableBalance < currencyRequired) {
      return rejectCommand(
        input,
        'AgentTrade',
        `insufficient balance: required ${currencyRequired}, available ${availableBalance}`,
      );
    }

    return createTradeEvents(
      input,
      payload.side,
      payload.commodityName,
      payload.quantity,
      currencyRequired,
      tradeResult.payload,
      input.activityDurationSeconds,
      requestedRegionId,
      input.tax,
      payload.enterpriseId,
    );
  }

  const available = getInventoryQuantity(
    enterprise?.inventory ?? agent.inventory,
    payload.commodityName,
  );
  if (available < payload.quantity) {
    return rejectCommand(
      input,
      'AgentTrade',
      `insufficient ${payload.commodityName}: required ${payload.quantity}, available ${available}`,
    );
  }

  const tradeResult = parsePayload(() => sellToPool(pool, payload.quantity));
  if (tradeResult.status === 'invalid') {
    return rejectCommand(input, 'AgentTrade', tradeResult.reason);
  }

  return createTradeEvents(
    input,
    payload.side,
    payload.commodityName,
    payload.quantity,
    -tradeResult.payload.currencyDelta,
    tradeResult.payload,
    input.activityDurationSeconds,
    requestedRegionId,
    input.tax,
    payload.enterpriseId,
  );
}

function createTradeEvents(
  input: {
    readonly command: CommandEnvelope<'AgentTrade', unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  },
  side: 'buy' | 'sell',
  commodityName: string,
  commodityQuantity: number,
  currencyQuantity: number,
  tradeResult: AmmTradeResult,
  activityDurationSeconds: number | undefined,
  regionId: string | undefined,
  tax: TaxPolicy | undefined,
  enterpriseId: string | undefined,
): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const enterprise =
    enterpriseId === undefined ? undefined : input.projection.enterprises[enterpriseId];
  const tradeTax =
    side === 'sell' && tax !== undefined
      ? evaluateTradeTax({ saleProceeds: currencyQuantity, policy: tax })
      : 0;

  const events: WorldEvent[] = [
    makeEvent(input, 0, 'TradeExecuted', {
      agentId: agent.agentId,
      side,
      commodityName,
      commodityQuantity,
      currencyQuantity,
      poolAfter: tradeResult.poolAfter,
      moneySupplyDelta: tradeResult.moneySupplyDelta,
      effectivePrice: tradeResult.effectivePrice,
      spotPriceBefore: tradeResult.spotPriceBefore,
      spotPriceAfter: tradeResult.spotPriceAfter,
      slippageRatio: tradeResult.slippageRatio,
      invariantBefore: tradeResult.invariantBefore,
      invariantAfter: tradeResult.invariantAfter,
      ...(regionId === undefined ? {} : { regionId }),
      ...(enterpriseId === undefined ? {} : { enterpriseId }),
    }),
  ];
  if (activityDurationSeconds !== undefined) {
    events.push(
      makeAgentActivityTimeCommittedEvent(input, events.length, {
        agentId: agent.agentId,
        activity: 'trade',
        commandType: 'AgentTrade',
        durationSeconds: activityDurationSeconds,
      }),
    );
  }
  if (tradeTax > 0) {
    events.push(
      makeEvent(input, events.length, 'TradeTaxCharged', {
        agentId: agent.agentId,
        commodityName,
        saleProceeds: currencyQuantity,
        amount: tradeTax,
        previousBalance: (enterprise?.balance ?? agent.balance) + currencyQuantity,
        nextBalance: (enterprise?.balance ?? agent.balance) + currencyQuantity - tradeTax,
        ...(enterpriseId === undefined ? {} : { enterpriseId }),
      }),
    );
  }
  events.push(
    makeMemoryEvent(input, events.length, {
      summary: `${side === 'buy' ? 'Bought' : 'Sold'} ${commodityQuantity} ${commodityName}.`,
      status: 'succeeded',
      tags: ['trade', side, commodityName],
    }),
  );
  return events;
}

export function handleAgentApplyJobCommand(input: {
  readonly command: CommandEnvelope<'AgentApplyJob', unknown>;
  readonly projection: WorldProjection;
  readonly populationEducationScores: readonly number[];
  readonly quotaByResidentialTier: readonly number[];
  readonly recruitmentCycle?: RecruitmentCyclePolicy;
  readonly educationSystem?: EducationSystemPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentApplyJobPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyJob', payloadResult.reason);
  }

  const quotaResult = parsePayload(() =>
    calculateApplicationQuota({
      residentialTier: agent.residentialTier,
      quotaByResidentialTier: input.quotaByResidentialTier,
    }),
  );
  if (quotaResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyJob', quotaResult.reason);
  }

  const cycleNumber =
    input.recruitmentCycle === undefined
      ? 0
      : calculateRecruitmentCycleNumber({
          simulationTime: input.projection.clock.now,
          cycleDurationMs: input.recruitmentCycle.cycleDurationMs,
        });
  const applicationsInQuotaWindow = input.projection.jobApplications.filter(
    (application) =>
      application.agentId === agent.agentId &&
      (input.recruitmentCycle === undefined || application.cycleNumber === cycleNumber),
  );
  const usedApplications = applicationsInQuotaWindow.length;
  if (usedApplications >= quotaResult.payload) {
    return rejectCommand(
      input,
      'AgentApplyJob',
      `application quota exceeded: allowed ${quotaResult.payload}, used ${usedApplications}`,
    );
  }

  const payload = payloadResult.payload;
  if (
    input.recruitmentCycle !== undefined &&
    applicationsInQuotaWindow.some(
      (application) => application.occupationName === payload.occupationName,
    )
  ) {
    return rejectCommand(
      input,
      'AgentApplyJob',
      `duplicate application for ${payload.occupationName} in recruitment cycle ${cycleNumber}`,
    );
  }
  // education-system-v3: vocational-track (中职) applicants are evaluated at
  // their effective education score (raw + tier bonus) for both the
  // eligibility check and the employer ranking; the effective score is
  // recorded on the submission event so replay never recomputes it.
  const effectiveScoreResult = parsePayload(() =>
    resolveEffectiveApplicationEducationScore({
      agent,
      occupationName: payload.occupationName,
      ...(input.educationSystem === undefined ? {} : { educationSystem: input.educationSystem }),
    }),
  );
  if (effectiveScoreResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyJob', effectiveScoreResult.reason);
  }
  const effectiveEducationScore = effectiveScoreResult.payload;
  const applicationResult = parsePayload(() =>
    evaluateOccupationApplication({
      occupationName: payload.occupationName,
      agent: {
        residentialTier: agent.residentialTier,
        educationScore: effectiveEducationScore,
        inventory: agent.inventory,
      },
      populationEducationScores: input.populationEducationScores,
    }),
  );
  if (applicationResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyJob', applicationResult.reason);
  }
  if (applicationResult.payload.status === 'rejected') {
    return rejectCommand(
      input,
      'AgentApplyJob',
      `${applicationResult.payload.reason}: ${applicationResult.payload.detail}`,
    );
  }

  const consumedInventory = applicationResult.payload.consumedInventory;
  const prerequisiteEvents: WorldEvent[] = Object.entries(consumedInventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemName, quantity], index) =>
      makeEvent(input, index, 'InventoryChanged', {
        agentId: agent.agentId,
        itemName,
        delta: -quantity,
        reason: 'job-application-prerequisite',
      }),
    );
  const baseOffset = prerequisiteEvents.length;
  const applicationId = `${input.command.id}:application`;
  const submittedEvent = makeEvent(input, baseOffset, 'JobApplicationSubmitted', {
    applicationId,
    cycleNumber,
    agentId: agent.agentId,
    occupationName: payload.occupationName,
    residentialTier: agent.residentialTier,
    educationScore: agent.educationScore,
    ...(effectiveEducationScore === agent.educationScore
      ? {}
      : { effectiveEducationScore }),
  });

  if (input.recruitmentCycle !== undefined) {
    return [
      ...prerequisiteEvents,
      submittedEvent,
      makeMemoryEvent(input, baseOffset + 1, {
        summary: `Submitted an application for ${payload.occupationName} in recruitment cycle ${cycleNumber}.`,
        status: 'succeeded',
        tags: ['apply-job', payload.occupationName, `recruitment-cycle:${cycleNumber}`],
        consolidationHint: {
          kind: 'habit',
          patternKey: `apply-job:${payload.occupationName}`,
          statement: `Applies for ${payload.occupationName} when qualified.`,
        },
      }),
    ];
  }

  return [
    ...prerequisiteEvents,
    submittedEvent,
    makeEvent(input, baseOffset + 1, 'JobAssigned', {
      applicationId,
      cycleNumber,
      agentId: agent.agentId,
      occupationName: payload.occupationName,
      previousJob: agent.job,
    }),
    makeMemoryEvent(input, baseOffset + 2, {
      summary: `Applied for ${payload.occupationName} and was assigned.`,
      status: 'succeeded',
      tags: ['apply-job', payload.occupationName],
      consolidationHint: {
        kind: 'habit',
        patternKey: `apply-job:${payload.occupationName}`,
        statement: `Applies for ${payload.occupationName} when qualified.`,
      },
    }),
  ];
}

export function handleAgentUpgradeResidentialTierCommand(input: {
  readonly command: CommandEnvelope<'AgentUpgradeResidentialTier', unknown>;
  readonly projection: WorldProjection;
  readonly policy: ResidentialTierUpgradePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentUpgradeResidentialTierPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentUpgradeResidentialTier', payloadResult.reason);
  }

  const decision = evaluateResidentialTierUpgrade({
    agent: {
      residentialTier: agent.residentialTier,
      balance: agent.balance,
      educationScore: agent.educationScore,
      inventory: agent.inventory,
    },
    targetResidentialTier: payloadResult.payload.targetResidentialTier,
    policy: input.policy,
  });
  if (decision.status === 'rejected') {
    return rejectCommand(
      input,
      'AgentUpgradeResidentialTier',
      `${decision.reason}: ${decision.detail}`,
    );
  }

  return [
    makeEvent(input, 0, 'ResidentialTierUpgraded', {
      agentId: agent.agentId,
      previousResidentialTier: decision.previousResidentialTier,
      nextResidentialTier: decision.nextResidentialTier,
      currencyCost: decision.currencyCost,
      consumedInventory: decision.consumedInventory,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Upgraded residential tier from ${decision.previousResidentialTier} to ${decision.nextResidentialTier}.`,
      status: 'succeeded',
      tags: ['upgrade-residential-tier', String(decision.nextResidentialTier)],
      consolidationHint: {
        kind: 'habit',
        patternKey: `upgrade-residential-tier:${decision.nextResidentialTier}`,
        statement: `Invests in residential tier ${decision.nextResidentialTier} when upgrade requirements are met.`,
      },
    }),
  ];
}

/**
 * Effective education score used to evaluate one job application. Legacy runs
 * (no education-system policy, or the policy disabled) keep the raw score; an
 * enabled policy routes through the domain pure function so the vocational
 * track bonus applies. The level falls back to the score-derived level,
 * matching the education-system fallback semantics.
 */
function resolveEffectiveApplicationEducationScore(input: {
  readonly agent: WorldAgentState;
  readonly occupationName: string;
  readonly educationSystem?: EducationSystemPolicy;
}): number {
  const policy = input.educationSystem;
  if (policy === undefined || !policy.enabled) {
    return input.agent.educationScore;
  }
  return evaluateEffectiveEducationScoreForOccupation({
    score: input.agent.educationScore,
    level:
      input.agent.educationLevel ?? deriveEducationLevel(input.agent.educationScore, policy),
    ...(input.agent.educationTrack === undefined ? {} : { track: input.agent.educationTrack }),
    occupationTier: resolveOccupation({ occupationName: input.occupationName }).jobTier,
    policy,
  });
}
