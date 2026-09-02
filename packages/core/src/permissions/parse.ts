import type { ParsedPermission } from "../types/index.js";

const PERMISSION_PATTERN = /^([^:*]+|\*):([^:*]+|\*)$/;

export function parsePermission(permission: string): ParsedPermission {
  const trimmed = permission.trim();
  const match = trimmed.match(PERMISSION_PATTERN);

  if (!match) {
    throw new Error(
      `Invalid permission format: "${permission}". Expected "resource:action" (e.g. "wallet:read").`
    );
  }

  return {
    resource: match[1],
    action: match[2],
  };
}

export function formatPermission(resource: string, action: string): string {
  return `${resource}:${action}`;
}

export function normalizePermissions(
  permissions: string[] | undefined
): ParsedPermission[] {
  if (!permissions) return [];
  return permissions.map(parsePermission);
}
