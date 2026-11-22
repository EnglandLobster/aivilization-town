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

export * from './residentCommonAccounts';

export * from './residentMaterials';

export * from './residentPremises';
export * from './premisesAccess';
export * from './residentFacilityUse';

export * from './residentPublicGovernance';

export {
  enableResidentExtractionEvent,
  assertResidentExtractionCompatibility,
} from './residentExtraction';
export * from './productiveEmployment';
export * from './productiveEmploymentModel';
export { productionEmployer } from './productiveCompensation';
export * from './educationAuthority';

export * from './productiveWages';

export * from './publicLabor';
export * from './publicLaborModel';

export * from './enterpriseControl';
export { enablePublicEmploymentEvent, publicEmploymentWorldPolicies } from './publicEmployment';

export * from './resourcePrincipals';
export * from './materialCommandCodec';
export * from './principalCollectivePort';

export * from './premisesPrincipals';
export * from './premisesPrincipalCommandCodec';

export { hasEnterprisePrincipalAssets } from './principalResourceObligations';

export * from './residentExitPreservation';

export * from './residentExitCapture';

export * from './residentEstateCredit';
export * from './residentSuccession';

export * from './residentAdmission';

export * from './laborCompensationSource';

export * from './residentEmploymentDeparture';
