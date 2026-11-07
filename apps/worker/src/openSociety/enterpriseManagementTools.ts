import { enterpriseController, enterpriseControlVersion } from '@aivilization/enterprise';
import { sameController } from '@aivilization/authority';
import { validateOpenToolArguments } from '@aivilization/agent-runtime';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import { OPEN_WORLD_TOOLS } from './catalog';
import { executeOpenWorldTool } from './worldTools';
import { openWorldPolicies } from './manifest';
import { ToolRefusal } from './arguments';
const operations: Readonly<Record<string, string>> = {
  'business.post-job': 'world.post_job',
  'business.layoff': 'world.layoff_employee',
  'business.close': 'world.close_enterprise',
  'market.trade': 'world.trade',
  'market.export': 'world.export',
  'market.import': 'world.import',
};
function parameters(action: CollectiveResourceAction) {
  const name = operations[action.capability],
    { expectedControlVersion, ...rest } = action.arguments;
  if (!name || !Number.isSafeInteger(expectedControlVersion) || Number(expectedControlVersion) < 1)
    return undefined;
  // The approved resource fixes the company. No second company or actor can be smuggled into the payload.
  if (Object.hasOwn(rest, 'enterpriseId') || Object.hasOwn(rest, 'asEnterpriseId'))
    return undefined;
  const args = {
    ...rest,
    ...(['world.export', 'world.import'].includes(name)
      ? { asEnterpriseId: action.resourceId }
      : { enterpriseId: action.resourceId }),
  };
  const definition = OPEN_WORLD_TOOLS.find((t) => t.name === name);
  if (!definition || validateOpenToolArguments(definition, args)) return undefined;
  return { name, args, expectedControlVersion: Number(expectedControlVersion) };
}
export function validateEnterpriseManagementResource(
  s: OpenSocietyState,
  collectiveId: string,
  action: CollectiveResourceAction,
): string | undefined {
  const p = parameters(action),
    e = s.world.enterprises[action.resourceId];
  if (!p || !e || !e.control) return 'unsupported-or-invalid-enterprise-management-action';
  if (!sameController(enterpriseController(e), { kind: 'collective', id: collectiveId }))
    return 'collective-does-not-control-enterprise';
  if (enterpriseControlVersion(e) !== p.expectedControlVersion)
    return 'enterprise-control-revision-conflict';
  return undefined;
}
export function executeApprovedEnterpriseManagement(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actor: string,
  collectiveId: string,
  decisionId: string,
  action: CollectiveResourceAction,
  requestId: string,
) {
  const error = validateEnterpriseManagementResource(s, collectiveId, action);
  if (error) throw new ToolRefusal(error);
  const p = parameters(action)!,
    authorize = (c: ReturnType<typeof enterpriseController>) =>
      sameController(c, { kind: 'collective', id: collectiveId })
        ? { actorId: actor, decisionId }
        : undefined;
  const result = executeOpenWorldTool({
    state: s,
    manifest: m,
    policies: openWorldPolicies(m.seed, s.world, m.rhythm, m.canonicalPolicyContinuation),
    actorId: actor,
    name: p.name,
    args: p.args,
    requestId,
    enterpriseAuthorization: authorize,
  });
  if (result.error) throw new ToolRefusal(result.error);
  return result;
}
