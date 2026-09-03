import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { createRBACFromStore, memoryStore } from "@corpcash/rbac-store";
import { RbacAdminController } from "../nestjs/admin.js";

const seed = {
  roles: {
    viewer: { permissions: ["wallet:read"] },
    admin: { permissions: ["*:*"] },
  },
};

describe("RbacAdminController", () => {
  async function setup() {
    const store = memoryStore();
    await store.migrate();
    await store.seed(seed);
    const rbac = await createRBACFromStore(store);
    return { controller: new RbacAdminController(rbac, store), store, rbac };
  }

  it("lists and mutates roles", async () => {
    const { controller, rbac } = await setup();

    const roles = await controller.listRoles();
    expect(roles.map((role) => role.name)).toEqual(
      expect.arrayContaining(["admin", "viewer"])
    );

    const created = await controller.create({
      name: "auditor",
      permissions: ["wallet:read"],
    });
    expect(created.name).toBe("auditor");
    expect(rbac.can({ id: "u", roles: ["auditor"] }, "read", "wallet")).toBe(
      true
    );

    await expect(controller.get("auditor")).resolves.toMatchObject({
      name: "auditor",
    });
    await expect(controller.get("ghost")).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(
      controller.create({ name: "auditor", permissions: ["wallet:read"] })
    ).rejects.toBeInstanceOf(BadRequestException);

    await controller.replace("auditor", {
      permissions: ["wallet:read", "wallet:delete"],
    });
    expect(rbac.can({ id: "u", roles: ["auditor"] }, "delete", "wallet")).toBe(
      true
    );

    await controller.remove("auditor");
    expect(rbac.can({ id: "u", roles: ["auditor"] }, "read", "wallet")).toBe(
      false
    );

    await expect(controller.create({ name: "" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(
      controller.replace("viewer", { inherits: ["missing"] })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.remove("ghost")).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(
      controller.assign("dev-1", { role: "ghost" })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rethrows unexpected store errors", async () => {
    const { controller, store } = await setup();
    store.listRoles = async () => {
      throw new Error("db down");
    };
    await expect(controller.listRoles()).rejects.toThrow("db down");
    store.updateSettings = async () => {
      throw new Error("db down");
    };
    await expect(
      controller.patchSettings({ strictRoles: true })
    ).rejects.toThrow("db down");
  });

  it("manages assignments and settings", async () => {
    const { controller } = await setup();

    await expect(
      controller.assign("dev-1", { role: "viewer" })
    ).resolves.toEqual({ subjectId: "dev-1", roles: ["viewer"] });
    await expect(controller.listAssignments("dev-1")).resolves.toEqual({
      subjectId: "dev-1",
      roles: ["viewer"],
    });
    await expect(
      controller.replaceAssignments("dev-1", { roles: ["admin"] })
    ).resolves.toEqual({ subjectId: "dev-1", roles: ["admin"] });
    await expect(
      controller.replaceAssignments("dev-1", { roles: ["ghost"] })
    ).rejects.toBeInstanceOf(BadRequestException);

    await controller.revoke("dev-1", "admin");
    await expect(controller.listAssignments("dev-1")).resolves.toEqual({
      subjectId: "dev-1",
      roles: [],
    });

    await expect(controller.getSettings()).resolves.toEqual({
      strictRoles: false,
    });
    await expect(
      controller.patchSettings({ strictRoles: true })
    ).resolves.toEqual({ strictRoles: true });
  });
});
