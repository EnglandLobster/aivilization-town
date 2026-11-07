export * from './physicalHousingRest';
export * from './housingOccupancy';
export * from './publicHousing';
export * from './housingChoice';
export * from './agentActions';
export * from './bulletin';
export * from './commands';
export * from './conflict';
export * from './credit';
export * from './events';
export * from './enterprise';
export * from './economicPolicies';
export * from './matters';
export * from './projection';
export * from './regionalMarkets';
export * from './renewableResources';
export * from './serviceQuality';
export * from './spatial';
export * from './townPulse';
export * from './weather';

export type WorldModuleStatus = {
  readonly packageName: '@aivilization/world';
  readonly owns: 'server-authoritative-command-event-projection';
};

export * from './residentCommerce';
export * from './residentParticipation';
export * from './residentRestTime';
export * from './residentRest';
export * from './residentStudy';
export * from './residentStudyModel';
export * from './residentLabor';
export * from './residentLaborModel';
export * from './residentLeases';

export * from './residentMobility';
export * from './residentCommonAccounts';

export * from './residentMaterials';

export * from './residentPremises';
export * from './premisesAccess';
export * from './residentFacilityUse';

export * from './residentServiceEngagements';
export * from './serviceEngagementPorts';
export * from './residentLogistics';
export * from './logisticsPorts';
export * from './residentEvidenceTrade';
export * from './evidenceTradePorts';
export * from './residentPremisesRights';
export * from './residentPremisesProvision';
export * from './premisesRightsPorts';
export * from './residentPublicGovernance';
export { enableResidentPublicProcurementEvent } from './publicServiceProcurement';
export { enableResidentPublicGoodsProcurementEvent } from './publicGoodsProcurement';

export {
  enableResidentExtractionEvent,
  assertResidentExtractionCompatibility,
} from './residentExtraction';
export * from './productiveEmployment';
export * from './productiveEmploymentModel';
export { productionEmployer } from './productiveCompensation';
export * from './educationAuthority';
export * from './serviceTime';

export * from './serviceEmploymentModel';
export * from './serviceBusinessAuthorization';

export * from './serviceWages';
export * from './productiveWages';

export { serviceEmployer } from './serviceCompensation';

export * from './publicLabor';
export * from './publicLaborModel';

export * from './enterpriseControl';
export { enablePublicEmploymentEvent, publicEmploymentWorldPolicies } from './publicEmployment';

export * from './capital';
export * from './capitalAccounting';
export type * from './capitalModel';
export * from './resourcePrincipals';
export * from './materialCommandCodec';
export * from './principalCollectivePort';

export * from './premisesPrincipals';
export * from './premisesPrincipalCommandCodec';

export * from './principalPremisesRights';
export * from './principalPermitCommandCodec';

export {
  hasPrincipalPermitObligations,
  hasEnterprisePrincipalAssets,
} from './principalResourceObligations';

export * from './principalEvidenceTrade';
export * from './principalTradePorts';
export * from './principalTradeCommandCodec';

export * from './vehiclePrincipals';

export * from './servicePrincipals';
export * from './servicePrincipalEstate';
export * from './serviceSupply';

export * from './serviceAffiliation';

export * from './serviceSupplyRelations';

export * from './resourceSales';
export * from './resourceSalePorts';
export * from './resourceSaleEnterpriseAccounting';
export * from './periodicObligations';
export * from './residentExitPreservation';
export * from './periodicObligationPorts';
export * from './periodicEnterpriseAccounting';

export * from './residentExitCapture';

export * from './residentEstateCredit';
export * from './residentSuccession';

export * from './residentAdmission';

export { CAPITAL_ESTATE_CONTINUITY_POLICY } from './capitalEstateContinuity';
export * from './constructionTradePorts';

export * from './residentConstructionTrade';

export * from './constructionTradeCommandCodec';

export * from './residentLaborTerms';
export * from './laborCompensationSource';

export * from './serviceFacilityRegistration';

export * from './resourceAdapters';

export * from './periodicAccess';

export * from './serviceClosurePolicy';

export * from './residentEmploymentDeparture';

export * from './residentFreightCustody';

export * from './freightCustodyAuthority';
