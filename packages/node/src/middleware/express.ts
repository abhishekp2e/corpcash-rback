import type { NextFunction, Request, RequestHandler, Response } from "express";
import type {
  AuthorizationResult,
  RBAC,
  Resource,
  Subject,
} from "@corpcash/rbac-core";
import {
  createForbiddenResponse,
  createUnauthorizedResponse,
} from "../errors/forbidden.js";
import { warnResourceTypeMismatch } from "../resource.js";

export interface ExpressRBACOptions {
  rbac: RBAC;
  getSubject: (
    req: Request
  ) => Subject | null | undefined | Promise<Subject | null | undefined>;
  onUnauthenticated?: (req: Request, res: Response) => void;
  onForbidden?: (
    req: Request,
    res: Response,
    result: AuthorizationResult
  ) => void;
}

export interface AuthorizeOptions {
  resource: string;
  action: string;
  /**
   * Loads the resource instance passed to policies. The route's `resource`
   * always decides which permission is checked; a differing `type` on the
   * returned instance is overridden and warned about.
   */
  getResource?: (req: Request) => Resource | undefined;
  getContext?: (req: Request) => Record<string, unknown> | undefined;
}

function resolveResource(
  declared: string,
  instance: Resource | undefined
): Resource {
  if (instance === undefined) return declared;

  if (typeof instance === "string") {
    if (instance !== declared) warnResourceTypeMismatch(declared, instance);
    return declared;
  }

  if (instance.type !== declared) {
    warnResourceTypeMismatch(declared, instance.type);
    return { ...instance, type: declared };
  }

  return instance;
}

export function createExpressMiddleware(options: ExpressRBACOptions) {
  const { rbac, getSubject, onForbidden, onUnauthenticated } = options;

  function authorize(
    resourceOrOptions: string | AuthorizeOptions,
    action?: string
  ): RequestHandler {
    const config: AuthorizeOptions =
      typeof resourceOrOptions === "string"
        ? { resource: resourceOrOptions, action: action! }
        : resourceOrOptions;

    return (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        const subject = await getSubject(req);

        if (!subject?.id) {
          if (onUnauthenticated) return onUnauthenticated(req, res);
          res.status(401).json(createUnauthorizedResponse());
          return;
        }

        const result = await rbac.authorizeAsync({
          subject,
          action: config.action,
          resource: resolveResource(config.resource, config.getResource?.(req)),
          context: config.getContext?.(req),
        });

        if (!result.allowed) {
          if (onForbidden) return onForbidden(req, res, result);
          res
            .status(403)
            .json(createForbiddenResponse(undefined, result.reason));
          return;
        }

        next();
      })().catch(next);
    };
  }

  return { authorize };
}
