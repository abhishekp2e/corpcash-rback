import {
  InvalidRBACConfigError,
  RBAC,
  type RoleDefinition,
} from "@corpcash/rbac-core";
import type { StoredRBACConfig, StoredRole } from "./types.js";

export function cloneRole(def: RoleDefinition): RoleDefinition {
  return {
    permissions: def.permissions ? [...def.permissions] : [],
    inherits: def.inherits ? [...def.inherits] : [],
  };
}

export function rolesRecord(
  roles: StoredRole[]
): Record<string, RoleDefinition> {
  return Object.fromEntries(
    roles.map((role) => [
      role.name,
      { permissions: role.permissions ?? [], inherits: role.inherits ?? [] },
    ])
  );
}

export function validateStoredConfig(config: StoredRBACConfig): void {
  new RBAC({
    roles: config.roles ?? {},
    strictRoles: config.strictRoles,
  });
}

export function assertRoleName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new InvalidRBACConfigError("Role name must be a non-empty string.");
  }
  return trimmed;
}

export function nextRolesAfterUpsert(
  current: Record<string, RoleDefinition>,
  name: string,
  def: RoleDefinition
): Record<string, RoleDefinition> {
  const roleName = assertRoleName(name);
  const next = {
    ...current,
    [roleName]: cloneRole(def),
  };
  validateStoredConfig({ roles: next });
  return next;
}

export function nextRolesAfterDelete(
  current: Record<string, RoleDefinition>,
  name: string
): Record<string, RoleDefinition> {
  const roleName = assertRoleName(name);
  if (!current[roleName]) {
    return current;
  }

  const inheritors = Object.entries(current)
    .filter(
      ([other, def]) => other !== roleName && def.inherits?.includes(roleName)
    )
    .map(([other]) => other);

  if (inheritors.length > 0) {
    throw new InvalidRBACConfigError(
      `Cannot delete role "${roleName}" because it is inherited by: ${inheritors.join(", ")}.`
    );
  }

  const next = { ...current };
  delete next[roleName];
  validateStoredConfig({ roles: next });
  return next;
}

export function assertRolesExist(
  current: Record<string, RoleDefinition>,
  roles: readonly string[]
): void {
  const missing = [...new Set(roles)].filter((role) => !current[role]);
  if (missing.length > 0) {
    throw new InvalidRBACConfigError(
      `Unknown role${missing.length === 1 ? "" : "s"}: ${missing
        .map((role) => `"${role}"`)
        .join(", ")}.`
    );
  }
}
