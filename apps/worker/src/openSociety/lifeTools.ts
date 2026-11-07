import {
  premisesAtLocation,
  mayResideWorldPremises,
  resolveResidentialOccupancy,
} from '@aivilization/world';
import { pageItems, ToolRefusal } from './arguments';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
/** Where people can live: residential locations, their capacity and current occupancy. */
export function executeLifeTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): ToolExecution {
  if (name !== 'housing.list') throw new ToolRefusal('unknown-life-command');
  return {
    data: pageItems(
      Object.values(state.world.locations)
        .filter((l) => l.kind === 'residence')
        .map((l) => {
          const premises = premisesAtLocation(state.world, l.locationId);
          return {
            id: l.locationId,
            name: l.name,
            capacity: l.capacity,
            occupied: resolveResidentialOccupancy(state.world, l.locationId),
            ...(premises
              ? {
                  premisesStatus: premises.status,
                  condition: premises.condition,
                  mayChooseResidence: mayResideWorldPremises(state.world, actorId, l.locationId),
                  details: `town premises read --id ${premises.id}`,
                }
              : {}),
          };
        }),
      args,
    ),
    effects: {},
  };
}
