export function assertSafeIdent(value: string, label: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(
      `Invalid ${label} "${value}". Use letters, digits, and underscore only.`
    );
  }
  return value;
}

export function tableNames(prefix = "rbac_") {
  const safe = assertSafeIdent(prefix, "table prefix");
  return {
    prefix: safe,
    roles: `${safe}roles`,
    assignments: `${safe}assignments`,
    settings: `${safe}settings`,
  };
}
