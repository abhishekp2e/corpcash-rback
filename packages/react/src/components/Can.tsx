import type { ReactNode } from "react";
import type { Resource } from "@corpcash/rbac-core";
import { useCan, useRole } from "../provider/RBACProvider.js";

export interface CanProps {
  resource: string;
  action: string;
  resourceInstance?: Resource;
  fallback?: ReactNode;
  children: ReactNode;
}

export function Can({
  resource,
  action,
  resourceInstance,
  fallback = null,
  children,
}: CanProps) {
  const allowed = useCan(resource, action, resourceInstance);
  return allowed ? <>{children}</> : <>{fallback}</>;
}

export interface RequirePermissionProps {
  resource: string;
  action: string;
  resourceInstance?: Resource;
  fallback?: ReactNode;
  children: ReactNode;
}

export function RequirePermission({
  resource,
  action,
  resourceInstance,
  fallback = null,
  children,
}: RequirePermissionProps) {
  return (
    <Can
      resource={resource}
      action={action}
      resourceInstance={resourceInstance}
      fallback={fallback}
    >
      {children}
    </Can>
  );
}

export interface RequireRoleProps {
  role: string;
  fallback?: ReactNode;
  children: ReactNode;
}

export function RequireRole({
  role,
  fallback = null,
  children,
}: RequireRoleProps) {
  const hasRole = useRole(role);
  return hasRole ? <>{children}</> : <>{fallback}</>;
}
