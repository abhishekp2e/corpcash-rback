import type {
  Action,
  AuthorizationRequest,
  AuthorizationResult,
  DecisionListener,
  ParsedPermission,
  PolicyContext,
  PolicyFn,
  RBACConfig,
  Resource,
  Subject,
} from "./types/index.js";
import { getResourceType } from "./types/index.js";
import {
  CompiledRoles,
  matchDirectPermissions,
  type RoleMatch,
} from "./engine/permission-resolver.js";
import { PolicyEvaluator } from "./policy/evaluator.js";
import {
  formatPermission,
  normalizePermissionsLenient,
} from "./permissions/parse.js";
import { InvalidRBACConfigError } from "./errors.js";

interface PreparedRequest {
  /** Set when the decision needs no policy evaluation. */
  result?: AuthorizationResult;
  context?: PolicyContext;
  match?: RoleMatch;
  resourceType?: string;
}

export class RBAC {
  private readonly compiledRoles?: CompiledRoles;
  private readonly directPermissions?: ParsedPermission[];
  private readonly policyEvaluator = new PolicyEvaluator();
  private readonly onDecision?: DecisionListener;
  /** Entries of `config.permissions` that were not valid `resource:action` strings. */
  readonly invalidPermissions: readonly string[];

  constructor(config: RBACConfig) {
    const roles = config.roles ?? {};
    const hasRoles = Object.keys(roles).length > 0;

    if (hasRoles && config.permissions) {
      throw new InvalidRBACConfigError(
        "Provide either `roles` or `permissions`, not both. " +
          "`permissions` is the permission-only mode used on the frontend."
      );
    }

    if (hasRoles) {
      this.compiledRoles = new CompiledRoles(
        roles,
        config.strictRoles ?? false
      );
    }

    if (config.permissions) {
      const { parsed, invalid } = normalizePermissionsLenient(
        config.permissions
      );
      this.directPermissions = parsed;
      this.invalidPermissions = invalid;
    } else {
      this.invalidPermissions = [];
    }

    this.onDecision = config.onDecision;
  }

  registerPolicy(key: string, fn: PolicyFn): void {
    this.policyEvaluator.register(key, fn);
  }

  registerPolicyFor(resource: string, action: string, fn: PolicyFn): void {
    this.policyEvaluator.registerFor(resource, action, fn);
  }

  can(subject: Subject, action: Action, resource: Resource): boolean {
    return this.authorize({ subject, action, resource }).allowed;
  }

  async canAsync(
    subject: Subject,
    action: Action,
    resource: Resource
  ): Promise<boolean> {
    const result = await this.authorizeAsync({ subject, action, resource });
    return result.allowed;
  }

  /**
   * Synchronous decision. Throws `AsyncPolicyError` if a matching policy is
   * async — use `authorizeAsync` when policies need to await anything.
   */
  authorize(request: AuthorizationRequest): AuthorizationResult {
    const startedAt = this.now();
    const prepared = this.prepare(request);

    if (prepared.result) return this.emit(request, prepared.result, startedAt);

    const allowed = this.policyEvaluator.evaluateSync(prepared.context!);
    return this.emit(request, this.applyPolicy(prepared, allowed), startedAt);
  }

  /** Decision that awaits async policies (ownership lookups, feature flags, …). */
  async authorizeAsync(
    request: AuthorizationRequest
  ): Promise<AuthorizationResult> {
    const startedAt = this.now();
    const prepared = this.prepare(request);

    if (prepared.result) return this.emit(request, prepared.result, startedAt);

    const allowed = await this.policyEvaluator.evaluateAsync(prepared.context!);
    return this.emit(request, this.applyPolicy(prepared, allowed), startedAt);
  }

  /** Every role a subject holds, including inherited ones. */
  getEffectiveRoles(subject: Subject): string[] {
    if (!this.compiledRoles) return [...subject.roles];
    return [...this.compiledRoles.closureFor(subject.roles).order];
  }

  hasRole(subject: Subject, role: string): boolean {
    return this.getEffectiveRoles(subject).includes(role);
  }

  /**
   * Expands all permissions a subject holds, for handing to a frontend.
   * Policies are not applied, so the list is an upper bound: the backend can
   * still deny an action that appears here.
   */
  getEffectivePermissions(subject: Subject): string[] {
    if (this.directPermissions) {
      return this.directPermissions.map((p) =>
        formatPermission(p.resource, p.action)
      );
    }

    if (!this.compiledRoles) return [];

    return this.compiledRoles.effectivePermissions(subject.roles);
  }

  private prepare(request: AuthorizationRequest): PreparedRequest {
    const { subject, action, resource, context } = request;
    const resourceType = getResourceType(resource);

    if (!subject?.id) {
      return {
        result: {
          allowed: false,
          reason: "NO_SUBJECT",
          resource: resourceType,
          action,
        },
      };
    }

    const match = this.matchPermission(subject, resourceType, action);

    if (!match.matched) {
      return {
        result: this.withIgnoredRoles(
          {
            allowed: false,
            reason: "MISSING_PERMISSION",
            resource: resourceType,
            action,
          },
          match
        ),
      };
    }

    if (!this.policyEvaluator.hasPolicies()) {
      return { result: this.allowedResult(resourceType, action, match) };
    }

    return {
      match,
      resourceType,
      context: { subject, action, resource, resourceType, context },
    };
  }

  private matchPermission(
    subject: Subject,
    resourceType: string,
    action: Action
  ): RoleMatch {
    if (this.directPermissions) {
      return {
        ...matchDirectPermissions(this.directPermissions, resourceType, action),
        ignoredRoles: [],
      };
    }

    if (this.compiledRoles) {
      return this.compiledRoles.match(subject.roles, resourceType, action);
    }

    return { matched: false, ignoredRoles: [] };
  }

  private applyPolicy(
    prepared: PreparedRequest,
    allowed: boolean
  ): AuthorizationResult {
    const match = prepared.match!;
    const resourceType = prepared.resourceType!;
    const action = prepared.context!.action;

    if (allowed) return this.allowedResult(resourceType, action, match);

    return this.withIgnoredRoles(
      {
        allowed: false,
        reason: "POLICY_DENIED",
        resource: resourceType,
        action,
        matchedRole: match.matchedRole,
        matchedPermission: match.matchedPermission,
      },
      match
    );
  }

  private allowedResult(
    resourceType: string,
    action: Action,
    match: RoleMatch
  ): AuthorizationResult {
    return this.withIgnoredRoles(
      {
        allowed: true,
        reason: "AUTHORIZED",
        resource: resourceType,
        action,
        matchedRole: match.matchedRole,
        matchedPermission: match.matchedPermission,
      },
      match
    );
  }

  private withIgnoredRoles(
    result: AuthorizationResult,
    match?: RoleMatch
  ): AuthorizationResult {
    if (!match?.ignoredRoles.length) return result;
    return { ...result, ignoredRoles: match.ignoredRoles };
  }

  private now(): number {
    return this.onDecision ? Date.now() : 0;
  }

  private emit(
    request: AuthorizationRequest,
    result: AuthorizationResult,
    startedAt: number
  ): AuthorizationResult {
    if (!this.onDecision) return result;

    try {
      this.onDecision({
        request,
        result,
        durationMs: Date.now() - startedAt,
      });
    } catch {
      // A failing audit sink must never change the decision.
    }

    return result;
  }
}
