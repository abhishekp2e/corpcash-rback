import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { RBAC, Resource, Subject } from "@corpcash/rbac-core";
import { createForbiddenResponse } from "../errors/forbidden.js";

export interface ExpressRBACOptions {
  rbac: RBAC;
  getSubject: (req: Request) => Subject | null | undefined;
  onForbidden?: (
    req: Request,
    res: Response,
    result: ReturnType<RBAC["authorize"]>
  ) => void;
}

export interface AuthorizeOptions {
  resource: string;
  action: string;
  getResource?: (req: Request) => Resource | undefined;
  getContext?: (req: Request) => Record<string, unknown> | undefined;
}

export function createExpressMiddleware(options: ExpressRBACOptions) {
  const { rbac, getSubject, onForbidden } = options;

  function authorize(
    resourceOrOptions: string | AuthorizeOptions,
    action?: string
  ): RequestHandler {
    const config: AuthorizeOptions =
      typeof resourceOrOptions === "string"
        ? { resource: resourceOrOptions, action: action! }
        : resourceOrOptions;

    return (req: Request, res: Response, next: NextFunction) => {
      const subject = getSubject(req);

      if (!subject) {
        res.status(401).json({
          statusCode: 401,
          error: "Unauthorized",
          message: "Authentication required.",
        });
        return;
      }

      const resource = config.getResource?.(req) ?? config.resource;
      const context = config.getContext?.(req);

      const result = rbac.authorize({
        subject,
        action: config.action,
        resource,
        context,
      });

      if (!result.allowed) {
        if (onForbidden) {
          onForbidden(req, res, result);
          return;
        }
        res.status(403).json(createForbiddenResponse(undefined, result.reason));
        return;
      }

      next();
    };
  }

  return { authorize };
}
