import {
  controlVersion,
  effectiveController,
  personalControlAuthorization,
} from '@aivilization/authority';
import { decideServiceControl, type Service } from '@aivilization/services';
import { controllerAvailable, principalVisibleTo } from './resourceControlAccess';
import { parseResourceControlArguments } from './resourceControlArguments';
import { ToolRefusal, stringArg } from './arguments';
import { applyOpenSocietyEffects } from './state';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';

export const serviceControlMetadata = (service: Service) => ({
  kind: 'service' as const,
  id: service.id,
  title: service.title,
  revision: service.revision,
  active: service.active,
  authoredBy: service.ownerId,
  controller: effectiveController(service),
  controlVersion: controlVersion(service),
  ...(service.control?.offer ? { offer: service.control.offer } : {}),
});
const visible = (state: OpenSocietyState, service: Service, actorId: string) =>
  principalVisibleTo(state, effectiveController(service), actorId) ||
  (!!service.control?.offer && principalVisibleTo(state, service.control.offer.target, actorId));
export function visibleServiceResources(state: OpenSocietyState, actorId: string) {
  return state.services?.controlPolicy
    ? Object.values(state.services.services)
        .filter((s) => visible(state, s, actorId))
        .map(serviceControlMetadata)
    : [];
}
export function executeServiceControlTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): ToolExecution {
  if (!state.services?.controlPolicy) throw new ToolRefusal('service-control-not-enabled');
  const id = stringArg(args, 'id'),
    service = state.services.services[id];
  if (!service || !visible(state, service, actorId))
    throw new ToolRefusal('service-resource-not-found');
  if (name === 'resources.read') return { data: serviceControlMetadata(service), effects: {} };
  const { id: _id, kind: _kind, ...parameters } = args;
  void _id;
  void _kind;
  const action = parseResourceControlArguments(name, parameters);
  if (!action) throw new ToolRefusal('invalid-service-control-action');
  const decision = decideServiceControl({
    state: state.services,
    serviceId: id,
    actorId,
    at: state.world.clock.now,
    command: action.control,
    expectedRevision: action.expectedRevision,
    authorize: personalControlAuthorization(actorId),
    available: (c) => controllerAvailable(state, c),
  });
  if (!decision.accepted) throw new ToolRefusal(decision.reason);
  const effects = { servicesEvents: decision.events };
  const after = applyOpenSocietyEffects(state, effects);
  return { data: serviceControlMetadata(after.services!.services[id]!), effects };
}
