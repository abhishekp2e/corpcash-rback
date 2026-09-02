import type { RoleDefinition } from "../types/index.js";
import {
  CircularRoleInheritanceError,
  InvalidRBACConfigError,
  UnknownRoleError,
} from "../errors.js";

export { CircularRoleInheritanceError, UnknownRoleError };

export interface RoleClosure {
  /** Roles from most-derived (the subject's own roles) to most-base. */
  order: string[];
  /** Requested roles that had no definition. */
  ignored: string[];
}

export interface ResolveOptions {
  /** What to do with a role that has no definition. Default `"skip"`. */
  onUnknownRole?: "throw" | "skip";
}

/**
 * Walks the full inheritance graph, so a cycle or a dangling `inherits` entry
 * is reported at construction time rather than on the first request that
 * happens to touch that branch.
 */
export function validateRoleGraph(
  roleDefinitions: Record<string, RoleDefinition>
): void {
  for (const [role, definition] of Object.entries(roleDefinitions)) {
    for (const parent of definition.inherits ?? []) {
      if (!roleDefinitions[parent]) {
        throw new InvalidRBACConfigError(
          `Role "${role}" inherits unknown role "${parent}".`
        );
      }
    }
  }

  resolveRoleInheritance(Object.keys(roleDefinitions), roleDefinitions, {
    onUnknownRole: "throw",
  });
}

/** Resolves role inheritance in topological order. */
export function resolveRoleInheritance(
  roleNames: readonly string[],
  roleDefinitions: Record<string, RoleDefinition>,
  options: ResolveOptions = {}
): RoleClosure {
  const onUnknownRole = options.onUnknownRole ?? "skip";
  const resolved: string[] = [];
  const ignored: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(roleName: string, path: string[]): void {
    if (visited.has(roleName)) return;

    if (visiting.has(roleName)) {
      throw new CircularRoleInheritanceError([...path, roleName]);
    }

    const definition = roleDefinitions[roleName];
    if (!definition) {
      if (onUnknownRole === "throw") throw new UnknownRoleError(roleName);
      if (!ignored.includes(roleName)) ignored.push(roleName);
      visited.add(roleName);
      return;
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
  return { order: resolved.reverse(), ignored };
}
