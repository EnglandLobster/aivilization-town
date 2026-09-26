/** These accessors follow validateOpenToolArguments at the capability boundary. */
export function stringArg(
  args: Readonly<Record<string, unknown>>,
  name: string,
  fallback = '',
): string {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new ToolRefusal(`invalid-string:${name}`);
  return value;
}
export function numberArg(
  args: Readonly<Record<string, unknown>>,
  name: string,
  fallback = 0,
): number {
  const value = args[name];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ToolRefusal(`invalid-number:${name}`);
  return value;
}
export function stringArrayArg(args: Readonly<Record<string, unknown>>, name: string): string[] {
  const value = args[name] ?? [];
  if (!Array.isArray(value) || value.some((entry: unknown) => typeof entry !== 'string'))
    throw new ToolRefusal(`invalid-array:${name}`);
  return value as string[];
}
export function pageItems<T>(
  items: readonly T[],
  args: Readonly<Record<string, unknown>>,
  maximum = 30,
) {
  const offset = numberArg(args, 'offset');
  const limit = Math.min(numberArg(args, 'limit', 10), maximum);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}
export class ToolRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ToolRefusal';
  }
}
