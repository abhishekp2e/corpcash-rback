import { describe, it, expect, vi } from "vitest";
import { RBAC } from "../rbac.js";
import {
  AsyncPolicyError,
  CircularRoleInheritanceError,
  InvalidPermissionError,
  InvalidRBACConfigError,
  UnknownRoleError,
} from "../errors.js";
import { parsePermission, tryParsePermission } from "../permissions/parse.js";
import { matchesPermission } from "../matcher/wildcard.js";

const admin = { id: "admin-user", roles: ["admin"] };
const developer = { id: "dev-user", roles: ["developer"] };
const viewer = { id: "viewer-user", roles: ["viewer"] };
const multiRole = { id: "multi", roles: ["viewer", "developer"] };

const rbacConfig = {
  roles: {
    viewer: {
      permissions: ["wallet:read", "transaction:read"],
    },
    developer: {
      inherits: ["viewer"],
      permissions: ["wallet:create", "wallet:update", "contract:deploy"],
    },
    admin: {
      permissions: ["*:*"],
    },
  },
};

describe("parsePermission", () => {
  it("parses resource:action strings", () => {
    expect(parsePermission("wallet:read")).toEqual({
      resource: "wallet",
      action: "read",
    });
  });

  it("parses wildcards", () => {
    expect(parsePermission("wallet:*")).toEqual({
      resource: "wallet",
      action: "*",
    });
    expect(parsePermission("*:read")).toEqual({
      resource: "*",
      action: "read",
    });
    expect(parsePermission("*:*")).toEqual({
      resource: "*",
      action: "*",
    });
  });

  it("throws InvalidPermissionError on bad format", () => {
    expect(() => parsePermission("invalid")).toThrow(InvalidPermissionError);
    expect(() => parsePermission("a:b:c")).toThrow(InvalidPermissionError);
  });

  it("names the origin so bad config points at the role", () => {
    expect(() => parsePermission("nope", 'role "viewer"')).toThrow(
      /role "viewer"/
    );
  });

  it("tryParsePermission returns undefined instead of throwing", () => {
    expect(tryParsePermission("nope")).toBeUndefined();
    expect(tryParsePermission("wallet:read")).toEqual({
      resource: "wallet",
      action: "read",
    });
  });
});

describe("wildcard matching", () => {
  it("matches exact permissions", () => {
    expect(
      matchesPermission(
        { resource: "wallet", action: "read" },
        "wallet",
        "read"
      )
    ).toBe(true);
  });

  it("matches resource wildcard", () => {
    expect(
      matchesPermission({ resource: "wallet", action: "*" }, "wallet", "delete")
    ).toBe(true);
  });

  it("matches action wildcard", () => {
    expect(
      matchesPermission(
        { resource: "*", action: "read" },
        "transaction",
        "read"
      )
    ).toBe(true);
  });

  it("matches full wildcard", () => {
    expect(
      matchesPermission({ resource: "*", action: "*" }, "anything", "anything")
    ).toBe(true);
  });

  it("denies non-matching permissions", () => {
    expect(
      matchesPermission(
        { resource: "wallet", action: "read" },
        "wallet",
        "delete"
      )
    ).toBe(false);
  });
});

