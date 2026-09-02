import type {
  Action,
  AuthorizationRequest,
  AuthorizationResult,
  PolicyFn,
  RBACConfig,
  Resource,
  Subject,
} from "./types/index.js";
import { getResourceType } from "./types/index.js";
import {
  matchDirectPermissions,
  matchPermissionForSubject,
  resolvePermissionsForRoles,
} from "./engine/permission-resolver.js";
import { PolicyEvaluator } from "./policy/evaluator.js";
import { permissionToString } from "./matcher/wildcard.js";

export class RBAC {
  private readonly config: RBACConfig;
  private readonly policyEvaluator: PolicyEvaluator;
  private readonly permissionOnlyMode: boolean;

  constructor(config: RBACConfig) {
    this.config = config;
    this.policyEvaluator = new PolicyEvaluator();
    this.permissionOnlyMode =
      !!config.permissions && Object.keys(config.roles ?? {}).length === 0;
  }

  registerPolicy(key: string, fn: PolicyFn): void {
    this.policyEvaluator.register(key, fn);
  }

  registerPolicyFor(
    resource: string,
    action: string,
    fn: PolicyFn
  ): void {
    this.policyEvaluator.registerFor(resource, action, fn);
  }

  can(subject: Subject, action: Action, resource: Resource): boolean {
    return this.authorize({ subject, action, resource }).allowed;
  }

  authorize(request: AuthorizationRequest): AuthorizationResult {
    const { subject, action, resource, context } = request;
    const resourceType = getResourceType(resource);

    if (!subject?.id) {
      return {
        allowed: false,
        reason: "NO_SUBJECT",
        resource: resourceType,
        action,
      };
    }

    let permissionMatch;

    if (this.permissionOnlyMode && this.config.permissions) {
      permissionMatch = matchDirectPermissions(
        this.config.permissions,
        resourceType,
        action
      );
    } else if (this.config.roles) {
      permissionMatch = matchPermissionForSubject(
        subject.roles,
        this.config.roles,
        resourceType,
        action
      );
    } else {
      permissionMatch = { matched: false };
    }

    if (!permissionMatch.matched) {
      return {
        allowed: false,
        reason: "MISSING_PERMISSION",
        resource: resourceType,
        action,
      };
    }

    const policyAllowed = this.policyEvaluator.evaluate({
      subject,
      action,
      resource,
      resourceType,
      context,
    });

    if (!policyAllowed) {
      return {
        allowed: false,
        reason: "POLICY_DENIED",
        resource: resourceType,
        action,
        matchedRole: permissionMatch.matchedRole,
        matchedPermission: permissionMatch.matchedPermission,
      };
    }

    return {
      allowed: true,
      reason: "AUTHORIZED",
      resource: resourceType,
      action,
      matchedRole: permissionMatch.matchedRole,
      matchedPermission: permissionMatch.matchedPermission,
    };
  }

  /** Expand all effective permissions for a subject (useful for frontend API) */
  getEffectivePermissions(subject: Subject): string[] {
    if (this.permissionOnlyMode && this.config.permissions) {
      return [...this.config.permissions];
    }

    if (!this.config.roles) return [];

    const rolePermissions = resolvePermissionsForRoles(
      subject.roles,
      this.config.roles
    );

    const seen = new Set<string>();
    const result: string[] = [];

    for (const { permissions } of rolePermissions) {
      for (const p of permissions) {
        const key = permissionToString(p);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(key);
        }
      }
    }

    return result;
  }
}
