/** Journal serialization may reorder object keys. Fact equality must not depend on insertion order. */
export function serviceFactsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, index) => serviceFactsEqual(v, b[index]))
    );
  const left = a as Readonly<Record<string, unknown>>,
    right = b as Readonly<Record<string, unknown>>,
    keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && serviceFactsEqual(left[key], right[key]))
  );
}
