import {
  validatePrincipalResourceAction,
  executeApprovedPrincipalResource,
} from './resourcePrincipalTools';
import {
  validateEnterpriseControlResource,
  executeApprovedEnterpriseControl,
} from './enterpriseControlTools';
import {
  validateEnterpriseManagementResource,
  executeApprovedEnterpriseManagement,
} from './enterpriseManagementTools';
import type { ToolExecution } from './informationTools';
import { validatePremisesResourceAction, executeApprovedPremisesResource } from './premisesTools';
import { validateMaterialResourceAction, executeApprovedMaterialResource } from './materialTools';
import {
  authorizeCollectiveResourceExecution,
  type CollectiveResourceAction,
} from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import {
  executeApprovedCommonAccount,
  validateCommonAccountResourceAction,
} from './commonAccountTools';
import {
  executeApprovedInformationResource,
  validateInformationResourceAction,
} from './resourceControlTools';
import { ToolRefusal } from './arguments';
/** Domain adapters own their schemas and effects; this registry only routes one exact approved action. */
type Adapter = {
  matches: (a: CollectiveResourceAction) => boolean;
  validate: (
    s: OpenSocietyState,
    m: OpenSocietyManifest,
    c: string,
    a: CollectiveResourceAction,
  ) => string | undefined;
  execute: (
    s: OpenSocietyState,
    m: OpenSocietyManifest,
    actor: string,
    c: string,
    d: string,
    a: CollectiveResourceAction,
    r: string,
  ) => ToolExecution;
};
const adapters: readonly Adapter[] = [
  {
    matches: (a) => a.capability.startsWith('principals.'),
    validate: (s, _m, c, a) => validatePrincipalResourceAction(s, c, a),
    execute: executeApprovedPrincipalResource,
  },
  {
    matches: (a) => a.capability.startsWith('resources.') && a.arguments.kind === 'enterprise',
    validate: (s, _m, c, a) => validateEnterpriseControlResource(s, c, a),
    execute: (s, m, actor, c, d, a, r) => executeApprovedEnterpriseControl(s, m, actor, c, d, a, r),
  },
  {
    matches: (a) => a.capability.startsWith('business.') || a.capability.startsWith('market.'),
    validate: (s, _m, c, a) => validateEnterpriseManagementResource(s, c, a),
    execute: (s, m, actor, c, d, a, r) =>
      executeApprovedEnterpriseManagement(s, m, actor, c, d, a, r),
  },
  {
    matches: (a) =>
      ['construction.', 'premises.', 'materials.'].some((p) => a.capability.startsWith(p)),
    validate: (s, _m, c, a) => validatePremisesResourceAction(s, c, a),
    execute: (s, m, actor, c, d, a, r) => executeApprovedPremisesResource(s, m, actor, c, d, a, r),
  },
  {
    matches: (a) => a.capability.startsWith('stocks.') || a.capability.startsWith('production.'),
    validate: (s, _m, c, a) => validateMaterialResourceAction(s, c, a),
    execute: (s, m, actor, c, d, a, r) => executeApprovedMaterialResource(s, m, actor, c, d, a, r),
  },
  {
    matches: (a) => a.capability.startsWith('resources.'),
    validate: (s, m, c, a) => validateInformationResourceAction(s, m, c, a),
    execute: (s, m, actor, c, d, a) => executeApprovedInformationResource(s, m, actor, c, d, a),
  },
  {
    matches: () => true,
    validate: (s, _m, c, a) => validateCommonAccountResourceAction(s, c, a),
    execute: (s, m, actor, c, d, a, r) => executeApprovedCommonAccount(s, m, actor, c, d, a, r),
  },
];
const adapter = (a: CollectiveResourceAction) => adapters.find((v) => v.matches(a))!;
export function validateCollectiveResourceAction(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  collectiveId: string,
  action: CollectiveResourceAction,
) {
  return adapter(action).validate(state, manifest, collectiveId, action);
}
/** Effects and exact decision consumption are returned together for one atomic journal transaction. */
export function executeCollectiveResource(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  actorId: string,
  id: string,
  expectedRevision: number,
  requestId: string,
) {
  if (!state.collectives) throw new ToolRefusal('collectives-not-enabled');
  const proof = authorizeCollectiveResourceExecution({
    state: state.collectives,
    actorId,
    id,
    expectedRevision,
    at: state.world.clock.now,
  });
  if (!proof.accepted) throw new ToolRefusal(proof.reason);
  const result = adapter(proof.action).execute(
    state,
    manifest,
    actorId,
    proof.collectiveId,
    id,
    proof.action,
    requestId,
  );
  return { ...result, effects: { ...result.effects, collectiveEvents: [proof.event] } };
}
