import type { CollectiveResourceAction } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import { parseFreightCustodyCommand } from './freightCustodyCommands';
import { executeFreightCustodyTool } from './freightCustodyTools';
import { ToolRefusal } from './arguments';
function argumentsFor(s: OpenSocietyState, collectiveId: string, action: CollectiveResourceAction) {
  if (
    !s.world.logistics?.custody?.collectiveGrantsVersion ||
    action.capability !== 'freight.handoff' ||
    Object.hasOwn(action.arguments, 'id')
  )
    throw new ToolRefusal('collective-freight-custody-not-enabled');
  const args = { ...action.arguments, id: action.resourceId },
    command = parseFreightCustodyCommand(args);
  const f = s.world.logistics.freight[action.resourceId],
    p = s.world.logistics.custody.proposals[command.id];
  const principals =
    command.type === 'propose'
      ? [f?.controller]
      : command.type === 'consent'
        ? [p?.principals[command.role]]
        : command.type === 'withdraw'
          ? Object.values(p?.principals ?? {})
          : [];
  if (!f || !principals.some((c) => c?.kind === 'collective' && c.id === collectiveId))
    throw new ToolRefusal('custody-collective-principal-required');
  return args;
}
export function validateCollectiveFreightCustody(
  s: OpenSocietyState,
  id: string,
  action: CollectiveResourceAction,
) {
  try {
    argumentsFor(s, id, action);
    return undefined;
  } catch (e) {
    return e instanceof ToolRefusal ? e.reason : 'invalid-collective-freight-custody-action';
  }
}
export function executeCollectiveFreightCustody(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  collectiveId: string,
  decisionId: string,
  action: CollectiveResourceAction,
  requestId: string,
) {
  return executeFreightCustodyTool(
    s,
    m,
    actorId,
    action.capability,
    argumentsFor(s, collectiveId, action),
    requestId,
    false,
    { collectiveId, decisionId },
  );
}