describe("RBAC engine", () => {
  const rbac = new RBAC(rbacConfig);

  it("allows permitted actions", () => {
    expect(rbac.can(viewer, "read", "wallet")).toBe(true);
  });

  it("denies missing permissions (default deny)", () => {
    expect(rbac.can(viewer, "delete", "wallet")).toBe(false);
  });

  it("supports admin wildcard", () => {
    expect(rbac.can(admin, "delete", "wallet")).toBe(true);
    expect(rbac.can(admin, "deploy", "contract")).toBe(true);
  });

  it("supports role inheritance", () => {
    expect(rbac.can(developer, "read", "wallet")).toBe(true);
    expect(rbac.can(developer, "create", "wallet")).toBe(true);
    expect(rbac.can(developer, "delete", "wallet")).toBe(false);
  });

  it("supports multiple roles", () => {
    expect(rbac.can(multiRole, "create", "wallet")).toBe(true);
    expect(rbac.can(multiRole, "read", "transaction")).toBe(true);
  });

  it("returns explainable authorization results", () => {
    const allowed = rbac.authorize({
      subject: developer,
      action: "deploy",
      resource: "contract",
    });
    expect(allowed).toMatchObject({
      allowed: true,
      reason: "AUTHORIZED",
      matchedRole: "developer",
      matchedPermission: "contract:deploy",
    });

    const denied = rbac.authorize({
      subject: viewer,
      action: "delete",
      resource: "wallet",
    });
    expect(denied).toMatchObject({
      allowed: false,
      reason: "MISSING_PERMISSION",
    });
  });

  it("denies when no subject", () => {
    const result = rbac.authorize({
      subject: { id: "", roles: [] },
      action: "read",
      resource: "wallet",
    });
    expect(result.reason).toBe("NO_SUBJECT");
  });

  it("reads the resource type from a resource instance", () => {
    expect(rbac.can(viewer, "read", { type: "wallet", id: "w1" })).toBe(true);
  });

  it("resolves repeated role combinations consistently (closure cache)", () => {
    const cached = new RBAC(rbacConfig);
    for (let i = 0; i < 3; i++) {
      expect(cached.can(multiRole, "deploy", "contract")).toBe(true);
      expect(cached.can(multiRole, "delete", "wallet")).toBe(false);
    }
  });

  it("resolves diamond inheritance without duplicating permissions", () => {
    const diamond = new RBAC({
      roles: {
        base: { permissions: ["wallet:read"] },
        left: { inherits: ["base"], permissions: ["wallet:create"] },
        right: { inherits: ["base"], permissions: ["wallet:update"] },
        top: { inherits: ["left", "right"] },
      },
    });

    const subject = { id: "u1", roles: ["top"] };
    expect(diamond.can(subject, "read", "wallet")).toBe(true);
    expect(diamond.can(subject, "update", "wallet")).toBe(true);
    expect(diamond.getEffectivePermissions(subject).sort()).toEqual([
      "wallet:create",
      "wallet:read",
      "wallet:update",
    ]);
  });
});

describe("config validation", () => {
  it("rejects circular inheritance at construction", () => {
    expect(
      () =>
        new RBAC({
          roles: {
            a: { inherits: ["b"], permissions: [] },
            b: { inherits: ["a"], permissions: [] },
          },
        })
    ).toThrow(CircularRoleInheritanceError);
  });

  it("rejects a cycle that no subject role points at", () => {
    expect(
      () =>
        new RBAC({
          roles: {
            admin: { permissions: ["*:*"] },
            a: { inherits: ["b"] },
            b: { inherits: ["a"] },
          },
        })
    ).toThrow(CircularRoleInheritanceError);
  });

  it("rejects inheriting a role that does not exist", () => {
    expect(
      () => new RBAC({ roles: { admin: { inherits: ["ghost"] } } })
    ).toThrow(InvalidRBACConfigError);
  });

  it("rejects a malformed permission in a role", () => {
    expect(
      () => new RBAC({ roles: { admin: { permissions: ["wallet-read"] } } })
    ).toThrow(InvalidPermissionError);
  });

  it("rejects roles and permissions supplied together", () => {
    expect(
      () =>
        new RBAC({
          roles: { viewer: { permissions: ["wallet:read"] } },
          permissions: ["wallet:delete"],
        })
    ).toThrow(InvalidRBACConfigError);
  });
});

