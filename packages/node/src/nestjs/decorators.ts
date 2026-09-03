import { SetMetadata } from "@nestjs/common";
import { RBAC_PERMISSION_KEY, RBAC_PUBLIC_KEY } from "./tokens.js";

export interface PermissionMetadata {
  resource: string;
  action: string;
}

export function RequirePermission(
  resource: string,
  action: string
): MethodDecorator & ClassDecorator {
  return SetMetadata(RBAC_PERMISSION_KEY, { resource, action });
}

/** Exempts a handler from `denyUnannotatedRoutes`. */
export function PublicRoute(): MethodDecorator & ClassDecorator {
  return SetMetadata(RBAC_PUBLIC_KEY, true);
}
