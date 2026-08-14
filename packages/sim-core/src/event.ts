import {
  asCommandId,
  asEventId,
  asSimulationId,
  type CommandId,
  type EventId,
  type SimulationId,
} from './ids';
import type { PartitionKey } from './partition';
import type { SimulationTimestamp } from './time';

export type CoreEventType =
  | 'AgentRegistered'
  | 'AgentRegistrationRejected'
  | 'CommodityProduced'
  | 'TradeExecuted'
  | 'ResourceTransferred'
  | 'CommodityConsumed'
  | 'DurableGoodExpired'
  | 'InventoryChanged'
  | 'PhysiologyChanged'
  | 'PhysiologicalDistressChanged'
  | 'SafetyNetGranted'
  | 'EducationInvestmentPaid'
  | 'EducationChanged'
  | 'EducationLevelChanged'
  | 'EducationCompulsoryFeeCovered'
  | 'EducationExamApplicationSubmitted'
  | 'EducationExamResolved'
  | 'EducationExamCycleCompleted'
  | 'AgentActivityTimeCommitted'
  | 'JobApplicationSubmitted'
  | 'JobApplicationResolved'
  | 'JobAssigned'
  | 'RecruitmentCycleCompleted'
  | 'ResidentialTierUpgraded'
  | 'ResidentialTierDowngraded'
  | 'ResidentialUpkeepCharged'
  | 'ResidentialUpkeepArrearsUpdated'
  | 'RegionalLandValueUpdated'
  | 'AgentTimeEffectsSettled'
  | 'MedicalTreatmentCharged'
  | 'WagePaid'
  | 'EnterpriseFounded'
  | 'EnterpriseMemberJoined'
  | 'EnterpriseFunded'
  | 'EnterpriseInsolvencyStarted'
  | 'EnterpriseSolvencyRestored'
  | 'EnterpriseBankruptcyDeclared'
  | 'EnterpriseDividendPaid'
  | 'EnterpriseClosed'
  | 'EnterpriseJobPostingUpdated'
  | 'EnterpriseEmployeeLeft'
  | 'EnterpriseEmployeeLaidOff'
  | 'EnterpriseWageArrearsUpdated'
  | 'IncomeTaxCharged'
  | 'TradeTaxCharged'
  | 'DividendTaxCharged'
  | 'SubsidyPaid'
  | 'PublicBudgetSpent'
  | 'DepositMade'
  | 'WithdrawalMade'
  | 'LoanIssued'
  | 'LoanRepaid'
  | 'LoanDefaulted'
  | 'DepositInterestPaid'
  | 'MarketPriceIndexRecorded'
  | 'EconomicCompositionRecorded'
  | 'ExternalMarketRebalanced'
  | 'ExternalTradeExecuted'
  | 'ExternalTradeBalancesDecayed'
  | 'SocialInteractionCompleted'
  | 'AgentTravelStarted'
  | 'AgentLocationChanged'
  | 'LocationObserved'
  | 'ConversationRecorded'
  | 'ShortTermMemoryRecorded'
  | 'LongTermMemoryConsolidated'
  | 'PlannerBranchUpdated'
  | 'ActionRejected'
  | 'ActionRepaired'
  | 'SimulationTimeAdvanced'
  | 'WeatherChanged'
  | 'BulletinScheduled'
  | 'BulletinPosted'
  | 'MatterRaised'
  | 'MatterResponded'
  | 'MatterAssigned'
  | 'MatterProgressed'
  | 'MatterClosed'
  | 'ConfrontationRecorded'
  | 'AttackRecorded'
  | 'InterventionRecorded'
  | 'AgentOwnershipDeparted'
  | 'AgentOwnershipArrived';

export type EventEnvelope<TType extends string = CoreEventType, TPayload = unknown> = {
  readonly id: EventId;
  readonly simulationId: SimulationId;
  readonly partitionKey?: PartitionKey;
  readonly commandId?: CommandId;
  readonly type: TType;
  readonly payload: TPayload;
  readonly occurredAt: SimulationTimestamp;
  readonly sequence: number;
};

export function createEventEnvelope<TType extends string, TPayload>(input: {
  readonly id: string;
  readonly simulationId: string;
  readonly partitionKey?: PartitionKey;
  readonly commandId?: string;
  readonly type: TType;
  readonly payload: TPayload;
  readonly occurredAt: SimulationTimestamp;
  readonly sequence: number;
}): EventEnvelope<TType, TPayload> {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error(`event sequence must be a positive integer, received ${input.sequence}`);
  }

  const base = {
    id: asEventId(input.id),
    simulationId: asSimulationId(input.simulationId),
    type: input.type,
    payload: input.payload,
    occurredAt: input.occurredAt,
    sequence: input.sequence,
  };

  const withCommand =
    input.commandId === undefined ? base : { ...base, commandId: asCommandId(input.commandId) };
  return input.partitionKey === undefined
    ? withCommand
    : { ...withCommand, partitionKey: input.partitionKey };
}
