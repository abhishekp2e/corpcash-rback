import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type ErrorRequestHandler, type Request } from "express";
import request from "supertest";
import { RBAC, type Subject } from "@corpcash/rbac-core";
import { createExpressMiddleware } from "../middleware/express.js";
import { resetResourceWarnings } from "../resource.js";

const roles = {
  admin: { permissions: ["*:*"] },
  viewer: { permissions: ["wallet:read"] },
};

const SUBJECTS: Record<string, Subject> = {
  admin: { id: "1", roles: ["admin"] },
  viewer: { id: "2", roles: ["viewer"] },
  stale: { id: "3", roles: ["viewer", "legacy_ops"] },
  ghost: { id: "", roles: ["admin"] },
};

function subjectFromHeader(req: Request): Subject | null {
  const header = req.headers["x-user"];
  return typeof header === "string" ? (SUBJECTS[header] ?? null) : null;
}

const swallowErrors: ErrorRequestHandler = (err, _req, res, _next) => {
  res.status(500).json({ handled: true, message: (err as Error).message });
};

describe("Express middleware", () => {
  const rbac = new RBAC({ roles });
  const app = express();
  const { authorize } = createExpressMiddleware({
    rbac,
    getSubject: subjectFromHeader,
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
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns 401 when the subject has no id", async () => {
    const res = await request(app).get("/wallets").set("x-user", "ghost");
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

  it("denies rather than crashing when a subject carries an unknown role", async () => {
    const granted = await request(app).get("/wallets").set("x-user", "stale");
    expect(granted.status).toBe(200);

    const denied = await request(app)
      .delete("/wallets/1")
      .set("x-user", "stale");
    expect(denied.status).toBe(403);
  });
});

describe("Express middleware — policies and hooks", () => {
  beforeEach(() => resetResourceWarnings());

  it("awaits async policies", async () => {
    const rbac = new RBAC({ roles });
    const owners: Record<string, string> = { w1: "1", w2: "someone-else" };
    rbac.registerPolicyFor(
      "wallet",
      "delete",
      async ({ subject, resource }) => {
        const id = typeof resource === "object" ? String(resource.id) : "";
        return owners[id] === subject.id;
      }
    );

    const app = express();
    const { authorize } = createExpressMiddleware({
      rbac,
      getSubject: subjectFromHeader,
    });

    app.delete(
      "/wallets/:id",
      authorize({
        resource: "wallet",
        action: "delete",
        getResource: (req) => ({ type: "wallet", id: String(req.params.id) }),
      }),
      (_req, res) => res.json({ deleted: true })
    );

    const owned = await request(app)
      .delete("/wallets/w1")
      .set("x-user", "admin");
    expect(owned.status).toBe(200);

    const notOwned = await request(app)
      .delete("/wallets/w2")
      .set("x-user", "admin");
    expect(notOwned.status).toBe(403);
    expect(notOwned.body.reason).toBe("POLICY_DENIED");
  });

  it("checks the route's resource even when getResource reports another type", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rbac = new RBAC({
      roles: { viewer: { permissions: ["wallet:read"] } },
    });

    const app = express();
    const { authorize } = createExpressMiddleware({
      rbac,
      getSubject: subjectFromHeader,
    });

    app.get(
      "/reports",
      authorize({
        resource: "report",
        action: "read",
        getResource: () => ({ type: "wallet", id: "w1" }),
      }),
      (_req, res) => res.json({ ok: true })
    );

    const res = await request(app).get("/reports").set("x-user", "viewer");
    expect(res.status).toBe(403);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("passes request context to policies", async () => {
    const rbac = new RBAC({ roles });
    rbac.registerPolicyFor(
      "wallet",
      "read",
      ({ context }) => context?.tenant === "acme"
    );

    const app = express();
    const { authorize } = createExpressMiddleware({
      rbac,
      getSubject: subjectFromHeader,
    });

    app.get(
      "/wallets",
      authorize({
        resource: "wallet",
        action: "read",
        getContext: (req) => ({ tenant: req.headers["x-tenant"] }),
      }),
      (_req, res) => res.json({ ok: true })
    );

    const allowed = await request(app)
      .get("/wallets")
      .set("x-user", "viewer")
      .set("x-tenant", "acme");
    expect(allowed.status).toBe(200);

    const denied = await request(app)
      .get("/wallets")
      .set("x-user", "viewer")
      .set("x-tenant", "other");
    expect(denied.status).toBe(403);
  });

  it("uses the onForbidden and onUnauthenticated hooks", async () => {
    const rbac = new RBAC({ roles });
    const app = express();
    const { authorize } = createExpressMiddleware({
      rbac,
      getSubject: subjectFromHeader,
      onUnauthenticated: (_req, res) => {
        res.status(419).json({ custom: "login" });
      },
      onForbidden: (_req, res, result) => {
        res.status(404).json({ custom: result.reason });
      },
    });

    app.delete("/wallets/:id", authorize("wallet", "delete"), (_req, res) =>
      res.json({ deleted: true })
    );

    const anonymous = await request(app).delete("/wallets/1");
    expect(anonymous.status).toBe(419);

    const denied = await request(app)
      .delete("/wallets/1")
      .set("x-user", "viewer");
    expect(denied.status).toBe(404);
    expect(denied.body.custom).toBe("MISSING_PERMISSION");
  });

  it("supports an async getSubject", async () => {
    const rbac = new RBAC({ roles });
    const app = express();
    const { authorize } = createExpressMiddleware({
      rbac,
      getSubject: async (req) => subjectFromHeader(req),
    });

    app.get("/wallets", authorize("wallet", "read"), (_req, res) =>
      res.json({ ok: true })
    );

    const res = await request(app).get("/wallets").set("x-user", "viewer");
    expect(res.status).toBe(200);
  });

  it("forwards errors to the express error handler instead of hanging", async () => {
    const rbac = new RBAC({ roles });
    const app = express();
    const { authorize } = createExpressMiddleware({
      rbac,
      getSubject: async () => {
        throw new Error("session store unavailable");
      },
    });

    app.get("/wallets", authorize("wallet", "read"), (_req, res) =>
      res.json({ ok: true })
    );
    app.use(swallowErrors);

    const res = await request(app).get("/wallets");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      handled: true,
      message: "session store unavailable",
    });
  });

  it("reports decisions to the audit hook", async () => {
    const onDecision = vi.fn();
    const rbac = new RBAC({ roles, onDecision });
    const app = express();
    const { authorize } = createExpressMiddleware({
      rbac,
      getSubject: subjectFromHeader,
    });

    app.get("/wallets", authorize("wallet", "read"), (_req, res) =>
      res.json({ ok: true })
    );

    await request(app).get("/wallets").set("x-user", "viewer");

    expect(onDecision).toHaveBeenCalledOnce();
    expect(onDecision.mock.calls[0][0].result).toMatchObject({
      allowed: true,
      matchedRole: "viewer",
    });
  });
});
