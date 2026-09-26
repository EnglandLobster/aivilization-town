import { decideCognitiveUpdate, type CognitiveEntry } from '@aivilization/memory';
import { numberArg, pageItems, stringArg, stringArrayArg, ToolRefusal } from './arguments';
import type { OpenSocietyState } from './types';
import type { ToolExecution } from './informationTools';
export function executeCognitionTool(
  state: OpenSocietyState,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  policyVersion = 'resident-cognition-v1',
): ToolExecution {
  const experiences = state.experiences[actorId] ?? [];
  if (name === 'memory.search') {
    const query = stringArg(args, 'query').toLocaleLowerCase();
    const person = stringArg(args, 'personId');
    const after = numberArg(args, 'after', -1);
    const before = numberArg(args, 'before', Number.MAX_SAFE_INTEGER);
    const source = stringArg(args, 'sourceId'),
      location = stringArg(args, 'locationId');
    const words = query.split(/\s+/).filter(Boolean);
    const items = [...experiences]
      .reverse()
      .filter(
        (entry) =>
          entry.at > after &&
          entry.at < before &&
          (!source || entry.sourceIds.includes(source)) &&
          (!location || entry.locationIds?.includes(location)) &&
          (!person || entry.people.includes(person)) &&
          words.every((word) => entry.summary.toLocaleLowerCase().includes(word)),
      );
    return {
      data: pageItems(
        items.map((entry) => ({
          ...entry,
          summary: entry.summary.slice(0, 700),
          expandedBy: 'memory.read',
        })),
        args,
      ),
      effects: {},
    };
  }
  if (name === 'memory.read') {
    const entry = experiences.find((entry) => entry.id === stringArg(args, 'id'));
    if (entry === undefined) throw new ToolRefusal('not-found');
    return { data: entry, effects: {} };
  }
  const cognition = state.cognition[actorId] ?? {};
  if (name === 'cognition.list') {
    const kind = stringArg(args, 'kind');
    return {
      data: pageItems(
        Object.values(cognition).filter(
          (entry) =>
            (!kind || entry.kind === kind) &&
            (args.active === undefined || entry.active === args.active) &&
            (!args.personId || entry.people?.includes(stringArg(args, 'personId'))),
        ),
        args,
      ),
      effects: {},
    };
  }
  if (name !== 'cognition.update') throw new ToolRefusal('unknown-cognition-tool');
  const decision = decideCognitiveUpdate({
    state: cognition,
    policyVersion:
      policyVersion === 'resident-cognition-v2' ? 'resident-cognition-v2' : 'resident-cognition-v1',
    ownerId: actorId,
    at: state.world.clock.now,
    update: {
      key: stringArg(args, 'key'),
      kind: stringArg(args, 'kind') as CognitiveEntry['kind'],
      statement: stringArg(args, 'statement'),
      confidence: numberArg(args, 'confidence'),
      evidenceIds: stringArrayArg(args, 'evidenceIds'),
      expectedRevision: numberArg(args, 'expectedRevision'),
      active: args.active === true,
      ...(args.pinned === undefined ? {} : { pinned: args.pinned === true }),
      ...(args.people === undefined ? {} : { people: stringArrayArg(args, 'people') }),
    },
    visibleEvidenceIds: new Set(experiences.flatMap((entry) => [entry.id, ...entry.sourceIds])),
  });
  if (!decision.accepted) throw new ToolRefusal(decision.reason);
  return { data: decision.event.entry, effects: { cognitiveEvents: [decision.event] } };
}
