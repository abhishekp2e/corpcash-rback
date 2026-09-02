import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import {
  RBAC,
  type RBACConfig,
  type Resource,
  type Subject,
} from "@corpcash/rbac-core";

export interface RBACContextValue {
  rbac: RBAC;
  subject: Subject;
  /** Entries of `permissions` that were not valid `resource:action` strings. */
  invalidPermissions: readonly string[];
}

export interface RBACProviderProps {
  subject: Subject;
  /** Effective permissions from the backend. Malformed entries are skipped, not thrown. */
  permissions?: string[];
  roles?: RBACConfig["roles"];
  /** Called once per render pass when `permissions` contains unusable entries. */
  onInvalidPermissions?: (invalid: readonly string[]) => void;
  children: ReactNode;
}

const RBACContext = createContext<RBACContextValue | null>(null);

export function RBACProvider({
  subject,
  permissions,
  roles,
  onInvalidPermissions,
  children,
}: RBACProviderProps) {
  // Keyed on content, not array identity, so an inline literal does not rebuild
  // the engine on every render.
  const permissionKey = permissions?.join("\u0000");
  const roleKey = roles ? JSON.stringify(roles) : undefined;

  // Deps are the content keys, not the props themselves, so an inline array or
  // object literal does not rebuild the engine on every render.
  const rbac = useMemo(() => {
    if (permissions) return new RBAC({ permissions });
    if (roles) return new RBAC({ roles });
    return new RBAC({ permissions: [] });
  }, [permissionKey, roleKey]);

  const invalidPermissions = rbac.invalidPermissions;

  useEffect(() => {
    if (invalidPermissions.length > 0)
      onInvalidPermissions?.(invalidPermissions);
  }, [invalidPermissions, onInvalidPermissions]);

  const value = useMemo(
    () => ({ rbac, subject, invalidPermissions }),
    [rbac, subject, invalidPermissions]
  );

  return <RBACContext.Provider value={value}>{children}</RBACContext.Provider>;
}

export function useRBAC(): RBACContextValue & {
  can: (
    resource: string,
    action: string,
    resourceInstance?: Resource
  ) => boolean;
} {
  const ctx = useContext(RBACContext);
  if (!ctx) {
    throw new Error("useRBAC must be used within an RBACProvider");
  }

  return {
    ...ctx,
    can: (resource, action, resourceInstance) =>
      ctx.rbac.can(ctx.subject, action, resourceInstance ?? resource),
  };
}

export function useCan(
  resource: string,
  action: string,
  resourceInstance?: Resource
): boolean {
  const { can } = useRBAC();
  return can(resource, action, resourceInstance);
}

/** Includes inherited roles when the provider was given a role config. */
export function useRole(roleName: string): boolean {
  const { rbac, subject } = useRBAC();
  return rbac.hasRole(subject, roleName);
}
