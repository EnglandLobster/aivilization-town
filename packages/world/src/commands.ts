import { asAgentId, asLocationId, type AgentId, type LocationId } from '@aivilization/sim-core';
import type { IncomeTaxBracket, PublicBudgetAllocation } from '@aivilization/society';

export type RegisterAgentPayload = {
  readonly agentId: AgentId;
  readonly creatorId: string;
  readonly displayName: string;
};

export type AgentEatPayload = {
  readonly commodityName: string;
  readonly quantity: number;
};

export type AgentConsumePayload = {
  readonly commodityName: string;
  readonly quantity: number;
};

export type AgentMoveToPayload = {
  readonly targetLocationId: LocationId;
  readonly reason?: string;
};

export type AgentObserveLocationPayload = {
  readonly focus?: string;
};

export type AgentStartConversationTurnPayload = {
  readonly speakerAgentId: AgentId;
  readonly utterance: string;
  readonly intent?: string;
};

export type AgentStartConversationSignalSeverityPayload = {
  readonly signal: string;
  readonly severity?: number;
};

export type AgentStartConversationTurnSignalsPayload = {
  readonly turnIndex: number;
  readonly signals: readonly AgentStartConversationSignalSeverityPayload[];
};

export type AgentStartConversationPayload = {
  readonly targetAgentId: AgentId;
  readonly topic: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly turns: readonly AgentStartConversationTurnPayload[];
  readonly turnSignals?: readonly AgentStartConversationTurnSignalsPayload[];
};

export type AgentStudyPayload = {
  readonly durationSeconds: number;
  readonly educationRatePerSecond: number;
};

export type AgentSleepPayload = {
  readonly durationSeconds: number;
};

export type AgentSeeDoctorPayload = {
  readonly durationSeconds: number;
};

export type AgentWorkPayload = {
  readonly occupationName: string;
  readonly laborSeconds: number;
  readonly enterpriseId?: string;
};

export type AgentProducePayload = {
  readonly commodityName: string;
  readonly quantity: number;
  readonly availableLaborSeconds: number;
  readonly enterpriseId?: string;
};

export type AgentTradePayload = {
  readonly side: 'buy' | 'sell';
  readonly commodityName: string;
  readonly quantity: number;
  /**
   * Optional regional market the trade targets. When the regional-markets
   * switch is enabled this selects which regional AMM pool the trade settles
   * against; omitted resolves to the default (single) region. The handler also
   * gates the trade on regional co-location when regional markets are on.
   */
  readonly regionId?: string;
  readonly enterpriseId?: string;
};

export type AgentFoundEnterprisePayload = {
  readonly enterpriseId: string;
  readonly name: string;
  readonly occupationName: string;
  readonly initialCapital: number;
  readonly maxEmployees: number;
};

export type AgentJoinEnterprisePayload = {
  readonly enterpriseId: string;
};

export type AgentFundEnterprisePayload = {
  readonly enterpriseId: string;
  readonly amount: number;
};

export type AgentCloseEnterprisePayload = {
  readonly enterpriseId: string;
};

export type AgentSetEnterpriseJobPostingPayload = {
  readonly enterpriseId: string;
  readonly wageOffer: number;
  readonly openSlots: number;
};

export type AgentLeaveEnterprisePayload = {
  readonly enterpriseId: string;
};

export type AgentLayoffEnterpriseEmployeePayload = {
  readonly enterpriseId: string;
  readonly employeeAgentId: AgentId;
};

export type AgentDepositPayload = {
  readonly amount: number;
};

export type AgentWithdrawPayload = {
  readonly amount: number;
};

export type AgentRequestLoanPayload = {
  readonly amount: number;
};

export type AgentExportCommodityPayload = {
  readonly commodityName: string;
  readonly quantity: number;
  /**
   * Settle the trade on an enterprise's cash and inventory instead of the
   * agent's. The acting agent must own or be employed by the enterprise.
   */
  readonly asEnterpriseId?: string;
};

export type AgentImportCommodityPayload = {
  readonly commodityName: string;
  readonly quantity: number;
  readonly asEnterpriseId?: string;
};

export function assertAgentExportCommodityPayload(payload: unknown): AgentExportCommodityPayload {
  return assertExternalTradePayload(payload, 'AgentExportCommodity');
}

export function assertAgentImportCommodityPayload(payload: unknown): AgentImportCommodityPayload {
  return assertExternalTradePayload(payload, 'AgentImportCommodity');
}

function assertExternalTradePayload(
  payload: unknown,
  commandType: string,
): AgentExportCommodityPayload {
  if (!isRecord(payload)) {
    throw new Error(`${commandType} payload must be an object`);
  }
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  const asEnterpriseId = payload['asEnterpriseId'];
  assertBoundedNonEmptyString(commodityName, `${commandType} commodityName`, 128);
  assertPositiveFinite(quantity, `${commandType} quantity`);
  assertOptionalEnterpriseId(asEnterpriseId, `${commandType} asEnterpriseId`);
  return {
    commodityName: commodityName.trim(),
    quantity,
    ...(asEnterpriseId === undefined ? {} : { asEnterpriseId: asEnterpriseId.trim() }),
  };
}

