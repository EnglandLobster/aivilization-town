import { personallyControls } from '@aivilization/authority';
import type { PremisesBuilding } from './model';
export function mayEnterPremises(b: PremisesBuilding, actorId: string) {
  return (
    b.status === 'operational' &&
    b.condition > 0 &&
    (b.access.entry === 'public' ||
      personallyControls(b, actorId) ||
      b.access.visitors.includes(actorId) ||
      b.access.operators.includes(actorId) ||
      b.access.residents.includes(actorId))
  );
}
export function mayOperatePremises(b: PremisesBuilding, actorId: string) {
  return (
    b.status === 'operational' &&
    b.condition > 0 &&
    (personallyControls(b, actorId) || b.access.operators.includes(actorId))
  );
}
export function mayResideInPremises(b: PremisesBuilding, actorId: string) {
  return (
    b.status === 'operational' &&
    b.condition > 0 &&
    b.blueprint.primaryUse === 'residence' &&
    (personallyControls(b, actorId) || b.access.residents.includes(actorId))
  );
}
