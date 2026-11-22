/** Journal serialization can reorder keys; facts are compared structurally, never as JSON strings. */
export function tradeFactsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => tradeFactsEqual(v, b[i]))
    );
  const x = a as Readonly<Record<string, unknown>>,
    y = b as Readonly<Record<string, unknown>>;
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((k) => Object.hasOwn(y, k) && tradeFactsEqual(x[k], y[k]))
  );
}