export function assertAgentDepositPayload(payload: unknown): AgentDepositPayload {
  return assertBankAmountPayload(payload, 'AgentDeposit');
}

export function assertAgentWithdrawPayload(payload: unknown): AgentWithdrawPayload {
  return assertBankAmountPayload(payload, 'AgentWithdraw');
}

export function assertAgentRequestLoanPayload(payload: unknown): AgentRequestLoanPayload {
  return assertBankAmountPayload(payload, 'AgentRequestLoan');
}

function assertBankAmountPayload(
  payload: unknown,
  commandType: string,
): { readonly amount: number } {
  if (!isRecord(payload)) {
    throw new Error(`${commandType} payload must be an object`);
  }
  const amount = payload['amount'];
  assertPositiveFinite(amount, `${commandType} amount`);
  return { amount };
}

export type AgentGiveResourcePayload = {
  readonly targetAgentId: AgentId;
  readonly commodityName: string;
  readonly quantity: number;
  readonly note?: string;
};

export type AgentApplyJobPayload = {
  readonly occupationName: string;
};

export type AgentApplyEducationExamPayload = {
  readonly targetLevel: number;
};

export type AgentUpgradeResidentialTierPayload = {
  readonly targetResidentialTier: number;
};

export type AgentBuildHousingPayload = {
  readonly locationId: LocationId;
};

export type AdvanceSimulationTimePayload = {
  readonly deltaMs: number;
};

export type AgentPostBulletinPayload = {
  readonly title: string;
  readonly body: string;
  readonly priority?: 'normal' | 'high';
  readonly effectiveAt?: number;
};

export type IssueTownBulletinPayload = {
  readonly title: string;
  readonly body: string;
  readonly priority?: 'normal' | 'high';
  readonly effectiveAt?: number;
};

export type GovernanceCommandMetadataPayload = {
  readonly reason: string;
  readonly petitionId?: string;
  readonly expectedGovernanceRevision?: number;
};

export type SetTaxPolicyPayload = GovernanceCommandMetadataPayload & {
  readonly neutralRate: number;
  readonly incomeTaxBrackets: readonly IncomeTaxBracket[];
  readonly tradeTaxRate: number;
  readonly dividendTaxRate?: number;
};

export type SetPublicBudgetPayload = GovernanceCommandMetadataPayload & {
  readonly cadenceMs: number;
  readonly minimumTreasuryReserve: number;
  readonly allocations: readonly PublicBudgetAllocation[];
};

export type SetSubsidyPolicyPayload = GovernanceCommandMetadataPayload & {
  readonly minimumBalance: number;
  readonly maxSubsidy: number;
};

export function assertSetTaxPolicyPayload(payload: unknown): SetTaxPolicyPayload {
  const record = assertGovernancePayloadRecord(payload, 'SetTaxPolicy');
  const metadata = parseGovernanceMetadata(record, 'SetTaxPolicy');
  const neutralRate = record['neutralRate'];
  const tradeTaxRate = record['tradeTaxRate'];
  const dividendTaxRate = record['dividendTaxRate'];
  const incomeTaxBrackets = record['incomeTaxBrackets'];
  assertFinite(neutralRate, 'SetTaxPolicy neutralRate');
  assertFinite(tradeTaxRate, 'SetTaxPolicy tradeTaxRate');
  if (dividendTaxRate !== undefined) assertFinite(dividendTaxRate, 'SetTaxPolicy dividendTaxRate');
  if (!Array.isArray(incomeTaxBrackets)) {
    throw new Error('SetTaxPolicy incomeTaxBrackets must be an array');
  }
  if (incomeTaxBrackets.length > 16) {
    throw new Error('SetTaxPolicy incomeTaxBrackets must contain at most 16 entries');
  }
  const brackets = incomeTaxBrackets.map((candidate, index): IncomeTaxBracket => {
    if (!isRecord(candidate)) {
      throw new Error(`SetTaxPolicy incomeTaxBrackets[${index}] must be an object`);
    }
    const upToAmount = candidate['upToAmount'];
    const rate = candidate['rate'];
    if (upToAmount !== null)
      assertPositiveFinite(upToAmount, `SetTaxPolicy incomeTaxBrackets[${index}].upToAmount`);
    assertFinite(rate, `SetTaxPolicy incomeTaxBrackets[${index}].rate`);
    return { upToAmount, rate };
  });
  return {
    ...metadata,
    neutralRate,
    incomeTaxBrackets: brackets,
    tradeTaxRate,
    ...(dividendTaxRate === undefined ? {} : { dividendTaxRate }),
  };
}

