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
