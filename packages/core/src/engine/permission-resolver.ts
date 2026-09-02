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
import { resolveSubjectRoles } from "../roles/inheritance.js";

export function resolvePermissionsForRoles(
  roleNames: string[],
  roleDefinitions: Record<string, RoleDefinition>
): { role: string; permissions: ParsedPermission[] }[] {
  const resolvedRoles = resolveSubjectRoles(roleNames, roleDefinitions);
  const result: { role: string; permissions: ParsedPermission[] }[] = [];

  for (const role of resolvedRoles) {
    const definition = roleDefinitions[role];
    if (!definition) continue;
    result.push({
      role,
      permissions: normalizePermissions(definition.permissions),
    });
  }

  return result;
}

export function matchPermissionForSubject(
  roleNames: string[],
  roleDefinitions: Record<string, RoleDefinition>,
  requestedResource: string,
  requestedAction: string
): PermissionMatch {
  const rolePermissions = resolvePermissionsForRoles(
    roleNames,
    roleDefinitions
  );

  for (const { role, permissions } of rolePermissions) {
    const match = findMatchingPermission(
      permissions,
      requestedResource,
      requestedAction
    );
    if (match) {
      return {
        matched: true,
        matchedRole: role,
        matchedPermission: permissionToString(match),
      };
    }
  }

  return { matched: false };
}

export function matchDirectPermissions(
  permissions: string[],
  requestedResource: string,
  requestedAction: string
): PermissionMatch {
  const parsed = normalizePermissions(permissions);
  const match = findMatchingPermission(
    parsed,
    requestedResource,
    requestedAction
  );

  if (match) {
    return {
      matched: true,
      matchedPermission: permissionToString(match),
    };
  }

  return { matched: false };
}
