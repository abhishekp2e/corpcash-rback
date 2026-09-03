import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createRBACFromStore, memoryStore } from "@corpcash/rbac-store";
import { createRbacAdminRouter } from "../admin/express.js";
import { isClientError, statusFor } from "../admin/shared.js";

const seed = {
  roles: {
    viewer: { permissions: ["wallet:read"] },
    admin: { permissions: ["*:*"] },
  },
};

async function buildApp() {
  const store = memoryStore();
  await store.migrate();
  await store.seed(seed);
  await store.assignRole("admin-1", "admin");
  await store.assignRole("viewer-1", "viewer");
  const rbac = await createRBACFromStore(store);
  const app = express();
  app.use(express.json());
  app.use("/rbac", createRbacAdminRouter({ store, rbac }));
  return { app, store, rbac };
}

describe("admin error mapping", () => {
  it("maps unknown errors to 500", () => {
    expect(isClientError(new Error("db down"))).toBe(false);
    expect(statusFor(new Error("db down"))).toBe(500);
  });
});

describe("createRbacAdminRouter", () => {
  it("returns 401 without a subject and 403 without rbac:manage", async () => {
    const { app } = await buildApp();

    const unauthenticated = await request(app).get("/rbac/roles");
    expect(unauthenticated.status).toBe(401);

    const forbidden = await request(app)
      .get("/rbac/roles")
      .set("x-user-id", "viewer-1");
    expect(forbidden.status).toBe(403);
  });

  it("lists, creates, updates, and deletes roles then reloads the engine", async () => {
    const { app, rbac } = await buildApp();
    const asAdmin = { "x-user-id": "admin-1" };

    const listed = await request(app).get("/rbac/roles").set(asAdmin);
    expect(listed.status).toBe(200);
    expect(listed.body.map((role: { name: string }) => role.name)).toEqual(
      expect.arrayContaining(["admin", "viewer"])
    );

    const created = await request(app)
      .post("/rbac/roles")
      .set(asAdmin)
      .send({ name: "auditor", permissions: ["wallet:read"] });
    expect(created.status).toBe(201);
    expect(rbac.can({ id: "u", roles: ["auditor"] }, "read", "wallet")).toBe(
      true
    );

    const fetched = await request(app).get("/rbac/roles/auditor").set(asAdmin);
    expect(fetched.status).toBe(200);
    expect(fetched.body.name).toBe("auditor");

    const updated = await request(app)
      .put("/rbac/roles/auditor")
      .set(asAdmin)
      .send({ permissions: ["wallet:read", "wallet:delete"] });
    expect(updated.status).toBe(200);
    expect(rbac.can({ id: "u", roles: ["auditor"] }, "delete", "wallet")).toBe(
      true
    );

    const missing = await request(app).get("/rbac/roles/ghost").set(asAdmin);
    expect(missing.status).toBe(404);

    const duplicate = await request(app)
      .post("/rbac/roles")
      .set(asAdmin)
      .send({ name: "auditor", permissions: ["wallet:read"] });
    expect(duplicate.status).toBe(400);

    const removed = await request(app)
      .delete("/rbac/roles/auditor")
      .set(asAdmin);
    expect(removed.status).toBe(204);
    expect(rbac.can({ id: "u", roles: ["auditor"] }, "read", "wallet")).toBe(
      false
    );
  });

  it("manages subject assignments and settings", async () => {
    const { app, store } = await buildApp();
    const asAdmin = { "x-user-id": "admin-1" };

    const assigned = await request(app)
      .post("/rbac/subjects/dev-1/roles")
      .set(asAdmin)
      .send({ role: "viewer" });
    expect(assigned.status).toBe(201);
    expect(assigned.body.roles).toEqual(["viewer"]);

    const listed = await request(app)
      .get("/rbac/subjects/dev-1/roles")
      .set(asAdmin);
    expect(listed.body.roles).toEqual(["viewer"]);

    const replaced = await request(app)
      .put("/rbac/subjects/dev-1/roles")
      .set(asAdmin)
      .send({ roles: ["admin"] });
    expect(replaced.body.roles).toEqual(["admin"]);

    const unknown = await request(app)
      .put("/rbac/subjects/dev-1/roles")
      .set(asAdmin)
      .send({ roles: ["ghost"] });
    expect(unknown.status).toBe(400);

    await request(app)
      .delete("/rbac/subjects/dev-1/roles/admin")
      .set(asAdmin)
      .expect(204);
    await expect(store.getRolesForSubject("dev-1")).resolves.toEqual([]);

    const settings = await request(app).get("/rbac/settings").set(asAdmin);
    expect(settings.body).toEqual({ strictRoles: false });

    const patched = await request(app)
      .patch("/rbac/settings")
      .set(asAdmin)
      .send({ strictRoles: true });
    expect(patched.body).toEqual({ strictRoles: true });

    const invalidRole = await request(app)
      .post("/rbac/roles")
      .set(asAdmin)
      .send({ name: "", permissions: ["wallet:read"] });
    expect(invalidRole.status).toBe(400);

    const dangling = await request(app)
      .put("/rbac/roles/viewer")
      .set(asAdmin)
      .send({ inherits: ["missing"] });
    expect(dangling.status).toBe(400);
  });

  it("forwards unexpected store failures to the error handler", async () => {
    const { app, store } = await buildApp();
    store.listRoles = async () => {
      throw new Error("db down");
    };

    const appWithHandler = express();
    appWithHandler.use(app);
    appWithHandler.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction
      ) => {
        res.status(500).json({ message: err.message });
      }
    );

    const res = await request(appWithHandler)
      .get("/rbac/roles")
      .set("x-user-id", "admin-1");
    expect(res.status).toBe(500);
    expect(res.body.message).toBe("db down");
  });
});