describe("unknown roles", () => {
  const config = { roles: { viewer: { permissions: ["wallet:read"] } } };

  it("ignores unrecognised roles and decides on the rest", () => {
    const rbac = new RBAC(config);
    const stale = { id: "u1", roles: ["viewer", "legacy_ops"] };

    expect(rbac.can(stale, "read", "wallet")).toBe(true);
    expect(rbac.can(stale, "delete", "wallet")).toBe(false);
  });

  it("reports which roles were ignored", () => {
    const rbac = new RBAC(config);
    const result = rbac.authorize({
      subject: { id: "u1", roles: ["viewer", "legacy_ops"] },
      action: "read",
      resource: "wallet",
    });

    expect(result.allowed).toBe(true);
    expect(result.ignoredRoles).toEqual(["legacy_ops"]);
  });

  it("denies a subject whose roles are all unrecognised", () => {
    const rbac = new RBAC(config);
    const result = rbac.authorize({
      subject: { id: "u1", roles: ["ghost"] },
      action: "read",
      resource: "wallet",
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("MISSING_PERMISSION");
  });

  it("throws under strictRoles", () => {
    const rbac = new RBAC({ ...config, strictRoles: true });
    expect(() =>
      rbac.can({ id: "u1", roles: ["ghost"] }, "read", "wallet")
    ).toThrow(UnknownRoleError);
  });
});

describe("policies", () => {
  it("denies when a policy fails after a permission match", () => {
    const rbac = new RBAC(rbacConfig);
    rbac.registerPolicyFor("wallet", "delete", ({ subject, resource }) => {
      if (typeof resource === "object" && "ownerId" in resource) {
        return subject.id === resource.ownerId;
      }
      return false;
    });

    const owner = { id: "abhishek", roles: ["admin"] };
    const other = { id: "rahul", roles: ["admin"] };
    const wallet = { type: "wallet", id: "wallet_123", ownerId: "abhishek" };

    expect(rbac.can(owner, "delete", wallet)).toBe(true);
    expect(rbac.can(other, "delete", wallet)).toBe(false);

    const result = rbac.authorize({
      subject: other,
      action: "delete",
      resource: wallet,
    });
    expect(result.reason).toBe("POLICY_DENIED");
    expect(result.matchedPermission).toBe("*:*");
  });

  it("cannot grant what the permissions did not", () => {
    const rbac = new RBAC(rbacConfig);
    rbac.registerPolicyFor("wallet", "delete", () => true);

    expect(rbac.can(viewer, "delete", "wallet")).toBe(false);
  });

  it("requires every matching policy to pass", () => {
    const rbac = new RBAC(rbacConfig);
    rbac.registerPolicyFor("wallet", "read", () => true);
    rbac.registerPolicy("*:*", () => false);

    expect(rbac.can(viewer, "read", "wallet")).toBe(false);
  });

  it("awaits async policies through authorizeAsync", async () => {
    const rbac = new RBAC(rbacConfig);
    const loadOwner = async (id: string) =>
      id === "wallet_123" ? "abhishek" : "someone-else";

    rbac.registerPolicyFor(
      "wallet",
      "delete",
      async ({ subject, resource }) => {
        const walletId = typeof resource === "object" ? resource.id! : "";
        return (await loadOwner(walletId)) === subject.id;
      }
    );

    const owner = { id: "abhishek", roles: ["admin"] };
    expect(
      await rbac.canAsync(owner, "delete", { type: "wallet", id: "wallet_123" })
    ).toBe(true);
    expect(
      await rbac.canAsync(owner, "delete", { type: "wallet", id: "wallet_999" })
    ).toBe(false);
  });

  it("throws AsyncPolicyError when an async policy runs on the sync path", () => {
    const rbac = new RBAC(rbacConfig);
    rbac.registerPolicyFor("wallet", "read", async () => true);

    expect(() => rbac.can(viewer, "read", "wallet")).toThrow(AsyncPolicyError);
  });

  it("passes request context to policies", () => {
    const rbac = new RBAC(rbacConfig);
    rbac.registerPolicyFor(
      "wallet",
      "read",
      ({ context }) => context?.tenantId === "t1"
    );

    expect(
      rbac.authorize({
        subject: viewer,
        action: "read",
        resource: "wallet",
        context: { tenantId: "t1" },
      }).allowed
    ).toBe(true);
    expect(
      rbac.authorize({
        subject: viewer,
        action: "read",
        resource: "wallet",
        context: { tenantId: "t2" },
      }).allowed
    ).toBe(false);
  });
});

describe("decision auditing", () => {
  it("reports every decision to onDecision", () => {
    const onDecision = vi.fn();
    const rbac = new RBAC({ ...rbacConfig, onDecision });

    rbac.can(viewer, "read", "wallet");
    rbac.can(viewer, "delete", "wallet");

    expect(onDecision).toHaveBeenCalledTimes(2);
    expect(onDecision.mock.calls[0][0]).toMatchObject({
      result: { allowed: true, reason: "AUTHORIZED", matchedRole: "viewer" },
      request: { action: "read" },
    });
    expect(onDecision.mock.calls[1][0].result).toMatchObject({
      allowed: false,
      reason: "MISSING_PERMISSION",
    });
    expect(typeof onDecision.mock.calls[0][0].durationMs).toBe("number");
  });

  it("reports async decisions too", async () => {
    const onDecision = vi.fn();
    const rbac = new RBAC({ ...rbacConfig, onDecision });
    rbac.registerPolicyFor("wallet", "read", async () => true);

    await rbac.canAsync(viewer, "read", "wallet");

    expect(onDecision).toHaveBeenCalledTimes(1);
  });

  it("never lets a failing audit sink change the decision", () => {
    const rbac = new RBAC({
      ...rbacConfig,
      onDecision: () => {
        throw new Error("logging is down");
      },
    });

    expect(rbac.can(viewer, "read", "wallet")).toBe(true);
  });
});

describe("permission-only mode (frontend)", () => {
  it("evaluates direct permissions without roles", () => {
    const rbac = new RBAC({ permissions: ["wallet:read", "wallet:create"] });
    const subject = { id: "u1", roles: [] };

    expect(rbac.can(subject, "read", "wallet")).toBe(true);
    expect(rbac.can(subject, "delete", "wallet")).toBe(false);
  });

  it("skips malformed entries instead of throwing", () => {
    const rbac = new RBAC({
      permissions: ["wallet:read", "not-a-permission", "wallet:create"],
    });
    const subject = { id: "u1", roles: [] };

    expect(rbac.invalidPermissions).toEqual(["not-a-permission"]);
    expect(rbac.can(subject, "read", "wallet")).toBe(true);
    expect(rbac.can(subject, "create", "wallet")).toBe(true);
  });

  it("denies everything when no roles and no permissions are configured", () => {
    const rbac = new RBAC({});
    expect(rbac.can({ id: "u1", roles: ["admin"] }, "read", "wallet")).toBe(
      false
    );
  });
});

describe("effective roles and permissions", () => {
  it("expands inherited permissions", () => {
    const rbac = new RBAC(rbacConfig);
    const perms = rbac.getEffectivePermissions(developer);

    expect(perms).toContain("wallet:read");
    expect(perms).toContain("wallet:create");
    expect(perms).toContain("contract:deploy");
  });

  it("expands inherited roles", () => {
    const rbac = new RBAC(rbacConfig);

    expect(rbac.getEffectiveRoles(developer).sort()).toEqual([
      "developer",
      "viewer",
    ]);
    expect(rbac.hasRole(developer, "viewer")).toBe(true);
    expect(rbac.hasRole(viewer, "developer")).toBe(false);
  });

  it("returns the direct permission list in permission-only mode", () => {
    const rbac = new RBAC({ permissions: ["wallet:read"] });
    expect(rbac.getEffectivePermissions({ id: "u1", roles: [] })).toEqual([
      "wallet:read",
    ]);
  });
});

describe("reload", () => {
  it("replaces the role graph without dropping policies or onDecision", () => {
    const onDecision = vi.fn();
    const rbac = new RBAC({ ...rbacConfig, onDecision });
    rbac.registerPolicyFor("wallet", "read", () => false);

    expect(rbac.can(viewer, "read", "wallet")).toBe(false);
    expect(onDecision).toHaveBeenCalledOnce();

    rbac.reload({
      roles: {
        viewer: { permissions: ["wallet:read", "wallet:delete"] },
      },
    });

    expect(rbac.can(viewer, "delete", "wallet")).toBe(true);
    expect(rbac.can(viewer, "read", "wallet")).toBe(false);
    expect(onDecision).toHaveBeenCalledTimes(3);
  });

  it("leaves the previous compiled state when the new config is invalid", () => {
    const rbac = new RBAC(rbacConfig);

    expect(() =>
      rbac.reload({
        roles: {
          child: { inherits: ["missing"], permissions: ["wallet:read"] },
        },
      })
    ).toThrow(InvalidRBACConfigError);

    expect(rbac.can(viewer, "read", "wallet")).toBe(true);
    expect(rbac.can(developer, "create", "wallet")).toBe(true);
  });

  it("can switch from roles to permission-only mode", () => {
    const rbac = new RBAC(rbacConfig);
    rbac.reload({ permissions: ["wallet:read"] });

    const subject = { id: "u1", roles: ["admin"] };
    expect(rbac.can(subject, "read", "wallet")).toBe(true);
    expect(rbac.can(subject, "delete", "wallet")).toBe(false);
  });
});
