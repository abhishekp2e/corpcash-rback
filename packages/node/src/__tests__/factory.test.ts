import { describe, it, expect, vi, beforeEach } from "vitest";
import { RBAC } from "@corpcash/rbac-core";
import { createRBAC } from "../create-rbac.js";
import {
  createForbiddenResponse,
  createUnauthorizedResponse,
} from "../errors/forbidden.js";
import {
  resetResourceWarnings,
  warnResourceTypeMismatch,
} from "../resource.js";

describe("createRBAC", () => {
  it("builds a working engine", () => {
    const rbac = createRBAC({
      roles: { viewer: { permissions: ["wallet:read"] } },
    });

    expect(rbac).toBeInstanceOf(RBAC);
    expect(rbac.can({ id: "1", roles: ["viewer"] }, "read", "wallet")).toBe(
      true
    );
  });
});

describe("error responses", () => {
  it("builds a forbidden body carrying the deny reason", () => {
    expect(createForbiddenResponse(undefined, "MISSING_PERMISSION")).toEqual({
      statusCode: 403,
      error: "Forbidden",
      message: "You do not have permission to perform this action.",
      reason: "MISSING_PERMISSION",
    });
  });

  it("builds an unauthorized body", () => {
    expect(createUnauthorizedResponse("Log in first.")).toEqual({
      statusCode: 401,
      error: "Unauthorized",
      message: "Log in first.",
    });
  });
});

describe("resource type mismatch warnings", () => {
  beforeEach(() => resetResourceWarnings());

  it("warns once per declared/actual pair", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnResourceTypeMismatch("report", "wallet");
    warnResourceTypeMismatch("report", "wallet");
    warnResourceTypeMismatch("report", "transaction");

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
