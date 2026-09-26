import { OPEN_SOCIETY_TOOLS } from '@aivilization/worker';
import type { OpenToolDefinition } from '@aivilization/agent-runtime';

export const RESIDENT_CLI_VERSION = 'resident-cli-v4';
export const RESIDENT_SKILL_VERSION = 'town-resident-skill-v6';

const worldRoutes: Readonly<Record<string, string>> = {
  observe: 'city observe',
  raise_petition: 'civic petition',
  sign_petition: 'civic sign',
  post_bulletin: 'civic post-bulletin',
  raise_matter: 'civic request-help',
  respond_matter: 'civic respond',
  assign_matter: 'civic assign',
  close_matter: 'civic close',
  move: 'travel go',
  eat: 'life eat',
  consume: 'life consume',
  sleep: 'life sleep',
  doctor: 'life doctor',
  study: 'education study',
  trade: 'market trade',
  work: 'business work',
  produce: 'business produce',
  apply_job: 'business apply-job',
  give: 'market give',
  found_enterprise: 'business found',
  join_enterprise: 'business join',
  leave_enterprise: 'business leave',
  fund_enterprise: 'business fund',
  close_enterprise: 'business close',
  post_job: 'business post-job',
  deposit: 'bank deposit',
  withdraw: 'bank withdraw',
  borrow: 'bank borrow',
  export: 'market export',
  import: 'market import',
  upgrade_home: 'housing upgrade',
  choose_residence: 'housing choose',
  build_housing: 'housing build',
  apply_exam: 'education apply-exam',
};
export const flagName = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
export type ResidentCliCommand = {
  readonly route: string;
  readonly definition: OpenToolDefinition;
};
export const RESIDENT_COMMANDS: readonly ResidentCliCommand[] = OPEN_SOCIETY_TOOLS.map(
  (definition) => {
    const [category, operation] = definition.name.split('.') as [string, string];
    const route = category === 'world' ? worldRoutes[operation] : `${category} ${operation}`;
    if (route === undefined) throw new Error(`missing-cli-route:${definition.name}`);
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
      `--${flagName(name)} <${property.enum?.join('|') ?? property.type}> ${definition.inputSchema.required.includes(name) ? '(required)' : '(optional)'}${property.type === 'array' ? ' repeat flag per item; omit for [] when required' : ''}${property.minimum === undefined ? '' : ` min=${property.minimum}`}${property.maximum === undefined ? '' : ` max=${property.maximum}`}${property.maxLength === undefined ? '' : ` maxLength=${property.maxLength}`} ${property.description ?? ''}`.trimEnd(),
    ),
    '--request-id <id> Optional idempotency key. Reuse only for an identical retry.',
    ...(definition.inputSchema.properties.content === undefined
      ? []
      : ['--content-stdin Read original content from stdin instead of --content (terminal use).']),
    'Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.',
  ].join('\n');
}
