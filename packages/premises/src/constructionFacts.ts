import type { PremisesState } from './model';
/** Owning-domain immutable specification and recorded progress; no price, payment or satisfaction. */
export function premisesConstructionFacts(state: PremisesState, id: string) {
  const project = state.projects[id];
  if (!project) return undefined;
  return {
    sourceVersion: 'resident-premises-v1' as const,
    specification: structuredClone({
      projectId: project.id,
      kind: project.kind,
      siteId: project.siteId,
      buildingId: project.buildingId,
      workLocationId: project.workLocationId,
      beneficiary: project.controller,
      plan: project.plan,
      reservations: project.reservations,
      landUse: project.landUse,
      // The original author and exact authority remain distinct from any current building controller.
      createdBy: project.createdBy,
      ...(project.principalAuthorization
        ? { principalAuthorization: project.principalAuthorization }
        : {}),
      ...(project.decisionId ? { decisionId: project.decisionId } : {}),
    }),
    revision: project.revision,
    at: project.at,
    progressMs: project.progressMs,
    status: project.status,
  };
}
