import { describe, it, expect } from "vitest";
import { RBAC } from "../rbac.js";
import {
  CircularRoleInheritanceError,
  UnknownRoleError,
} from "../roles/inheritance.js";
import { parsePermission } from "../permissions/parse.js";
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

  it("throws on invalid format", () => {
    expect(() => parsePermission("invalid")).toThrow();
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
      matchesPermission({ resource: "*", action: "read" }, "transaction", "read")
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
});

describe("role inheritance", () => {
  it("detects circular inheritance", () => {
    expect(
      () =>
        new RBAC({
          roles: {
            a: { inherits: ["b"], permissions: [] },
            b: { inherits: ["a"], permissions: [] },
          },
        })
    ).not.toThrow();

    const rbac = new RBAC({
      roles: {
        a: { inherits: ["b"], permissions: [] },
        b: { inherits: ["a"], permissions: [] },
      },
    });

    expect(() =>
      rbac.can({ id: "u1", roles: ["a"] }, "read", "wallet")
    ).toThrow(CircularRoleInheritanceError);
  });

  it("throws on unknown role", () => {
    const rbac = new RBAC({ roles: { admin: { permissions: ["*:*"] } } });
    expect(() =>
      rbac.can({ id: "u1", roles: ["unknown"] }, "read", "wallet")
    ).toThrow(UnknownRoleError);
  });
});

describe("policies", () => {
  it("denies when policy fails after permission match", () => {
    const rbac = new RBAC(rbacConfig);
    rbac.registerPolicyFor("wallet", "delete", ({ subject, resource }) => {
      if (typeof resource === "object" && "ownerId" in resource) {
        return subject.id === resource.ownerId;
      }
      return false;
    });

    const owner = { id: "abhishek", roles: ["admin"] };
    const other = { id: "rahul", roles: ["admin"] };
    const wallet = {
      type: "wallet",
      id: "wallet_123",
      ownerId: "abhishek",
    };

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
});

describe("permission-only mode (frontend)", () => {
  it("evaluates direct permissions without roles", () => {
    const rbac = new RBAC({
      permissions: ["wallet:read", "wallet:create"],
    });

    const subject = { id: "u1", roles: [] };
    expect(rbac.can(subject, "read", "wallet")).toBe(true);
    expect(rbac.can(subject, "delete", "wallet")).toBe(false);
  });
});

describe("getEffectivePermissions", () => {
  it("expands inherited permissions", () => {
    const rbac = new RBAC(rbacConfig);
    const perms = rbac.getEffectivePermissions(developer);
    expect(perms).toContain("wallet:read");
    expect(perms).toContain("wallet:create");
    expect(perms).toContain("contract:deploy");
  });
});
