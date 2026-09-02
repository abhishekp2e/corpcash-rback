import type { ParsedPermission } from "../types/index.js";
import { formatPermission } from "../permissions/parse.js";

function matchesSegment(pattern: string, value: string): boolean {
  return pattern === "*" || pattern === value;
}

export function matchesPermission(
  granted: ParsedPermission,
  requestedResource: string,
  requestedAction: string
): boolean {
  return (
    matchesSegment(granted.resource, requestedResource) &&
    matchesSegment(granted.action, requestedAction)
  );
}

export function findMatchingPermission(
  permissions: ParsedPermission[],
  requestedResource: string,
  requestedAction: string
): ParsedPermission | undefined {
  return permissions.find((p) =>
    matchesPermission(p, requestedResource, requestedAction)
  );
}

export function permissionToString(p: ParsedPermission): string {
  return formatPermission(p.resource, p.action);
}
