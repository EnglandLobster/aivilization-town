import { assertResourcePrincipalPolicy } from '@aivilization/authority';
import {
  PUBLIC_GOVERNANCE_POLICY,
  assertPublicGrant,
  assertPublicProcedure,
  publicEqual,
} from '@aivilization/governance';
import { MATERIAL_EXTRACTION_POLICY } from '@aivilization/materials';
import { assertPremisesRightsPolicy } from '@aivilization/premises';
import {
  assertHousingChoiceState,
  assertHousingOccupancyState,
  assertPhysicalHousingRestPolicy,
  assertPublicEmploymentState,
  assertPublicHousingState,
  assertResidentRestPolicy,
  assertValidTownGovernancePolicy,
} from '@aivilization/society';
import {
  assertEducationAuthorityState,
  assertResidentExtractionCompatibility,
  assertResidentLaborConfiguration,
  assertResidentRestTimeCompatibility,
  assertResidentStudyConfiguration,
  type WorldCommandPolicies,
  type WorldProjection,
} from '@aivilization/world';
import type { OpenSocietyManifest } from './types';

/**
 * Checks a town's world before any resident acts: every enabled mechanism carries a policy this
 * code supports, and public authority grants match the mechanisms they govern. Fails closed.
 */
export function assertTownConsistency(
  world: WorldProjection,
  manifest: OpenSocietyManifest,
  policies: WorldCommandPolicies,
): void {
  if (world.materials?.extraction) {
    assertResidentExtractionCompatibility(world, policies);
    if (!publicEqual(world.materials.extraction.policy, MATERIAL_EXTRACTION_POLICY))
      throw Error('unsupported-material-extraction-policy');
  }
  const grant = world.publicGovernance?.authority.grant;
  if (!!world.publicEmployment !== !!grant?.employment)
    throw Error('inconsistent-public-employment-state');
  if (world.publicEmployment) assertPublicEmploymentState(world.publicEmployment);
  if (!!world.publicHousing !== !!grant?.housing) throw Error('inconsistent-public-housing-state');
  if (world.publicHousing) {
    if (!world.housingChoice) throw Error('public-housing-requires-housing-choice');
    assertPublicHousingState(world.publicHousing);
  }
  if (!!world.materials?.resourcePrincipals !== !!grant?.resourceCustody)
    throw Error('inconsistent-resource-principals-state');
  if (!!world.premises?.resourcePrincipals !== !!grant?.construction)
    throw Error('inconsistent-premises-principals-state');
  if (world.premises?.resourcePrincipals && !world.materials?.resourcePrincipals)
    throw Error('premises-principals-require-material-principals');
  if (world.materials?.resourcePrincipals)
    assertResourcePrincipalPolicy(world.materials.resourcePrincipals);
  if (world.physicalHousingRest) assertPhysicalHousingRestPolicy(world.physicalHousingRest);
  if (world.housingOccupancy) assertHousingOccupancyState(world.housingOccupancy);
  if (world.housingChoice) assertHousingChoiceState(world.housingChoice);
  const publicGov = world.publicGovernance;
  if (publicGov) {
    if (!publicEqual(publicGov.authority.policy, PUBLIC_GOVERNANCE_POLICY))
      throw Error('unsupported-public-governance-policy');
    assertPublicGrant(publicGov.authority.grant);
    assertPublicProcedure(publicGov.authority.procedure, publicGov.authority.grant);
    assertValidTownGovernancePolicy(publicGov.institutionPolicy);
  }
  assertEducationAuthorityState(world);
  if (world.residentRest) {
    assertResidentRestPolicy(world.residentRest.policy);
    assertResidentRestTimeCompatibility(policies);
  }
  if (world.residentStudy)
    assertResidentStudyConfiguration(world, world.residentStudy.configuration);
  if (world.residentLabor)
    assertResidentLaborConfiguration(world, world.residentLabor.configuration);
  if (manifest.initialWorld.premisesRights)
    assertPremisesRightsPolicy(manifest.initialWorld.premisesRights.policy);
}
