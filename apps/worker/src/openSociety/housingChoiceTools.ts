import { housingChoiceRevision, resolveResidentialUpkeepRate } from '@aivilization/society';
import {
  chooseResidentHousingStandard,
  resolveAgentResidenceLocationId,
  type WorldCommandPolicies,
} from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { residentWorldContext } from './context';
import { numberArg, pageItems, ToolRefusal } from './arguments';
import { worldExperiences } from './worldTools';
import { digest } from './journal';
export function executeHousingChoiceTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  policies: WorldCommandPolicies,
  actorId: string,
  name: string,
  args: Record<string, unknown>,
  requestId: string,
): ToolExecution {
  const w = s.world,
    state = w.housingChoice,
    actor = w.agents[actorId];
  if (!state || !actor) throw new ToolRefusal('housing-choice-not-enabled');
  if (name === 'housing.standard') {
    const view = residentWorldContext(s, actorId, policies).agent;
    const landValueIndex = view.regionalLandValueIndex;
    return {
      data: {
        policyVersion: state.policy.version,
        revision: housingChoiceRevision(state, actorId),
        personalStandard: actor.residentialTier,
        upkeepArrears: actor.upkeepArrears ?? 0,
        residenceLocationId: resolveAgentResidenceLocationId(w, actor),
        locationId: actor.locationId,
        currentUpkeepRatePerHour: view.residentialUpkeepRatePerHour ?? null,
        ...(w.publicHousing
          ? {
              publicHousingRevision: w.publicHousing.revisions.at(-1)!.revision,
              arrearsMode: w.publicHousing.arrearsMode,
              institutionalRulesWith: 'town governance housing',
            }
          : {}),
        upkeepSource: policies.residentialUpkeep?.policyVersion ?? 'inherited-scenario-upkeep',
        standards: pageItems(
          state.availableTiers.map((tier) => ({
            tier,
            ratePerHourAtCurrentResidence: policies.residentialUpkeep
              ? (resolveResidentialUpkeepRate({
                  residentialTier: tier,
                  policy: policies.residentialUpkeep,
                  ...(landValueIndex === undefined ? {} : { landValueIndex }),
                }) ?? null)
              : null,
            lowerSelectable: tier < actor.residentialTier,
          })),
          args,
        ),
        lowerWith: 'town housing lower --target-tier <tier> --expected-revision <revision>',
        upgradeWith: 'town housing upgrade',
        actualSpaceWith: 'town housing list',
        privateContractsWith: 'town leases list',
        scope:
          'Personal historical service standard, not physical building quality or ownership. Rates are current, not future guaranteed prices. Past arrears and private rent are separate. Lowering does not change body values now; later actions use the registered physiological assumptions. Existing qualifications, jobs and submitted applications remain facts.',
      },
      effects: {},
    };
  }
  if (name !== 'housing.lower') throw new ToolRefusal('unknown-housing-choice-command');
  const d = chooseResidentHousingStandard({
    projection: w,
    actorId,
    targetTier: numberArg(args, 'targetTier'),
    expectedRevision: numberArg(args, 'expectedRevision'),
    simulationId: m.simulationId,
    requestId: `housing-${digest([actorId, requestId]).slice(0, 32)}`,
    nextSequence: s.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: { changes: d.events.map((e) => e.payload), readWith: 'town housing standard' },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events, actorId) },
  };
}
