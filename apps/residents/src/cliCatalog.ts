import { OPEN_SOCIETY_TOOLS, residentCapabilityRoute } from '@aivilization/worker';
import type { OpenToolDefinition } from '@aivilization/agent-runtime';

export { RESIDENT_CLI_VERSION, RESIDENT_SKILL_VERSION } from '@aivilization/worker';

import { capabilityFlagName } from '@aivilization/worker';
export const flagName = capabilityFlagName;
export type ResidentCliCommand = {
  readonly route: string;
  readonly definition: OpenToolDefinition;
};
export const RESIDENT_COMMANDS: readonly ResidentCliCommand[] = OPEN_SOCIETY_TOOLS.map(
  (definition) => {
    const route = residentCapabilityRoute(definition.name);
    return { route, definition };
  },
);
export function cliRoute(capability: string): string {
  const command = RESIDENT_COMMANDS.find((item) => item.definition.name === capability);
  if (command === undefined) throw new Error(`unknown-cli-capability:${capability}`);
  return `town ${command.route}`;
}
export const CLI_GROUPS = [
  ...new Set(RESIDENT_COMMANDS.map((command) => command.route.split(' ')[0]!)),
];

export function commandHelp(command: ResidentCliCommand): string {
  const { definition } = command;
  return [
    `town ${command.route} [flags]`,
    definition.description,
    ...Object.entries(definition.inputSchema.properties).map(([name, property]) =>
      `--${flagName(name)} <${property.enum?.join('|') ?? property.type}> ${definition.inputSchema.required.includes(name) ? (property.type === 'array' && (property.minItems ?? 0) === 0 ? '(optional flag; omitted means [])' : '(required)') : '(optional)'}${property.type === 'array' ? ' repeat flag per item; an empty quoted string is one item, not an empty list' : ''}${property.minItems === undefined ? '' : ` minItems=${property.minItems}`}${property.maxItems === undefined ? '' : ` maxItems=${property.maxItems}`}${property.minimum === undefined ? '' : ` min=${property.minimum}`}${property.maximum === undefined ? '' : ` max=${property.maximum}`}${property.maxLength === undefined ? '' : ` maxLength=${property.maxLength}`} ${property.description ?? ''}`.trimEnd(),
    ),
    '--request-id <id> Optional idempotency key. Reuse only for an identical retry.',
    ...(definition.inputSchema.properties.content === undefined
      ? []
      : ['--content-stdin Read original content from stdin instead of --content (terminal use).']),
    'Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.',
  ].join('\n');
}
