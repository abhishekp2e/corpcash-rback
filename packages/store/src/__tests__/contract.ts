import { expect, it } from "vitest";
import {
  InvalidPermissionError,
  InvalidRBACConfigError,
  RBAC,
} from "@corpcash/rbac-core";
import type { RBACStore } from "../types.js";
import { StoreNotFoundError } from "../types.js";
import { createRBACFromStore, reloadFromStore } from "../create-from-store.js";

const seedConfig = {
  roles: {
    viewer: { permissions: ["wallet:read"] },
    developer: {
      inherits: ["viewer"],
      permissions: ["wallet:create"],
    },
    admin: { permissions: ["*:*"] },
  },
  strictRoles: false,
};

export function describeStoreContract(
  name: string,
  createStore: () => RBACStore | Promise<RBACStore>
): void {
  it(`${name} migrates, seeds once, and loads the role graph`, async () => {
    const store = await createStore();
    await store.migrate();
    await store.seed(seedConfig);
    await store.seed({
      roles: { other: { permissions: ["wallet:delete"] } },
    });

    const config = await store.loadConfig();
    expect(config.roles?.viewer?.permissions).toContain("wallet:read");
    expect(config.roles?.developer?.inherits).toContain("viewer");
    expect(config.roles?.other).toBeUndefined();
    expect(config.strictRoles).toBe(false);

    await store.close?.();
  });

  it(`${name} validates upserts and rejects a dangling inherit`, async () => {
    const store = await createStore();
    await store.migrate();
    await store.seed(seedConfig);

    await expect(
      store.upsertRole("broken", { inherits: ["missing"] })
    ).rejects.toThrow(InvalidRBACConfigError);

    await store.upsertRole("auditor", { permissions: ["wallet:read"] });
    const roles = await store.listRoles();
    expect(roles.map((role) => role.name)).toContain("auditor");

    await store.close?.();
  });

  it(`${name} rejects malformed permissions and inherited deletes`, async () => {
    const store = await createStore();
    await store.migrate();
    await store.seed(seedConfig);

    await expect(
      store.upsertRole("viewer", { permissions: ["not-a-permission"] })
    ).rejects.toThrow(InvalidPermissionError);

    await expect(store.deleteRole("viewer")).rejects.toThrow(
      InvalidRBACConfigError
    );

    await expect(store.deleteRole("ghost")).rejects.toThrow(StoreNotFoundError);

    await store.close?.();
  });

  it(`${name} assigns roles and refuses unknown or assigned deletes`, async () => {
    const store = await createStore();
    await store.migrate();
    await store.seed(seedConfig);

    await store.assignRole("dev-1", "developer");
    await expect(store.getRolesForSubject("dev-1")).resolves.toEqual([
      "developer",
    ]);

    await expect(store.assignRole("dev-1", "ghost")).rejects.toThrow(
      InvalidRBACConfigError
    );

    await store.setRolesForSubject("dev-1", ["viewer", "developer"]);
    await expect(store.getRolesForSubject("dev-1")).resolves.toEqual([
      "developer",
      "viewer",
    ]);

    await expect(store.deleteRole("developer")).rejects.toThrow(
      InvalidRBACConfigError
    );

    await store.revokeRole("dev-1", "developer");
    await store.setRolesForSubject("dev-1", ["viewer"]);
    await store.upsertRole("temp", { permissions: ["wallet:read"] });
    await store.deleteRole("temp");
    expect((await store.listRoles()).map((role) => role.name)).not.toContain(
      "temp"
    );

    await store.close?.();
  });

  it(`${name} updates settings and reloads the engine`, async () => {
    const store = await createStore();
    await store.migrate();
    await store.seed(seedConfig);

    const rbac = await createRBACFromStore(store);
    rbac.registerPolicyFor("wallet", "read", () => true);

    expect(rbac.can({ id: "u1", roles: ["viewer"] }, "read", "wallet")).toBe(
      true
    );

    await store.upsertRole("viewer", {
      permissions: ["wallet:read", "wallet:delete"],
    });
    await reloadFromStore(rbac, store);

    expect(rbac.can({ id: "u1", roles: ["viewer"] }, "delete", "wallet")).toBe(
      true
    );
    expect(rbac.can({ id: "u1", roles: ["viewer"] }, "read", "wallet")).toBe(
      true
    );

    await store.updateSettings({ strictRoles: true });
    expect(await store.getSettings()).toEqual({ strictRoles: true });
    await reloadFromStore(rbac, store);

    expect(() =>
      rbac.can({ id: "u1", roles: ["ghost"] }, "read", "wallet")
    ).toThrow();

    expect(rbac).toBeInstanceOf(RBAC);
    await store.close?.();
  });
}
