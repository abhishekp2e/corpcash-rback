import type {
  ParsedPermission,
  PermissionMatch,
  RoleDefinition,
} from "../types/index.js";
import { normalizePermissions } from "../permissions/parse.js";
import {
  findMatchingPermission,
  permissionToString,
} from "../matcher/wildcard.js";
import {
  resolveRoleInheritance,
  validateRoleGraph,
  type RoleClosure,
} from "../roles/inheritance.js";

/** Closure cache bound, so subject-supplied role lists cannot grow it forever. */
const MAX_CACHED_CLOSURES = 512;

export interface RoleMatch extends PermissionMatch {
  ignoredRoles: string[];
}

/**
 * Parses every role's permissions once and caches resolved inheritance
 * closures, so an authorize() call walks pre-parsed data instead of re-parsing
 * permission strings and re-resolving the graph on every request.
 */
export class CompiledRoles {
  private readonly definitions: Record<string, RoleDefinition>;
  private readonly permissionsByRole = new Map<string, ParsedPermission[]>();
  private readonly closures = new Map<string, RoleClosure>();
  private readonly onUnknownRole: "throw" | "skip";

  constructor(
    definitions: Record<string, RoleDefinition>,
    strictRoles: boolean
  ) {
    validateRoleGraph(definitions);

    this.definitions = definitions;
    this.onUnknownRole = strictRoles ? "throw" : "skip";

    for (const [role, definition] of Object.entries(definitions)) {
      this.permissionsByRole.set(
        role,
        normalizePermissions(definition.permissions, `role "${role}"`)
      );
    }
  }

  closureFor(roleNames: readonly string[]): RoleClosure {
    const unique = [...new Set(roleNames)];
    const key = unique.join("\u0000");

    const cached = this.closures.get(key);
    if (cached) return cached;

    const closure = resolveRoleInheritance(unique, this.definitions, {
      onUnknownRole: this.onUnknownRole,
    });

    if (this.closures.size >= MAX_CACHED_CLOSURES) {
      const oldest = this.closures.keys().next().value;
      if (oldest !== undefined) this.closures.delete(oldest);
    }
    this.closures.set(key, closure);

    return closure;
  }

  match(
    roleNames: readonly string[],
    requestedResource: string,
    requestedAction: string
  ): RoleMatch {
    const { order, ignored } = this.closureFor(roleNames);

    for (const role of order) {
      const permissions = this.permissionsByRole.get(role);
      if (!permissions) continue;

      const found = findMatchingPermission(
        permissions,
        requestedResource,
        requestedAction
      );
      if (found) {
        return {
          matched: true,
          matchedRole: role,
          matchedPermission: permissionToString(found),
          ignoredRoles: ignored,
        };
      }
    }

    return { matched: false, ignoredRoles: ignored };
  }

  effectivePermissions(roleNames: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const role of this.closureFor(roleNames).order) {
      for (const permission of this.permissionsByRole.get(role) ?? []) {
        const key = permissionToString(permission);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(key);
        }
      }
    }

    return result;
  }
}

export function matchDirectPermissions(
  permissions: readonly ParsedPermission[],
  requestedResource: string,
  requestedAction: string
): PermissionMatch {
  const match = findMatchingPermission(
    permissions,
    requestedResource,
    requestedAction
  );

  if (match) {
    return { matched: true, matchedPermission: permissionToString(match) };
  }

  return { matched: false };
}
