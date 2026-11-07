import type { ConstructionProject } from '@aivilization/premises';
import { enterpriseController } from '@aivilization/enterprise';
import type { Controller, ResourcePrincipal } from '@aivilization/authority';
import { collectiveOperable } from '@aivilization/collaboration';
import type { OpenSocietyState } from './types';
/** Application bridge; control primitives know neither the resident registry nor collective membership. */
export function controllerAvailable(s: OpenSocietyState, c: Controller) {
  return c.kind === 'resident'
    ? Object.hasOwn(s.world.agents, c.id)
    : !!s.collectives?.charters[c.id] && collectiveOperable(s.collectives.charters[c.id]!);
}
export function controllerVisibleTo(s: OpenSocietyState, c: Controller, actor: string) {
  if (c.kind === 'resident') return c.id === actor;
  const charter = s.collectives?.charters[c.id];
  return charter?.status === 'active' && charter.members.includes(actor);
}

/** Principal visibility is metadata access, never authority to spend, work or change a resource. */
export function principalVisibleTo(
  s: OpenSocietyState,
  p: ResourcePrincipal,
  actor: string,
): boolean {
  if (p.kind === 'resident' || p.kind === 'collective')
    return controllerVisibleTo(s, { kind: p.kind, id: p.id }, actor);
  if (p.kind === 'enterprise') {
    const enterprise = s.world.enterprises[p.id];
    return !!enterprise && controllerVisibleTo(s, enterpriseController(enterprise), actor);
  }
  const grant = s.world.publicGovernance?.authority.grant;
  return grant?.id === p.id && grant.residents.includes(actor);
}

/** Shared by project queries and quotation creation; a financial offer grants no new source visibility. */
export function constructionVisibleTo(
  s: OpenSocietyState,
  p: ConstructionProject,
  actorId: string,
): boolean {
  return p.workers.includes(actorId) || principalVisibleTo(s, p.controller, actorId);
}