export function assertSetPublicBudgetPayload(payload: unknown): SetPublicBudgetPayload {
  const record = assertGovernancePayloadRecord(payload, 'SetPublicBudget');
  const metadata = parseGovernanceMetadata(record, 'SetPublicBudget');
  const cadenceMs = record['cadenceMs'];
  const minimumTreasuryReserve = record['minimumTreasuryReserve'];
  const allocations = record['allocations'];
  assertPositiveInteger(cadenceMs, 'SetPublicBudget cadenceMs');
  assertNonNegativeFinite(minimumTreasuryReserve, 'SetPublicBudget minimumTreasuryReserve');
  if (!Array.isArray(allocations)) {
    throw new Error('SetPublicBudget allocations must be an array');
  }
  if (allocations.length > 16) {
    throw new Error('SetPublicBudget allocations must contain at most 16 entries');
  }
  return {
    ...metadata,
    cadenceMs,
    minimumTreasuryReserve,
    allocations: allocations.map((candidate, index): PublicBudgetAllocation => {
      if (!isRecord(candidate)) {
        throw new Error(`SetPublicBudget allocations[${index}] must be an object`);
      }
      const service = candidate['service'];
      const amountPerCadence = candidate['amountPerCadence'];
      assertBoundedNonEmptyString(service, `SetPublicBudget allocations[${index}].service`, 100);
      assertNonNegativeFinite(
        amountPerCadence,
        `SetPublicBudget allocations[${index}].amountPerCadence`,
      );
      return { service: service.trim(), amountPerCadence };
    }),
  };
}

export function assertSetSubsidyPolicyPayload(payload: unknown): SetSubsidyPolicyPayload {
  const record = assertGovernancePayloadRecord(payload, 'SetSubsidyPolicy');
  const metadata = parseGovernanceMetadata(record, 'SetSubsidyPolicy');
  const minimumBalance = record['minimumBalance'];
  const maxSubsidy = record['maxSubsidy'];
  assertNonNegativeFinite(minimumBalance, 'SetSubsidyPolicy minimumBalance');
  assertNonNegativeFinite(maxSubsidy, 'SetSubsidyPolicy maxSubsidy');
  return { ...metadata, minimumBalance, maxSubsidy };
}

function assertBulletinPayload(payload: unknown, commandType: string): AgentPostBulletinPayload {
  if (!isRecord(payload)) {
    throw new Error(`${commandType} payload must be an object`);
  }
  const title = payload['title'];
  const body = payload['body'];
  const priority = payload['priority'];
  const effectiveAt = payload['effectiveAt'];
  assertBoundedNonEmptyString(title, `${commandType} title`, 200);
  assertBoundedNonEmptyString(body, `${commandType} body`, 2000);
  if (priority !== undefined && priority !== 'normal' && priority !== 'high') {
    throw new Error(`${commandType} priority must be normal or high`);
  }
  if (effectiveAt !== undefined) {
    assertNonNegativeFinite(effectiveAt, `${commandType} effectiveAt`);
  }
  return {
    title: title.trim(),
    body: body.trim(),
    ...(priority === undefined ? {} : { priority }),
    ...(effectiveAt === undefined ? {} : { effectiveAt }),
  };
}

export function assertAgentPostBulletinPayload(payload: unknown): AgentPostBulletinPayload {
  return assertBulletinPayload(payload, 'AgentPostBulletin');
}

export function assertIssueTownBulletinPayload(payload: unknown): IssueTownBulletinPayload {
  return assertBulletinPayload(payload, 'IssueTownBulletin');
}

export type AgentRaisePetitionPayload = {
  readonly topic: string;
  readonly statement: string;
};

export type AgentSignPetitionPayload = {
  readonly petitionId: string;
};

export function assertAgentRaisePetitionPayload(payload: unknown): AgentRaisePetitionPayload {
  const candidate = payload as Partial<AgentRaisePetitionPayload>;
  if (
    typeof candidate.topic !== 'string' ||
    candidate.topic.trim().length === 0 ||
    candidate.topic.length > 100
  ) {
    throw new Error('AgentRaisePetition topic must be a non-empty string of at most 100 chars');
  }
  if (
    typeof candidate.statement !== 'string' ||
    candidate.statement.trim().length === 0 ||
    candidate.statement.length > 1000
  ) {
    throw new Error(
      'AgentRaisePetition statement must be a non-empty string of at most 1000 chars',
    );
  }
  return { topic: candidate.topic.trim(), statement: candidate.statement.trim() };
}

export function assertAgentSignPetitionPayload(payload: unknown): AgentSignPetitionPayload {
  const candidate = payload as Partial<AgentSignPetitionPayload>;
  if (typeof candidate.petitionId !== 'string' || candidate.petitionId.trim().length === 0) {
    throw new Error('AgentSignPetition petitionId must be a non-empty string');
  }
  return { petitionId: candidate.petitionId.trim() };
}

export type AgentRaiseMatterPayload = {
  readonly topic: string;
  readonly statement: string;
  readonly requiredCommodity?: {
    readonly commodityName: string;
    readonly quantity: number;
  };
  readonly expiresInMs?: number;
};

export type AgentRespondMatterPayload = {
  readonly matterId: string;
  readonly decision: 'accept' | 'reject' | 'defer' | 'withdraw';
};

export type AgentAssignMatterPayload = {
  readonly matterId: string;
  readonly assigneeAgentId: AgentId;
};

export type AgentCloseMatterPayload = {
  readonly matterId: string;
  readonly outcome: 'fulfilled' | 'breached' | 'withdrawn';
};

