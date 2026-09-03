import { describe, expect, it } from "vitest";
import { InvalidRBACConfigError } from "@corpcash/rbac-core";
import { memoryStore } from "../memory.js";
import { createStoreSubjectResolver } from "../create-from-store.js";
import { assertSafeIdent, tableNames } from "../ident.js";
import { nextRolesAfterDelete } from "../validate.js";
import { describeStoreContract } from "./contract.js";

describe("memoryStore", () => {
  describeStoreContract("memoryStore", () => memoryStore());

  it("accepts an initial config and constructs a subject resolver", async () => {
    const store = memoryStore({
      roles: { viewer: { permissions: ["wallet:read"] } },
    });
    await store.assignRole("u1", "viewer");

    const resolve = createStoreSubjectResolver(
      store,
      (header: string | undefined) => header
    );

    await expect(resolve("u1")).resolves.toEqual({
      id: "u1",
      roles: ["viewer"],
    });
    await expect(resolve(undefined)).resolves.toBeNull();
  });

  it("rejects an empty role name and a bad initial graph", async () => {
    expect(() =>
      memoryStore({
        roles: { child: { inherits: ["missing"] } },
      })
    ).toThrow(InvalidRBACConfigError);

    const store = memoryStore({
      roles: { viewer: { permissions: ["wallet:read"] } },
    });
    await expect(store.upsertRole("  ", { permissions: [] })).rejects.toThrow(
      InvalidRBACConfigError
    );
    await store.updateSettings({});
    expect(await store.getSettings()).toEqual({ strictRoles: false });
  });
});

describe("validate helpers", () => {
  it("treats deleting an unknown role as a no-op on the graph", () => {
    expect(nextRolesAfterDelete({}, "ghost")).toEqual({});
  });
});

describe("idents", () => {
  it("accepts a safe prefix and rejects injection", () => {
    expect(tableNames("auth_").roles).toBe("auth_roles");
    expect(() => assertSafeIdent("rbac;", "table prefix")).toThrow(
      /Invalid table prefix/
    );
  });
});
