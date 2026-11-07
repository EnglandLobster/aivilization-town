import { validateOpenToolArguments } from '@aivilization/agent-runtime';
import type { OpenAgentActionPlansPolicy } from '@aivilization/agent-runtime';
import { materialProductionWorkWindow } from '@aivilization/materials';
import { OPEN_SOCIETY_TOOLS } from './catalog';
import { residentCapabilityRoute } from './capabilityRoutes';
import { parseCapabilityFlags, parseResidentCommand } from './commandGrammar';
import { ToolRefusal } from './arguments';
import type { OpenSocietyState, ResidentActionPlanStep } from './types';

/**
 * Only the resident's own bodily and personal-resource actions can be queued. Anything that binds
 * other people (offers, proposals, votes, programs) still needs a live opportunity.
 */
const PLANNABLE_V1 = [
  'world.move',
  'world.eat',
  'world.sleep',
  'world.trade',
  'world.work',
  'world.study',
  'world.give',
  'production.gather',
  'production.create',
  'production.start',
  'stocks.deposit',
  'stocks.withdraw',
  'messages.send',
] as const;
const PLANNABLE: Readonly<Record<OpenAgentActionPlansPolicy['version'], ReadonlySet<string>>> = {
  'resident-action-plans-v1': new Set(PLANNABLE_V1),
  'resident-action-plans-v2': new Set([...PLANNABLE_V1, 'world.consume']),
};
/** Capabilities a town's plan policy lets residents queue. Fixed per policy version. */
export function plannableCapabilities(
  version: OpenAgentActionPlansPolicy['version'],
): ReadonlySet<string> {
  return PLANNABLE[version];
}
/** The same set as `town` routes, for the resident context. */
export function plannableRoutes(version: OpenAgentActionPlansPolicy['version']): string[] {
  return [...PLANNABLE[version]].map(residentCapabilityRoute);
}

/**
 * Shown in the resident context. Exactly the CLI syntax (one --steps per action) so that it can be
 * copied; a test parses it against the schedule.plan schema.
 */
export const ACTION_PLAN_HINT =
  "town schedule plan --id ID --note 'why' --steps 'town travel go --target-location-id LOCATION' --steps 'town business work --occupation-name OCCUPATION --labor-seconds 7200' — up to 8 of your own actions run in order without waking you; you are woken when it finishes or a step is refused";
/** Values a resident cannot know when writing the plan, resolved from facts when the step runs. */
const PLACEHOLDERS: Readonly<
  Record<string, Readonly<Record<string, (s: OpenSocietyState, a: Args, now: number) => number>>>
> = {
  'production.start': {
    expectedRevision: (s, a) => revision(s.world.materials?.productions[str(a.id)]?.revision),
    until: (s, a, now) => {
      const materials = s.world.materials,
        job = materials?.productions[str(a.id)];
      const window = materials && job ? materialProductionWorkWindow(materials, job) : null;
      if (!window) throw new ToolRefusal('plan-production-not-startable');
      return now + window.maximumDurationMs;
    },
  },
  'production.gather': {
    expectedRevision: (s, a) => revision(s.world.materials?.stocks[str(a.stockId)]?.revision),
    sourceRevision: (s, a) =>
      revision(s.world.materials?.extraction?.sources[str(a.sourceId)]?.revision),
  },
  'production.create': {
    expectedRevision: (s, a) => revision(s.world.materials?.stocks[str(a.stockId)]?.revision),
  },
  'stocks.deposit': {
    expectedRevision: (s, a) => revision(s.world.materials?.stocks[str(a.id)]?.revision),
  },
  'stocks.withdraw': {
    expectedRevision: (s, a) => revision(s.world.materials?.stocks[str(a.id)]?.revision),
  },
};
const TOKENS: Readonly<Record<string, string>> = {
  expectedRevision: 'current',
  sourceRevision: 'current',
  until: 'complete',
};
type Args = Readonly<Record<string, unknown>>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
function revision(v: number | undefined): number {
  if (v === undefined) throw new ToolRefusal('plan-resource-not-found');
  return v;
}

/** Parse one `town <group> <op> --flag value` step written by the resident. */
export function parseActionPlanStep(
  command: string,
  version: OpenAgentActionPlansPolicy['version'],
): ResidentActionPlanStep {
  let argv: string[];
  try {
    argv = parseResidentCommand(command.trim());
  } catch (error) {
    throw new ToolRefusal(`plan-step-unparseable:${error instanceof Error ? error.message : ''}`);
  }
  const route = argv.slice(0, 2).join(' ');
  const definition = OPEN_SOCIETY_TOOLS.find(
    (tool) => residentCapabilityRoute(tool.name) === route,
  );
  if (!definition) throw new ToolRefusal(`plan-step-unknown-command:${route}`);
  if (!PLANNABLE[version].has(definition.name))
    throw new ToolRefusal(`plan-step-not-plannable:${route}`);
  const supported = PLACEHOLDERS[definition.name] ?? {};
  const placeholders = Object.fromEntries(
    Object.keys(supported).map((name) => [name, [TOKENS[name]!]]),
  );
  let args: Record<string, unknown>;
  try {
    args = parseCapabilityFlags(definition, argv.slice(2), { placeholders, validate: false });
  } catch (error) {
    throw new ToolRefusal(`plan-step-invalid:${error instanceof Error ? error.message : ''}`);
  }
  // Validate the shape now, with placeholders standing in as plausible numbers.
  const probe = Object.fromEntries(
    Object.entries(args).map(([k, v]) => [k, typeof v === 'string' && v === TOKENS[k] ? 1 : v]),
  );
  const invalid = validateOpenToolArguments(definition, probe);
  if (invalid !== undefined) throw new ToolRefusal(`plan-step-invalid:${invalid}`);
  return { command: command.trim(), capability: definition.name, arguments: args };
}

/** Replace placeholders with the current facts at the moment the step runs. */
export function resolveActionPlanArguments(
  state: OpenSocietyState,
  step: ResidentActionPlanStep,
  now: number,
): Record<string, unknown> {
  const resolvers = PLACEHOLDERS[step.capability] ?? {};
  return Object.fromEntries(
    Object.entries(step.arguments).map(([k, v]) => {
      const resolve = resolvers[k];
      return [k, resolve && v === TOKENS[k] ? resolve(state, step.arguments, now) : v];
    }),
  );
}
