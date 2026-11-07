import {
  enterpriseController,
  enterpriseControlVersion,
  activeEnterpriseLaborTerms,
} from '@aivilization/enterprise';
import {
  residentLaborTermsEvent,
  parseEnterpriseLaborCommand,
  AGREED_LABOR_SOURCE,
} from '@aivilization/world';
import { controllerVisibleTo } from './resourceControlAccess';
import { principalCollectiveAuthority } from './principalCollectiveAuthority';
import { stringArg, pageItems, ToolRefusal } from './arguments';
import { worldExperiences } from './worldTools';
import { digest } from './journal';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
export function executeLaborTermsTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  if (s.world.residentLabor?.configuration.compensationSource !== AGREED_LABOR_SOURCE)
    throw new ToolRefusal('agreed-labor-not-enabled');
  const enterpriseId = stringArg(args, 'enterpriseId'),
    e = s.world.enterprises[enterpriseId];
  if (!e) throw new ToolRefusal('enterprise-not-found');
  if (name === 'business.labor-terms') {
    const manager = controllerVisibleTo(s, enterpriseController(e), actorId);
    const records = Object.values(e.laborTerms?.offers ?? {})
      .filter((o) => manager || o.employeeId === actorId)
      .sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const id = args.id === undefined ? undefined : stringArg(args, 'id');
    if (id && !records.some((o) => o.id === id)) throw new ToolRefusal('labor-offer-not-found');
    return {
      data: {
        enterpriseId,
        revision: e.laborTerms?.revision ?? 1,
        controlVersion: enterpriseControlVersion(e),
        ownCurrent: activeEnterpriseLaborTerms(e, actorId, s.world.clock.now) ?? null,
        ...(id ? { offer: records.find((o) => o.id === id) } : pageItems(records, args)),
        requestResourceKind: 'enterprise-labor-terms',
        operationCapability: 'business.change-labor-terms',
        operationArguments: '{command:{type,id,...exact offer or response fields}}',
        changeWith: 'town business change-labor-terms',
        collectiveWith: 'town principals operate',
        note: 'Acceptance is prospective pay consent only. No attendance, earned money or membership is created.',
      },
      effects: {},
    };
  }
  const { operation } = args;
  const rest = Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== 'enterpriseId' && key !== 'operation'),
  );
  // The command decoder rejects surplus fields and requires the exact operation shape.
  const command = parseEnterpriseLaborCommand({ type: operation, ...rest });
  const d = residentLaborTermsEvent({
    projection: s.world,
    actorId,
    enterpriseId,
    command,
    simulationId: m.simulationId,
    requestId: `labor-terms-${digest([actorId, requestId]).slice(0, 32)}`,
    nextSequence: s.worldSequence + 1,
    collective: principalCollectiveAuthority(s),
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: {
      enterpriseId,
      id: command.id,
      operation: command.type,
      readWith: `town business labor-terms --enterprise-id ${enterpriseId} --id ${command.id}`,
    },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events) },
  };
}
