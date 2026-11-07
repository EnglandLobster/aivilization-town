import { housingOccupancyRevision } from '@aivilization/society';
import {
  leaveResidentHousing,
  residentHousingOccupancyFacts,
  residentPhysicalRestSource,
} from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { numberArg, stringArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';
export function executeHousingOccupancyTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Record<string, unknown>,
  requestId: string,
): ToolExecution {
  const state = s.world.housingOccupancy;
  if (!state) throw new ToolRefusal('housing-occupancy-not-enabled');
  if (name === 'housing.occupancy') {
    const { personalRights, ...facts } = residentHousingOccupancyFacts(s.world, actorId);
    return {
      data: {
        policyVersion: state.policy.version,
        revision: housingOccupancyRevision(state, actorId),
        ...facts,
        ...(s.world.physicalHousingRest
          ? {
              physicalRest: {
                policy: s.world.physicalHousingRest,
                source: residentPhysicalRestSource(s.world, actorId),
                sleepWith: 'town life sleep',
                limits:
                  'Actual location and structure determine elapsed recovery; permission, registration, rent and legacy service caps remain separate.',
              },
            }
          : {}),
        personalRights: pageItems(personalRights, args),
        leaveWith:
          'town housing leave --expected-residence-id <residenceId> --expected-revision <revision>',
        moveWith: 'town travel go',
        chooseWith: 'town housing choose',
        standardsWith: 'town housing standard',
        limits:
          'Actual location, registered residence, use permission, title and private contracts are distinct. Expired rights do not teleport you or erase belongings. Leaving registration does not settle contracts or make the building yours.',
      },
      effects: {},
    };
  }
  if (name !== 'housing.leave') throw new ToolRefusal('unknown-housing-occupancy-command');
  const d = leaveResidentHousing({
    projection: s.world,
    actorId,
    expectedResidenceId: stringArg(args, 'expectedResidenceId'),
    expectedRevision: numberArg(args, 'expectedRevision'),
    simulationId: m.simulationId,
    requestId: `occupancy-${digest([actorId, requestId]).slice(0, 32)}`,
    nextSequence: s.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: { changes: d.events.map((e) => e.payload), readWith: 'town housing occupancy' },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events, actorId) },
  };
}