export function assertAgentRaiseMatterPayload(payload: unknown): AgentRaiseMatterPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentRaiseMatter payload must be an object');
  }
  const topic = payload['topic'];
  const statement = payload['statement'];
  const requiredCommodity = payload['requiredCommodity'];
  const expiresInMs = payload['expiresInMs'];
  assertBoundedNonEmptyString(topic, 'AgentRaiseMatter topic', 200);
  assertBoundedNonEmptyString(statement, 'AgentRaiseMatter statement', 2000);
  if (expiresInMs !== undefined) {
    assertPositiveFinite(expiresInMs, 'AgentRaiseMatter expiresInMs');
  }
  let parsedRequiredCommodity: AgentRaiseMatterPayload['requiredCommodity'];
  if (requiredCommodity !== undefined) {
    if (!isRecord(requiredCommodity)) {
      throw new Error('AgentRaiseMatter requiredCommodity must be an object');
    }
    const commodityName = requiredCommodity['commodityName'];
    const quantity = requiredCommodity['quantity'];
    assertBoundedNonEmptyString(
      commodityName,
      'AgentRaiseMatter requiredCommodity.commodityName',
      128,
    );
    assertPositiveFinite(quantity, 'AgentRaiseMatter requiredCommodity.quantity');
    parsedRequiredCommodity = { commodityName: commodityName.trim(), quantity };
  }
  return {
    topic: topic.trim(),
    statement: statement.trim(),
    ...(parsedRequiredCommodity === undefined
      ? {}
      : { requiredCommodity: parsedRequiredCommodity }),
    ...(expiresInMs === undefined ? {} : { expiresInMs }),
  };
}

export function assertAgentRespondMatterPayload(payload: unknown): AgentRespondMatterPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentRespondMatter payload must be an object');
  }
  const matterId = payload['matterId'];
  const decision = payload['decision'];
  assertBoundedNonEmptyString(matterId, 'AgentRespondMatter matterId', 256);
  if (
    decision !== 'accept' &&
    decision !== 'reject' &&
    decision !== 'defer' &&
    decision !== 'withdraw'
  ) {
    throw new Error('AgentRespondMatter decision must be accept, reject, defer, or withdraw');
  }
  return { matterId: matterId.trim(), decision };
}

export function assertAgentAssignMatterPayload(payload: unknown): AgentAssignMatterPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentAssignMatter payload must be an object');
  }
  const matterId = payload['matterId'];
  const assigneeAgentId = payload['assigneeAgentId'];
  assertBoundedNonEmptyString(matterId, 'AgentAssignMatter matterId', 256);
  assertBoundedNonEmptyString(assigneeAgentId, 'AgentAssignMatter assigneeAgentId', 128);
  return { matterId: matterId.trim(), assigneeAgentId: asAgentId(assigneeAgentId.trim()) };
}

export function assertAgentCloseMatterPayload(payload: unknown): AgentCloseMatterPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentCloseMatter payload must be an object');
  }
  const matterId = payload['matterId'];
  const outcome = payload['outcome'];
  assertBoundedNonEmptyString(matterId, 'AgentCloseMatter matterId', 256);
  if (outcome !== 'fulfilled' && outcome !== 'breached' && outcome !== 'withdrawn') {
    throw new Error('AgentCloseMatter outcome must be fulfilled, breached, or withdrawn');
  }
  return { matterId: matterId.trim(), outcome };
}

export type AgentConfrontPayload = {
  readonly targetAgentId: AgentId;
  readonly statement: string;
};

export type AgentAttackPayload = {
  readonly targetAgentId: AgentId;
};

export type AgentIntervenePayload = {
  readonly attackerAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly statement: string;
};

export function assertAgentConfrontPayload(payload: unknown): AgentConfrontPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentConfront payload must be an object');
  }
  const targetAgentId = payload['targetAgentId'];
  const statement = payload['statement'];
  assertBoundedNonEmptyString(targetAgentId, 'AgentConfront targetAgentId', 128);
  assertBoundedNonEmptyString(statement, 'AgentConfront statement', 2000);
  return {
    targetAgentId: asAgentId(targetAgentId.trim()),
    statement: statement.trim(),
  };
}

export function assertAgentAttackPayload(payload: unknown): AgentAttackPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentAttack payload must be an object');
  }
  const targetAgentId = payload['targetAgentId'];
  assertBoundedNonEmptyString(targetAgentId, 'AgentAttack targetAgentId', 128);
  return { targetAgentId: asAgentId(targetAgentId.trim()) };
}

export function assertAgentIntervenePayload(payload: unknown): AgentIntervenePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentIntervene payload must be an object');
  }
  const attackerAgentId = payload['attackerAgentId'];
  const targetAgentId = payload['targetAgentId'];
  const statement = payload['statement'];
  assertBoundedNonEmptyString(attackerAgentId, 'AgentIntervene attackerAgentId', 128);
  assertBoundedNonEmptyString(targetAgentId, 'AgentIntervene targetAgentId', 128);
  assertBoundedNonEmptyString(statement, 'AgentIntervene statement', 2000);
  return {
    attackerAgentId: asAgentId(attackerAgentId.trim()),
    targetAgentId: asAgentId(targetAgentId.trim()),
    statement: statement.trim(),
  };
}

