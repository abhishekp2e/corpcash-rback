import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Module,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RBAC, RBACConfig, Resource, Subject } from "@corpcash/rbac-core";
import { createRBAC } from "../create-rbac.js";

export const RBAC_PERMISSION_KEY = "rbac:permission";
export const RBAC_INSTANCE = "RBAC_INSTANCE";
export const RBAC_GET_SUBJECT = "RBAC_GET_SUBJECT";

export interface PermissionMetadata {
  resource: string;
  action: string;
}

export interface NestRbacModuleOptions {
  roles?: RBACConfig["roles"];
  permissions?: RBACConfig["permissions"];
  getSubject: (context: ExecutionContext) => Subject | null | undefined;
  getResource?: (context: ExecutionContext) => Resource | undefined;
  getContext?: (context: ExecutionContext) => Record<string, unknown> | undefined;
}

export function RequirePermission(
  resource: string,
  action: string
): MethodDecorator & ClassDecorator {
  return SetMetadata(RBAC_PERMISSION_KEY, { resource, action });
}

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RBAC,
    private readonly getSubject: (
      context: ExecutionContext
    ) => Subject | null | undefined,
    private readonly getResource?: (
      context: ExecutionContext
    ) => Resource | undefined,
    private readonly getContext?: (
      context: ExecutionContext
    ) => Record<string, unknown> | undefined
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const metadata = this.reflector.getAllAndOverride<PermissionMetadata>(
      RBAC_PERMISSION_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!metadata) return true;

    const subject = this.getSubject(context);
    if (!subject) {
      throw new ForbiddenException("Authentication required.");
    }

    const resource =
      this.getResource?.(context) ?? metadata.resource;
    const ctx = this.getContext?.(context);

    const result = this.rbac.authorize({
      subject,
      action: metadata.action,
      resource,
      context: ctx,
    });

    if (!result.allowed) {
      throw new ForbiddenException({
        message: "You do not have permission to perform this action.",
        reason: result.reason,
      });
    }

    return true;
  }
}

@Module({})
export class RbacModule {
  static forRoot(options: NestRbacModuleOptions) {
    const rbac = createRBAC({
      roles: options.roles,
      permissions: options.permissions,
    });

    return {
      module: RbacModule,
      providers: [
        Reflector,
        {
          provide: RBAC_INSTANCE,
          useValue: rbac,
        },
        {
          provide: RBAC_GET_SUBJECT,
          useValue: options.getSubject,
        },
        {
          provide: RbacGuard,
          useFactory: (
            reflector: Reflector,
            rbacInstance: RBAC,
            getSubject: NestRbacModuleOptions["getSubject"]
          ) =>
            new RbacGuard(
              reflector,
              rbacInstance,
              getSubject,
              options.getResource,
              options.getContext
            ),
          inject: [Reflector, RBAC_INSTANCE, RBAC_GET_SUBJECT],
        },
      ],
      exports: [RbacGuard, RBAC_INSTANCE],
    };
  }
}
