import {
  decideResourceControl,
  assertResourceControlTransition,
  personallyControls,
  effectiveController,
  type ControlAuthorizationPort,
  type Controller,
  type ControlCommand,
} from '@aivilization/authority';
import { assertServiceControlPolicy, type ServiceControlEvent } from './serviceControlModel';
import type { ServicesState, Service } from './model';

export const personallyAdministersService = (
  service: Service | undefined,
  actorId: string,
): boolean => !!service && personallyControls(service, actorId);

export function personalServiceAdministrator(service: Service): string | undefined {
  const controller = effectiveController(service);
  return controller.kind === 'resident' ? controller.id : undefined;
}

/** Directory administration does not transfer a provider's body, a booking or another aggregate's payment obligation. */
export function decideServiceControl(input: {
  state: ServicesState;
  serviceId: string;
  actorId: string;
  at: number;
  expectedRevision: number;
  command: ControlCommand;
  authorize: ControlAuthorizationPort;
  available: (c: Controller) => boolean;
}) {
  const { state, serviceId, actorId, at, expectedRevision, command } = input;
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!state.controlPolicy) return no('service-control-not-enabled');
  assertServiceControlPolicy(state.controlPolicy);
  const service = Object.hasOwn(state.services, serviceId) ? state.services[serviceId] : undefined;
  if (!service) return no('service-not-found');
  if (service.control?.policyVersion === 'resource-principals-v2')
    return no('service-principal-control-required');
  if (service.revision !== expectedRevision) return no('revision-conflict');
  if (!Number.isSafeInteger(service.revision) || service.revision >= Number.MAX_SAFE_INTEGER)
    return no('service-revision-limit');
  if (!service.active && command.type !== 'cancel') return no('service-inactive');
  // Enterprise affiliation is a separate authority. Its transfer requires the enterprise integration, never an implicit personal override.
  if (service.enterpriseId !== undefined)
    return no('enterprise-service-control-integration-required');
  const decision = decideResourceControl({
    resource: {
      ownerId: service.ownerId,
      ...(service.control ? { control: service.control } : {}),
    },
    actorId,
    at,
    command,
    policy: state.controlPolicy.control,
    authorize: input.authorize,
    available: input.available,
  });
  if (!decision.accepted) return decision;
  const events: readonly ServiceControlEvent[] = [
    {
      type: 'ServiceControlChanged',
      serviceId,
      expectedRevision,
      operation: command.type,
      control: decision.control,
    },
  ];
  return { accepted: true as const, events };
}

export function applyServiceControlEvent(
  state: ServicesState,
  event: ServiceControlEvent,
): ServicesState {
  if (event.type === 'ServiceControlEnabled') {
    if (state.controlPolicy) throw Error('service-control-already-enabled');
    if (state.policy.version !== 'resident-services-v3')
      throw Error('service-control-requires-recorded-providers');
    assertServiceControlPolicy(event.policy);
    return { ...state, controlPolicy: event.policy };
  }
  const service = state.services[event.serviceId];
  if (
    !state.controlPolicy ||
    !service ||
    service.enterpriseId !== undefined ||
    service.control?.policyVersion === 'resource-principals-v2' ||
    event.expectedRevision !== service.revision ||
    !Number.isSafeInteger(event.expectedRevision) ||
    event.expectedRevision >= Number.MAX_SAFE_INTEGER ||
    (!service.active && event.operation !== 'cancel')
  )
    throw Error('invalid-service-control-event');
  assertResourceControlTransition(
    service,
    event.control,
    event.operation,
    state.controlPolicy.control,
  );
  return {
    ...state,
    services: {
      ...state.services,
      [service.id]: {
        ...service,
        control: event.control,
        revision: service.revision + 1,
      },
    },
  };
}