export function assertRegisterAgentPayload(payload: unknown): RegisterAgentPayload {
  if (!isRecord(payload)) {
    throw new Error('RegisterAgent payload must be an object');
  }
  const agentId = payload['agentId'];
  const creatorId = payload['creatorId'];
  const displayName = payload['displayName'];
  assertBoundedNonEmptyString(agentId, 'RegisterAgent agentId', 128);
  assertBoundedNonEmptyString(creatorId, 'RegisterAgent creatorId', 128);
  assertBoundedNonEmptyString(displayName, 'RegisterAgent displayName', 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(agentId)) {
    throw new Error('RegisterAgent agentId contains unsupported characters');
  }
  return {
    agentId: asAgentId(agentId.trim()),
    creatorId: creatorId.trim(),
    displayName: displayName.trim(),
  };
}

export function assertAgentEatPayload(payload: unknown): AgentEatPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentEat payload must be an object');
  }
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  if (typeof commodityName !== 'string' || commodityName.trim().length === 0) {
    throw new Error('AgentEat commodityName must not be empty');
  }
  assertPositiveFinite(quantity, 'AgentEat quantity');

  return {
    commodityName,
    quantity,
  };
}

export function assertAgentConsumePayload(payload: unknown): AgentConsumePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentConsume payload must be an object');
  }
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  assertBoundedNonEmptyString(commodityName, 'AgentConsume commodityName', 128);
  assertPositiveFinite(quantity, 'AgentConsume quantity');
  return { commodityName: commodityName.trim(), quantity };
}

export function assertAgentMoveToPayload(payload: unknown): AgentMoveToPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentMoveTo payload must be an object');
  }
  const targetLocationId = payload['targetLocationId'];
  const reason = payload['reason'];
  if (typeof targetLocationId !== 'string' || targetLocationId.trim().length === 0) {
    throw new Error('AgentMoveTo targetLocationId must not be empty');
  }
  if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length === 0)) {
    throw new Error('AgentMoveTo reason must not be empty');
  }

  return reason === undefined
    ? {
        targetLocationId: asLocationId(targetLocationId),
      }
    : {
        targetLocationId: asLocationId(targetLocationId),
        reason: reason.trim(),
      };
}

export function assertAgentObserveLocationPayload(payload: unknown): AgentObserveLocationPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentObserveLocation payload must be an object');
  }
  const focus = payload['focus'];
  if (focus !== undefined && (typeof focus !== 'string' || focus.trim().length === 0)) {
    throw new Error('AgentObserveLocation focus must not be empty');
  }

  return focus === undefined ? {} : { focus: focus.trim() };
}

export function assertAgentStartConversationPayload(
  payload: unknown,
): AgentStartConversationPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentStartConversation payload must be an object');
  }
  const targetAgentId = payload['targetAgentId'];
  const topic = payload['topic'];
  const relationDelta = payload['relationDelta'];
  const attitudeDelta = payload['attitudeDelta'];
  const turns = payload['turns'];
  const turnSignals = payload['turnSignals'];

  if (typeof targetAgentId !== 'string' || targetAgentId.trim().length === 0) {
    throw new Error('AgentStartConversation targetAgentId must not be empty');
  }
  if (typeof topic !== 'string' || topic.trim().length === 0) {
    throw new Error('AgentStartConversation topic must not be empty');
  }
  assertFinite(relationDelta, 'AgentStartConversation relationDelta');
  assertFinite(attitudeDelta, 'AgentStartConversation attitudeDelta');
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error('AgentStartConversation turns must not be empty');
  }
  if (turnSignals !== undefined && !Array.isArray(turnSignals)) {
    throw new Error('AgentStartConversation turnSignals must be an array');
  }

  return {
    targetAgentId: asAgentId(targetAgentId.trim()),
    topic: topic.trim(),
    relationDelta,
    attitudeDelta,
    turns: turns.map((turn, index) => assertAgentStartConversationTurnPayload(turn, index)),
    ...(turnSignals === undefined
      ? {}
      : {
          turnSignals: turnSignals.map((entry, index) =>
            assertAgentStartConversationTurnSignalsPayload(entry, index),
          ),
        }),
  };
}

export function assertAgentStudyPayload(payload: unknown): AgentStudyPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentStudy payload must be an object');
  }
  const durationSeconds = payload['durationSeconds'];
  const educationRatePerSecond = payload['educationRatePerSecond'];
  assertNonNegativeFinite(durationSeconds, 'AgentStudy durationSeconds');
  assertNonNegativeFinite(educationRatePerSecond, 'AgentStudy educationRatePerSecond');

  return {
    durationSeconds,
    educationRatePerSecond,
  };
}

export function assertAgentSleepPayload(payload: unknown): AgentSleepPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentSleep payload must be an object');
  }
  const durationSeconds = payload['durationSeconds'];
  assertNonNegativeFinite(durationSeconds, 'AgentSleep durationSeconds');

  return {
    durationSeconds,
  };
}

