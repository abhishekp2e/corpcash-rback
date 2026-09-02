import type { PolicyContext, PolicyFn } from "../types/index.js";
import { formatPermission } from "../permissions/parse.js";

export class PolicyEvaluator {
  private policies = new Map<string, PolicyFn>();

  register(key: string, fn: PolicyFn): void {
    this.policies.set(key, fn);
  }

  registerFor(resource: string, action: string, fn: PolicyFn): void {
    this.register(formatPermission(resource, action), fn);
  }

  evaluate(ctx: PolicyContext): boolean {
    const resourceType = ctx.resourceType;
    const action = ctx.action;

    const keys = [
      formatPermission(resourceType, action),
      formatPermission(resourceType, "*"),
      formatPermission("*", action),
      "*:*",
    ];

    for (const key of keys) {
      const policy = this.policies.get(key);
      if (policy) {
        const result = policy(ctx);
        if (!result) return false;
      }
    }

    return true;
  }

  hasPolicies(): boolean {
    return this.policies.size > 0;
  }
}
