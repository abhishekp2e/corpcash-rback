const warned = new Set<string>();

/**
 * The resource declared on the route is the contract; an instance loader that
 * reports a different type is a wiring mistake that would otherwise silently
 * change which permission is checked.
 */
export function warnResourceTypeMismatch(
  declared: string,
  actual: string
): void {
  const key = `${declared}\u0000${actual}`;
  if (warned.has(key)) return;
  warned.add(key);

  console.warn(
    `[rbac] getResource returned type "${actual}" for a route declaring ` +
      `"${declared}". Checking "${declared}".`
  );
}

/** Test helper: forget which mismatches have already been reported. */
export function resetResourceWarnings(): void {
  warned.clear();
}
