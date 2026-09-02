import { bench, describe } from "vitest";
import { RBAC } from "../rbac.js";

const roles: Record<string, { permissions: string[]; inherits?: string[] }> = {
  viewer: { permissions: ["wallet:read", "transaction:read"] },
};

// A deliberately deep chain: the cost of re-resolving this on every request is
// exactly what the compiled-role cache exists to avoid.
for (let i = 0; i < 20; i++) {
  roles[`role_${i}`] = {
    permissions: [`resource_${i}:read`, `resource_${i}:write`],
    inherits: [i === 0 ? "viewer" : `role_${i - 1}`],
  };
}

const rbac = new RBAC({ roles });
const subject = { id: "u1", roles: ["role_19"] };

describe("authorize", () => {
  bench("hit on the most-derived role", () => {
    rbac.can(subject, "read", "resource_19");
  });

  bench("hit on the deepest inherited role", () => {
    rbac.can(subject, "read", "wallet");
  });

  bench("miss (default deny)", () => {
    rbac.can(subject, "delete", "wallet");
  });

  bench("expand effective permissions", () => {
    rbac.getEffectivePermissions(subject);
  });
});
