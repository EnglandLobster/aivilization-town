import { enterpriseController } from '@aivilization/enterprise';
import type { ControlAuthorizationPort } from '@aivilization/authority';
import { controllerVisibleTo } from './resourceControlAccess';
import { serviceBusinessAuthorizationEvent, serviceBusinessRoles } from '@aivilization/world';
import type { ServiceWageBasis } from '@aivilization/enterprise';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { stringArg, numberArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';

export function executeServiceBusinessTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
  authorize?: ControlAuthorizationPort,
): ToolExecution {
  if (!s.world.serviceEmployment) throw new ToolRefusal('service-employment-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'business.services') {
    const filter = args.enterpriseId === undefined ? undefined : stringArg(args, 'enterpriseId');
    return result(
      pageItems(
        Object.values(s.world.enterprises)
          .filter((e) => !filter || e.enterpriseId === filter)
          .flatMap((e) =>
            Object.values(e.serviceBusiness?.contracts ?? {})
              .filter(
                (c) =>
                  controllerVisibleTo(s, enterpriseController(e), actorId) ||
                  c.authorization.providerId === actorId,
              )
              .map((c) => ({
                enterpriseId: e.enterpriseId,
                serviceId: c.authorization.serviceId,
                revision: c.revision,
                phase: c.phase,
                wageBasis: c.authorization.wageBasis,
                readWith: `town business service --enterprise-id ${e.enterpriseId} --service-id ${c.authorization.serviceId}`,
              })),
          ),
        args,
      ),
    );
  }
  const enterpriseId = stringArg(args, 'enterpriseId'),
    serviceId = stringArg(args, 'serviceId'),
    enterprise = s.world.enterprises[enterpriseId],
    service = s.world.serviceEngagements?.engagements[serviceId],
    contract = enterprise?.serviceBusiness?.contracts[serviceId];
  if (name === 'business.service') {
    if (
      !enterprise ||
      !service ||
      (!controllerVisibleTo(s, enterpriseController(enterprise), actorId) &&
        contract?.authorization.providerId !== actorId)
    )
      throw new ToolRefusal('service-business-record-not-found');
    const roles = serviceBusinessRoles(service, enterpriseId);
    if (!contract && !roles.payer && !roles.revenueRecipient)
      throw new ToolRefusal('service-business-record-not-found');
    return result({
      enterpriseId,
      serviceId,
      serviceRevision: service.revision,
      serviceStatus: service.status,
      roles,
      contract: contract ?? null,
      note: 'Financial permission is separate from participants consent. Escrow prepayment is not an expense; service share and wages are distinct.',
    });
  }
  const operation =
    name === 'business.authorize-service'
      ? 'authorize'
      : name === 'business.revoke-service'
        ? 'revoke'
        : undefined;
  if (!operation) throw new ToolRefusal('unknown-service-business-operation');
  const wageBasis = operation === 'authorize' ? stringArg(args, 'wageBasis') : undefined;
  if (wageBasis && !['none', 'attendance', 'effective-service'].includes(wageBasis))
    throw new ToolRefusal('invalid-service-wage-basis');
  const d = serviceBusinessAuthorizationEvent({
    projection: s.world,
    actorId,
    enterpriseId,
    serviceId,
    expectedServiceRevision: numberArg(args, 'expectedServiceRevision'),
    operation,
    ...(authorize ? { authorize } : {}),
    ...(wageBasis ? { wageBasis: wageBasis as ServiceWageBasis } : {}),
    ...(operation === 'revoke'
      ? { expectedAuthorizationRevision: numberArg(args, 'expectedAuthorizationRevision') }
      : {}),
    simulationId: m.simulationId,
    requestId: `service-business-${digest([actorId, requestId]).slice(0, 32)}`,
    nextSequence: s.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: {
      committed: true,
      enterpriseId,
      serviceId,
      operation,
      readWith: `town business service --enterprise-id ${enterpriseId} --service-id ${serviceId}`,
    },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events, actorId) },
  };
}
