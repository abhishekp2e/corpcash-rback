import type { RoleDefinition } from "../types/index.js";

export class CircularRoleInheritanceError extends Error {
  constructor(cycle: string[]) {
    super(`Circular role inheritance detected: ${cycle.join(" -> ")}`);
    this.name = "CircularRoleInheritanceError";
  }
}

export class UnknownRoleError extends Error {
  constructor(role: string) {
    super(`Unknown role: "${role}"`);
    this.name = "UnknownRoleError";
  }
}

/**
 * Resolves role inheritance in topological order.
 * Returns roles from most-derived (subject's direct roles) to most-base.
 */
export function resolveRoleInheritance(
  roleNames: string[],
  roleDefinitions: Record<string, RoleDefinition>
): string[] {
  const resolved: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(roleName: string, path: string[]): void {
    if (visited.has(roleName)) return;

    if (visiting.has(roleName)) {
      throw new CircularRoleInheritanceError([...path, roleName]);
    }

    const definition = roleDefinitions[roleName];
    if (!definition) {
      throw new UnknownRoleError(roleName);
    }

    visiting.add(roleName);

    for (const parent of definition.inherits ?? []) {
      visit(parent, [...path, roleName]);
    }

    visiting.delete(roleName);
    visited.add(roleName);
    resolved.push(roleName);
  }

  for (const roleName of roleNames) {
    visit(roleName, []);
  }

  // Reverse so most-derived roles come first for permission matching priority
  return resolved.reverse();
}

export function resolveSubjectRoles(
  roleNames: string[],
  roleDefinitions: Record<string, RoleDefinition>
): string[] {
  if (Object.keys(roleDefinitions).length === 0) {
    return roleNames;
  }
  return resolveRoleInheritance(roleNames, roleDefinitions);
}
