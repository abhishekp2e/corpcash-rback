export type Action = string;

export interface ResourceInstance {
  type: string;
  id?: string;
  [key: string]: unknown;
}

export type Resource = string | ResourceInstance;

export interface Subject {
  id: string;
  roles: string[];
  attributes?: Record<string, unknown>;
}

export interface RoleDefinition {
  permissions?: string[];
  inherits?: string[];
}

export interface ParsedPermission {
  resource: string;
  action: string;
}

export interface RBACConfig {
  roles?: Record<string, RoleDefinition>;
  /** Direct permissions for frontend permission-only mode */
  permissions?: string[];
}

export interface AuthorizationRequest {
  subject: Subject;
  action: Action;
  resource: Resource;
  context?: Record<string, unknown>;
}

export type AuthorizationReason =
  | "AUTHORIZED"
  | "MISSING_PERMISSION"
  | "POLICY_DENIED"
  | "NO_SUBJECT";

export interface AuthorizationResult {
  allowed: boolean;
  reason: AuthorizationReason;
  resource: string;
  action: string;
  matchedRole?: string;
  matchedPermission?: string;
}

export interface PolicyContext {
  subject: Subject;
  action: Action;
  resource: Resource;
  resourceType: string;
  context?: Record<string, unknown>;
}

export type PolicyFn = (ctx: PolicyContext) => boolean;

export interface PermissionMatch {
  matched: boolean;
  matchedRole?: string;
  matchedPermission?: string;
}

export function getResourceType(resource: Resource): string {
  return typeof resource === "string" ? resource : resource.type;
}