export function assertAgentSeeDoctorPayload(payload: unknown): AgentSeeDoctorPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentSeeDoctor payload must be an object');
  }
  const durationSeconds = payload['durationSeconds'];
  assertNonNegativeFinite(durationSeconds, 'AgentSeeDoctor durationSeconds');

  return {
    durationSeconds,
  };
}

export function assertAgentWorkPayload(payload: unknown): AgentWorkPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentWork payload must be an object');
  }
  const occupationName = payload['occupationName'];
  const laborSeconds = payload['laborSeconds'];
  const enterpriseId = payload['enterpriseId'];
  if (typeof occupationName !== 'string' || occupationName.trim().length === 0) {
    throw new Error('AgentWork occupationName must not be empty');
  }
  assertPositiveFinite(laborSeconds, 'AgentWork laborSeconds');
  assertOptionalEnterpriseId(enterpriseId, 'AgentWork enterpriseId');

  return {
    occupationName,
    laborSeconds,
    ...(enterpriseId === undefined ? {} : { enterpriseId: enterpriseId.trim() }),
  };
}

export function assertAgentProducePayload(payload: unknown): AgentProducePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentProduce payload must be an object');
  }
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  const availableLaborSeconds = payload['availableLaborSeconds'];
  const enterpriseId = payload['enterpriseId'];
  if (typeof commodityName !== 'string' || commodityName.trim().length === 0) {
    throw new Error('AgentProduce commodityName must not be empty');
  }
  assertPositiveInteger(quantity, 'AgentProduce quantity');
  assertNonNegativeFinite(availableLaborSeconds, 'AgentProduce availableLaborSeconds');
  assertOptionalEnterpriseId(enterpriseId, 'AgentProduce enterpriseId');

  return {
    commodityName,
    quantity,
    availableLaborSeconds,
    ...(enterpriseId === undefined ? {} : { enterpriseId: enterpriseId.trim() }),
  };
}

export function assertAgentTradePayload(payload: unknown): AgentTradePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentTrade payload must be an object');
  }
  const side = payload['side'];
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  const regionId = payload['regionId'];
  const enterpriseId = payload['enterpriseId'];
  if (side !== 'buy' && side !== 'sell') {
    throw new Error('AgentTrade side must be buy or sell');
  }
  assertOptionalEnterpriseId(enterpriseId, 'AgentTrade enterpriseId');
  if (typeof commodityName !== 'string' || commodityName.trim().length === 0) {
    throw new Error('AgentTrade commodityName must not be empty');
  }
  assertPositiveFinite(quantity, 'AgentTrade quantity');
  if (regionId !== undefined) {
    if (typeof regionId !== 'string' || regionId.trim().length === 0) {
      throw new Error('AgentTrade regionId must not be empty');
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(regionId)) {
      throw new Error('AgentTrade regionId must be lowercase kebab-case');
    }
  }

  return {
    side,
    commodityName,
    quantity,
    ...(regionId === undefined ? {} : { regionId }),
    ...(enterpriseId === undefined ? {} : { enterpriseId: enterpriseId.trim() }),
  };
}

export function assertAgentFoundEnterprisePayload(payload: unknown): AgentFoundEnterprisePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentFoundEnterprise payload must be an object');
  }
  const enterpriseId = payload['enterpriseId'];
  const name = payload['name'];
  const occupationName = payload['occupationName'];
  const initialCapital = payload['initialCapital'];
  const maxEmployees = payload['maxEmployees'];
  assertEnterpriseId(enterpriseId, 'AgentFoundEnterprise enterpriseId');
  assertBoundedNonEmptyString(name, 'AgentFoundEnterprise name', 160);
  assertBoundedNonEmptyString(occupationName, 'AgentFoundEnterprise occupationName', 128);
  assertNonNegativeFinite(initialCapital, 'AgentFoundEnterprise initialCapital');
  assertPositiveInteger(maxEmployees, 'AgentFoundEnterprise maxEmployees');
  return {
    enterpriseId: enterpriseId.trim(),
    name: name.trim(),
    occupationName: occupationName.trim(),
    initialCapital,
    maxEmployees,
  };
}

export function assertAgentJoinEnterprisePayload(payload: unknown): AgentJoinEnterprisePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentJoinEnterprise payload must be an object');
  }
  const enterpriseId = payload['enterpriseId'];
  assertEnterpriseId(enterpriseId, 'AgentJoinEnterprise enterpriseId');
  return { enterpriseId: enterpriseId.trim() };
}

export function assertAgentFundEnterprisePayload(payload: unknown): AgentFundEnterprisePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentFundEnterprise payload must be an object');
  }
  const enterpriseId = payload['enterpriseId'];
  const amount = payload['amount'];
  assertEnterpriseId(enterpriseId, 'AgentFundEnterprise enterpriseId');
  assertPositiveFinite(amount, 'AgentFundEnterprise amount');
  return { enterpriseId: enterpriseId.trim(), amount };
}

