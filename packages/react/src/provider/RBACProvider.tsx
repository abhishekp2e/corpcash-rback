import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { RBAC, type Resource, type Subject } from "@corpcash/rbac-core";

export interface RBACContextValue {
  rbac: RBAC;
  subject: Subject;
}

export interface RBACProviderProps {
  subject: Subject;
  permissions?: string[];
  roles?: Record<string, { permissions?: string[]; inherits?: string[] }>;
  policies?: never;
  children: ReactNode;
}

const RBACContext = createContext<RBACContextValue | null>(null);

export function RBACProvider({
  subject,
  permissions,
  roles,
  children,
}: RBACProviderProps) {
  const rbac = useMemo(() => {
    if (permissions) {
      return new RBAC({ permissions });
    }
    if (roles) {
      return new RBAC({ roles });
    }
    return new RBAC({ permissions: [] });
  }, [permissions, roles]);

  const value = useMemo(
    () => ({ rbac, subject }),
    [rbac, subject]
  );

  return (
    <RBACContext.Provider value={value}>{children}</RBACContext.Provider>
  );
}

export function useRBAC(): RBACContextValue & {
  can: (resource: string, action: string, resourceInstance?: Resource) => boolean;
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

export function useRole(roleName: string): boolean {
  const { subject } = useRBAC();
  return subject.roles.includes(roleName);
}
