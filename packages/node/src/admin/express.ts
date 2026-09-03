import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { RBAC, Subject } from "@corpcash/rbac-core";
import {
  createStoreSubjectResolver,
  type RBACStore,
} from "@corpcash/rbac-store";
import { createExpressMiddleware } from "../middleware/express.js";
import {
  ADMIN_ACTION,
  ADMIN_RESOURCE,
  createRole,
  findRole,
  isClientError,
  removeRole,
  replaceRole,
  replaceSettings,
  statusFor,
} from "./shared.js";

export interface RbacAdminRouterOptions {
  store: RBACStore;
  rbac: RBAC;
  getSubject?: (
    req: Request
  ) => Subject | null | undefined | Promise<Subject | null | undefined>;
}

function handleAdminError(
  error: unknown,
  res: Response,
  next: NextFunction
): void {
  if (isClientError(error)) {
    res.status(statusFor(error)).json({
      error: (error as Error).name,
      message: (error as Error).message,
    });
    return;
  }
  next(error);
}

export function createRbacAdminRouter(options: RbacAdminRouterOptions): Router {
  const { store, rbac } = options;
  const getSubject =
    options.getSubject ??
    createStoreSubjectResolver(store, (req: Request) => {
      const header = req.headers["x-user-id"];
      return typeof header === "string" ? header : undefined;
    });

  const { authorize } = createExpressMiddleware({ rbac, getSubject });
  const guard = authorize(ADMIN_RESOURCE, ADMIN_ACTION);
  const router = Router();

  router.use(guard);

  router.get("/roles", async (_req, res, next) => {
    try {
      res.json(await store.listRoles());
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.post("/roles", async (req, res, next) => {
    try {
      res.status(201).json(await createRole(store, rbac, req.body ?? {}));
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.get("/roles/:name", async (req, res, next) => {
    try {
      res.json(await findRole(store, String(req.params.name)));
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.put("/roles/:name", async (req, res, next) => {
    try {
      res.json(
        await replaceRole(store, rbac, String(req.params.name), req.body ?? {})
      );
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.delete("/roles/:name", async (req, res, next) => {
    try {
      await removeRole(store, rbac, String(req.params.name));
      res.status(204).end();
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.get("/subjects/:id/roles", async (req, res, next) => {
    try {
      res.json({
        subjectId: req.params.id,
        roles: await store.getRolesForSubject(String(req.params.id)),
      });
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.put("/subjects/:id/roles", async (req, res, next) => {
    try {
      const roles = Array.isArray(req.body?.roles) ? req.body.roles : [];
      await store.setRolesForSubject(String(req.params.id), roles);
      res.json({
        subjectId: req.params.id,
        roles: await store.getRolesForSubject(String(req.params.id)),
      });
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.post("/subjects/:id/roles", async (req, res, next) => {
    try {
      await store.assignRole(
        String(req.params.id),
        String(req.body?.role ?? "")
      );
      res.status(201).json({
        subjectId: req.params.id,
        roles: await store.getRolesForSubject(String(req.params.id)),
      });
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.delete("/subjects/:id/roles/:role", async (req, res, next) => {
    try {
      await store.revokeRole(String(req.params.id), String(req.params.role));
      res.status(204).end();
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.get("/settings", async (_req, res, next) => {
    try {
      res.json(await store.getSettings());
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  router.patch("/settings", async (req, res, next) => {
    try {
      res.json(await replaceSettings(store, rbac, req.body ?? {}));
    } catch (error) {
      handleAdminError(error, res, next);
    }
  });

  return router;
}