export function assertAgentCloseEnterprisePayload(payload: unknown): AgentCloseEnterprisePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentCloseEnterprise payload must be an object');
  }
  const enterpriseId = payload['enterpriseId'];
  assertEnterpriseId(enterpriseId, 'AgentCloseEnterprise enterpriseId');
  return { enterpriseId: enterpriseId.trim() };
}

export function assertAgentSetEnterpriseJobPostingPayload(
  payload: unknown,
): AgentSetEnterpriseJobPostingPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentSetEnterpriseJobPosting payload must be an object');
  }
  const enterpriseId = payload['enterpriseId'];
  const wageOffer = payload['wageOffer'];
  const openSlots = payload['openSlots'];
  assertEnterpriseId(enterpriseId, 'AgentSetEnterpriseJobPosting enterpriseId');
  assertPositiveFinite(wageOffer, 'AgentSetEnterpriseJobPosting wageOffer');
  assertNonNegativeInteger(openSlots, 'AgentSetEnterpriseJobPosting openSlots');
  return { enterpriseId: enterpriseId.trim(), wageOffer, openSlots };
}

export function assertAgentLeaveEnterprisePayload(payload: unknown): AgentLeaveEnterprisePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentLeaveEnterprise payload must be an object');
  }
  const enterpriseId = payload['enterpriseId'];
  assertEnterpriseId(enterpriseId, 'AgentLeaveEnterprise enterpriseId');
  return { enterpriseId: enterpriseId.trim() };
}

export function assertAgentLayoffEnterpriseEmployeePayload(
  payload: unknown,
): AgentLayoffEnterpriseEmployeePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentLayoffEnterpriseEmployee payload must be an object');
  }
  const enterpriseId = payload['enterpriseId'];
  const employeeAgentId = payload['employeeAgentId'];
  assertEnterpriseId(enterpriseId, 'AgentLayoffEnterpriseEmployee enterpriseId');
  assertBoundedNonEmptyString(
    employeeAgentId,
    'AgentLayoffEnterpriseEmployee employeeAgentId',
    128,
  );
  return {
    enterpriseId: enterpriseId.trim(),
    employeeAgentId: asAgentId(employeeAgentId.trim()),
  };
}

export function assertAgentGiveResourcePayload(payload: unknown): AgentGiveResourcePayload {
  if (!isRecord(payload)) {
    throw new Error('AgentGiveResource payload must be an object');
  }
  const targetAgentId = payload['targetAgentId'];
  const commodityName = payload['commodityName'];
  const quantity = payload['quantity'];
  const note = payload['note'];
  if (typeof targetAgentId !== 'string' || targetAgentId.trim().length === 0) {
    throw new Error('AgentGiveResource targetAgentId must not be empty');
  }
  if (typeof commodityName !== 'string' || commodityName.trim().length === 0) {
    throw new Error('AgentGiveResource commodityName must not be empty');
  }
  assertPositiveFinite(quantity, 'AgentGiveResource quantity');
  if (note !== undefined && (typeof note !== 'string' || note.trim().length === 0)) {
    throw new Error('AgentGiveResource note must not be empty');
  }
  return {
    targetAgentId: asAgentId(targetAgentId.trim()),
    commodityName: commodityName.trim(),
    quantity,
    ...(note === undefined ? {} : { note: note.trim() }),
  };
}

export function assertAgentApplyJobPayload(payload: unknown): AgentApplyJobPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentApplyJob payload must be an object');
  }
  const occupationName = payload['occupationName'];
  if (typeof occupationName !== 'string' || occupationName.trim().length === 0) {
    throw new Error('AgentApplyJob occupationName must not be empty');
  }

  return {
    occupationName,
  };
}

export function assertAgentApplyEducationExamPayload(
  payload: unknown,
): AgentApplyEducationExamPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentApplyEducationExam payload must be an object');
  }
  const targetLevel = payload['targetLevel'];
  if (typeof targetLevel !== 'number' || !Number.isInteger(targetLevel)) {
    throw new Error('AgentApplyEducationExam targetLevel must be an integer');
  }

  return { targetLevel };
}

export function assertAgentUpgradeResidentialTierPayload(
  payload: unknown,
): AgentUpgradeResidentialTierPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentUpgradeResidentialTier payload must be an object');
  }
  const targetResidentialTier = payload['targetResidentialTier'];
  assertPositiveInteger(targetResidentialTier, 'AgentUpgradeResidentialTier targetResidentialTier');

  return { targetResidentialTier };
}

export function assertAgentBuildHousingPayload(payload: unknown): AgentBuildHousingPayload {
  if (!isRecord(payload)) {
    throw new Error('AgentBuildHousing payload must be an object');
  }
  const locationId = payload['locationId'];
  if (typeof locationId !== 'string' || locationId.trim().length === 0) {
    throw new Error('AgentBuildHousing locationId must not be empty');
  }
  return { locationId: asLocationId(locationId.trim()) };
}

export function assertAdvanceSimulationTimePayload(payload: unknown): AdvanceSimulationTimePayload {
  if (!isRecord(payload)) {
    throw new Error('AdvanceSimulationTime payload must be an object');
  }
  const deltaMs = payload['deltaMs'];
  assertNonNegativeFinite(deltaMs, 'AdvanceSimulationTime deltaMs');

  return {
    deltaMs,
  };
}

