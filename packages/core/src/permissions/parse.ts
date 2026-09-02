import type { ParsedPermission } from "../types/index.js";
import { InvalidPermissionError } from "../errors.js";

const PERMISSION_PATTERN = /^([^:*]+|\*):([^:*]+|\*)$/;

export function tryParsePermission(
  permission: string
): ParsedPermission | undefined {
  const match = permission.trim().match(PERMISSION_PATTERN);
  if (!match) return undefined;
  return { resource: match[1], action: match[2] };
}

export function parsePermission(
  permission: string,
  origin?: string
): ParsedPermission {
  const parsed = tryParsePermission(permission);
  if (!parsed) throw new InvalidPermissionError(permission, origin);
  return parsed;
}

export function formatPermission(resource: string, action: string): string {
  return `${resource}:${action}`;
}

export function normalizePermissions(
  permissions: string[] | undefined,
  origin?: string
): ParsedPermission[] {
  if (!permissions) return [];
  return permissions.map((p) => parsePermission(p, origin));
}

export interface LenientParseResult {
  parsed: ParsedPermission[];
  invalid: string[];
}

/**
 * Parses a permission list without throwing. Used for permission lists that
 * arrive at runtime (an authorization API response), where one malformed entry
 * must not take down the caller.
 */
export function normalizePermissionsLenient(
  permissions: string[] | undefined
): LenientParseResult {
  const parsed: ParsedPermission[] = [];
  const invalid: string[] = [];

  for (const permission of permissions ?? []) {
    const result = tryParsePermission(permission);
    if (result) parsed.push(result);
    else invalid.push(permission);
  }

  return { parsed, invalid };
}
