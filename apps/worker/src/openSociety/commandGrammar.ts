import { validateOpenToolArguments, type OpenToolDefinition } from '@aivilization/agent-runtime';

/** Deliberately small command language: argv quoting, never shell evaluation. */
export function parseResidentCommand(command: string): string[] {
  if (command.length > 65_536 || command.includes('\0')) throw new Error('invalid-command-size');
  const argv: string[] = [];
  let word = '';
  let started = false;
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === '$' || char === '`')
        throw new Error('shell-expansion-not-supported-use-single-quotes');
      else if (char === '\\') {
        const next = command[++index];
        if (next === undefined) throw new Error('unfinished-escape');
        word += ['"', '\\', '$', '`'].includes(next) ? next : `\\${next}`;
      } else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '\\') {
      const next = command[++index];
      if (next === undefined || next === '\n' || next === '\r') throw new Error('invalid-escape');
      word += next;
      started = true;
    } else if (';&|<>$`(){}\n\r'.includes(char)) throw new Error('shell-operators-not-supported');
    else if (/\s/.test(char)) {
      if (started) {
        argv.push(word);
        word = '';
        started = false;
      }
    } else {
      word += char;
      started = true;
    }
  }
  if (quote !== undefined) throw new Error('unclosed-quote');
  if (started) argv.push(word);
  if (argv[0] !== 'town') throw new Error('only-town-cli-is-available');
  return argv.slice(1);
}

/** CLI flag spelling of a capability argument: camelCase becomes kebab-case. */
export const capabilityFlagName = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/**
 * Shared flag grammar for `town <group> <op> --flag value ...`, used by the resident CLI and by
 * action-plan steps. `--request-id` and `--content-stdin` are adapter concerns handled by callers.
 * `placeholders` lets a caller keep named literal tokens (e.g. `current`) for numeric flags so they
 * can be resolved later; such arguments are not schema-validated here.
 */
export function parseCapabilityFlags(
  definition: OpenToolDefinition,
  flags: readonly string[],
  options: {
    readonly placeholders?: Readonly<Record<string, readonly string[]>>;
    readonly validate?: boolean;
    readonly preset?: Readonly<Record<string, unknown>>;
  } = {},
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...options.preset };
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index]!;
    if (!flag.startsWith('--')) throw new Error(`expected-flag:${flag}`);
    const value = flags[++index];
    if (value === undefined) throw new Error(`missing-value:${flag}`);
    const entry = Object.entries(definition.inputSchema.properties).find(
      ([name]) => `--${capabilityFlagName(name)}` === flag,
    );
    if (entry === undefined) throw new Error(`unknown-flag:${flag}`);
    const [name, property] = entry;
    if (name === 'content' && options.preset?.content !== undefined)
      throw new Error('duplicate-content');
    if (args[name] !== undefined && property.type !== 'array')
      throw new Error(`duplicate-flag:${flag}`);
    if (options.placeholders?.[name]?.includes(value)) args[name] = value;
    else if (property.type === 'array')
      args[name] = [...((args[name] as string[] | undefined) ?? []), value];
    else if (property.type === 'boolean') {
      if (value !== 'true' && value !== 'false') throw new Error(`invalid-boolean:${flag}`);
      args[name] = value === 'true';
    } else if (property.type === 'number' || property.type === 'integer') {
      if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
        throw new Error(`invalid-number:${flag}`);
      args[name] = Number(value);
    } else if (property.type === 'string') args[name] = value;
    else if (property.type === 'object') {
      if (value.length > 16000) throw new Error(`object-too-large:${name}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error(`invalid-json:${name}`);
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error(`invalid-object:${name}`);
      args[name] = parsed;
    } else throw new Error('unsupported-cli-type');
  }
  for (const name of definition.inputSchema.required)
    if (
      definition.inputSchema.properties[name]?.type === 'array' &&
      (definition.inputSchema.properties[name]?.minItems ?? 0) === 0 &&
      args[name] === undefined
    )
      args[name] = [];
  if (options.validate !== false) {
    const error = validateOpenToolArguments(definition, args);
    if (error !== undefined) throw new Error(error);
  }
  return args;
}
