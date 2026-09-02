export class CircularRoleInheritanceError extends Error {
  constructor(cycle: string[]) {
    super(`Circular role inheritance detected: ${cycle.join(" -> ")}`);
    this.name = "CircularRoleInheritanceError";
  }
}

export class UnknownRoleError extends Error {
  readonly role: string;

  constructor(role: string) {
    super(`Unknown role: "${role}"`);
    this.name = "UnknownRoleError";
    this.role = role;
  }
}

export class InvalidPermissionError extends Error {
  readonly permission: string;

  constructor(permission: string, origin?: string) {
    super(
      `Invalid permission format: "${permission}"${origin ? ` in ${origin}` : ""}. ` +
        `Expected "resource:action" (e.g. "wallet:read").`
    );
    this.name = "InvalidPermissionError";
    this.permission = permission;
  }
}

export class InvalidRBACConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRBACConfigError";
  }
}

/**
 * Thrown when a policy returns a promise on the synchronous path. Async
 * policies are supported through `authorizeAsync` / `canAsync`.
 */
export class AsyncPolicyError extends Error {
  readonly policyKey: string;

  constructor(policyKey: string) {
    super(
      `Policy "${policyKey}" returned a promise. Use authorizeAsync()/canAsync() ` +
        `for async policies, or register a synchronous policy.`
    );
    this.name = "AsyncPolicyError";
    this.policyKey = policyKey;
  }
}
