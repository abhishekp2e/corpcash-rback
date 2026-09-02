import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { RBAC } from "@corpcash/rbac-core";
import { createExpressMiddleware } from "../middleware/express.js";

describe("Express middleware", () => {
  const rbac = new RBAC({
    roles: {
      admin: { permissions: ["*:*"] },
      viewer: { permissions: ["wallet:read"] },
    },
  });

  const app = express();
  const { authorize } = createExpressMiddleware({
    rbac,
    getSubject: (req) =>
      req.headers["x-user"] === "admin"
        ? { id: "1", roles: ["admin"] }
        : req.headers["x-user"] === "viewer"
          ? { id: "2", roles: ["viewer"] }
          : null,
  });

  app.get("/wallets", authorize("wallet", "read"), (_req, res) => {
    res.json({ ok: true });
  });

  app.delete("/wallets/:id", authorize("wallet", "delete"), (_req, res) => {
    res.json({ deleted: true });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/wallets");
    expect(res.status).toBe(401);
  });

  it("returns 200 when authorized", async () => {
    const res = await request(app).get("/wallets").set("x-user", "viewer");
    expect(res.status).toBe(200);
  });

  it("returns 403 when permission missing", async () => {
    const res = await request(app).delete("/wallets/1").set("x-user", "viewer");
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("MISSING_PERMISSION");
  });

  it("allows admin wildcard", async () => {
    const res = await request(app).delete("/wallets/1").set("x-user", "admin");
    expect(res.status).toBe(200);
  });
});