function assertGovernancePayloadRecord(
  payload: unknown,
  commandType: 'SetTaxPolicy' | 'SetPublicBudget' | 'SetSubsidyPolicy',
): Readonly<Record<string, unknown>> {
  if (!isRecord(payload)) {
    throw new Error(`${commandType} payload must be an object`);
  }
  return payload;
}

function parseGovernanceMetadata(
  payload: Readonly<Record<string, unknown>>,
  commandType: 'SetTaxPolicy' | 'SetPublicBudget' | 'SetSubsidyPolicy',
): GovernanceCommandMetadataPayload {
  const reason = payload['reason'];
  const petitionId = payload['petitionId'];
  const expectedGovernanceRevision = payload['expectedGovernanceRevision'];
  assertBoundedNonEmptyString(reason, `${commandType} reason`, 500);
  if (petitionId !== undefined) {
    assertBoundedNonEmptyString(petitionId, `${commandType} petitionId`, 256);
  }
  if (expectedGovernanceRevision !== undefined) {
    assertNonNegativeInteger(
      expectedGovernanceRevision,
      `${commandType} expectedGovernanceRevision`,
    );
  }
  return {
    reason: reason.trim(),
    ...(petitionId === undefined ? {} : { petitionId: petitionId.trim() }),
    ...(expectedGovernanceRevision === undefined ? {} : { expectedGovernanceRevision }),
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPositiveFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertPositiveInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertNonNegativeFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertFinite(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertBoundedNonEmptyString(
  value: unknown,
  name: string,
  maximumLength: number,
): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  if (value.trim().length > maximumLength) {
    throw new Error(`${name} must not exceed ${maximumLength} characters`);
  }
}

function assertOptionalEnterpriseId(
  value: unknown,
  name: string,
): asserts value is string | undefined {
  if (value === undefined) {
    return;
  }
  assertEnterpriseId(value, name);
}

function assertEnterpriseId(value: unknown, name: string): asserts value is string {
  assertBoundedNonEmptyString(value, name, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new Error(`${name} contains unsupported characters`);
  }
}

function assertAgentStartConversationTurnPayload(
  payload: unknown,
  index: number,
): AgentStartConversationTurnPayload {
  if (!isRecord(payload)) {
    throw new Error(`AgentStartConversation turn ${index} must be an object`);
  }
  const speakerAgentId = payload['speakerAgentId'];
  const utterance = payload['utterance'];
  const intent = payload['intent'];
  if (typeof speakerAgentId !== 'string' || speakerAgentId.trim().length === 0) {
    throw new Error(`AgentStartConversation turn ${index} speakerAgentId must not be empty`);
  }
  if (typeof utterance !== 'string' || utterance.trim().length === 0) {
    throw new Error(`AgentStartConversation turn ${index} utterance must not be empty`);
  }
  if (intent !== undefined && (typeof intent !== 'string' || intent.trim().length === 0)) {
    throw new Error(`AgentStartConversation turn ${index} intent must not be empty`);
  }

  return {
    speakerAgentId: asAgentId(speakerAgentId.trim()),
    utterance: utterance.trim(),
    ...(intent === undefined ? {} : { intent: intent.trim() }),
  };
}

function assertAgentStartConversationTurnSignalsPayload(
  payload: unknown,
  index: number,
): AgentStartConversationTurnSignalsPayload {
  if (!isRecord(payload)) {
    throw new Error(`AgentStartConversation turnSignals[${index}] must be an object`);
  }
  const turnIndex = payload['turnIndex'];
  const signals = payload['signals'];
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new Error(
      `AgentStartConversation turnSignals[${index}].turnIndex must be a non-negative integer`,
    );
  }
  if (!Array.isArray(signals)) {
    throw new Error(`AgentStartConversation turnSignals[${index}].signals must be an array`);
  }

  return {
    turnIndex,
    signals: signals.map((signal, signalIndex) =>
      assertAgentStartConversationSignalSeverityPayload(signal, index, signalIndex),
    ),
  };
}

/**
 * Shape-level validation only: severity must be a finite number when present. The [0, 1] range is
 * enforced by the conversation handler, which conservatively ignores the whole turnSignals field
 * and falls back to keyword adjudication instead of rejecting the command.
 */
function assertAgentStartConversationSignalSeverityPayload(
  payload: unknown,
  index: number,
  signalIndex: number,
): AgentStartConversationSignalSeverityPayload {
  const label = `AgentStartConversation turnSignals[${index}].signals[${signalIndex}]`;
  if (!isRecord(payload)) {
    throw new Error(`${label} must be an object`);
  }
  const signal = payload['signal'];
  const severity = payload['severity'];
  if (typeof signal !== 'string' || signal.trim().length === 0) {
    throw new Error(`${label}.signal must not be empty`);
  }
  if (severity !== undefined && (typeof severity !== 'number' || !Number.isFinite(severity))) {
    throw new Error(`${label}.severity must be a finite number`);
  }

  return {
    signal: signal.trim(),
    ...(severity === undefined ? {} : { severity }),
  };
}
