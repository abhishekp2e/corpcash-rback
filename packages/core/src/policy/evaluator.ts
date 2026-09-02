import type { PolicyContext, PolicyFn } from "../types/index.js";
import { formatPermission } from "../permissions/parse.js";
import { AsyncPolicyError } from "../errors.js";

function isThenable(value: unknown): value is Promise<boolean> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Policies narrow an existing grant: they run only after a permission matched,
 * and every policy whose key matches the request must pass. A policy can never
 * grant something the permissions did not.
 */
export class PolicyEvaluator {
  private policies = new Map<string, PolicyFn>();

  register(key: string, fn: PolicyFn): void {
    this.policies.set(key, fn);
  }

  registerFor(resource: string, action: string, fn: PolicyFn): void {
    this.register(formatPermission(resource, action), fn);
  }

  hasPolicies(): boolean {
    return this.policies.size > 0;
  }

  private *matching(ctx: PolicyContext): Generator<[string, PolicyFn]> {
    const keys = [
      formatPermission(ctx.resourceType, ctx.action),
      formatPermission(ctx.resourceType, "*"),
      formatPermission("*", ctx.action),
      "*:*",
    ];

    for (const key of keys) {
      const policy = this.policies.get(key);
      if (policy) yield [key, policy];
    }
  }

  evaluateSync(ctx: PolicyContext): boolean {
    for (const [key, policy] of this.matching(ctx)) {
      const outcome = policy(ctx);
      if (isThenable(outcome)) throw new AsyncPolicyError(key);
      if (!outcome) return false;
    }

    return true;
  }

  async evaluateAsync(ctx: PolicyContext): Promise<boolean> {
    for (const [, policy] of this.matching(ctx)) {
      if (!(await policy(ctx))) return false;
    }

    return true;
  }
}
