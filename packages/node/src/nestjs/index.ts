import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Module,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RBAC, RBACConfig, Resource, Subject } from "@corpcash/rbac-core";
import { createRBAC } from "../create-rbac.js";
import { warnResourceTypeMismatch } from "../resource.js";

export const RBAC_PERMISSION_KEY = "rbac:permission";
export const RBAC_PUBLIC_KEY = "rbac:public";
export const RBAC_INSTANCE = "RBAC_INSTANCE";
export const RBAC_GUARD_OPTIONS = "RBAC_GUARD_OPTIONS";

export interface PermissionMetadata {
  resource: string;
  action: string;
}

export interface NestRbacModuleOptions {
  roles?: RBACConfig["roles"];
  permissions?: RBACConfig["permissions"];
  strictRoles?: RBACConfig["strictRoles"];
  onDecision?: RBACConfig["onDecision"];
  getSubject: (
    context: ExecutionContext
  ) => Subject | null | undefined | Promise<Subject | null | undefined>;
  getResource?: (context: ExecutionContext) => Resource | undefined;
  getContext?: (
    context: ExecutionContext
  ) => Record<string, unknown> | undefined;
  /**
   * Deny handlers that carry no `@RequirePermission`. Defaults to `true`: a
   * forgotten decorator should close the door, not open it. Mark deliberate
   * exceptions with `@PublicRoute()`. Set to `false` for the looser Nest
   * convention where unannotated handlers pass through.
   */
  denyUnannotatedRoutes?: boolean;
  /** Runs against the RBAC instance at startup — register policies here. */
  configure?: (rbac: RBAC) => void;
}

type GuardOptions = Pick<
  NestRbacModuleOptions,
  "getSubject" | "getResource" | "getContext" | "denyUnannotatedRoutes"
>;

export function RequirePermission(
  resource: string,
  action: string
): MethodDecorator & ClassDecorator {
  return SetMetadata(RBAC_PERMISSION_KEY, { resource, action });
}

/** Exempts a handler from `denyUnannotatedRoutes`. */
export function PublicRoute(): MethodDecorator & ClassDecorator {
  return SetMetadata(RBAC_PUBLIC_KEY, true);
}

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly denyUnannotatedRoutes: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RBAC,
    private readonly options: GuardOptions
  ) {
    // Nest hands us an unconfigured guard when it is asked to build one itself,
    // which otherwise surfaces as an unrelated TypeError at startup.
    if (!options?.getSubject) {
      throw new Error(
        "RbacGuard was constructed without its options. Bind it with " +
          "{ provide: APP_GUARD, useExisting: RbacGuard } so Nest reuses the " +
          "instance configured by RbacModule.forRoot(), not useClass."
      );
    }

    this.denyUnannotatedRoutes = options.denyUnannotatedRoutes ?? true;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<PermissionMetadata>(
      RBAC_PERMISSION_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!metadata) {
      const isPublic = this.reflector.getAllAndOverride<boolean>(
        RBAC_PUBLIC_KEY,
        [context.getHandler(), context.getClass()]
      );

      if (this.denyUnannotatedRoutes && !isPublic) {
        throw new ForbiddenException({
          message: "You do not have permission to perform this action.",
          reason: "MISSING_PERMISSION_METADATA",
        });
      }

      return true;
    }

    const subject = await this.options.getSubject(context);
    if (!subject?.id) {
      throw new UnauthorizedException("Authentication required.");
    }

    const result = await this.rbac.authorizeAsync({
      subject,
      action: metadata.action,
      resource: this.resolveResource(metadata, context),
      context: this.options.getContext?.(context),
    });

    if (!result.allowed) {
      throw new ForbiddenException({
        message: "You do not have permission to perform this action.",
        reason: result.reason,
      });
    }

    return true;
  }

  private resolveResource(
    metadata: PermissionMetadata,
    context: ExecutionContext
  ): Resource {
    const instance = this.options.getResource?.(context);
    if (instance === undefined) return metadata.resource;

    if (typeof instance === "string") {
      if (instance !== metadata.resource) {
        warnResourceTypeMismatch(metadata.resource, instance);
      }
      return metadata.resource;
    }

    if (instance.type !== metadata.resource) {
      warnResourceTypeMismatch(metadata.resource, instance.type);
      return { ...instance, type: metadata.resource };
    }

    return instance;
  }
}

@Module({})
export class RbacModule {
  static forRoot(options: NestRbacModuleOptions) {
    const rbac = createRBAC({
      roles: options.roles,
      permissions: options.permissions,
      strictRoles: options.strictRoles,
      onDecision: options.onDecision,
    });

    options.configure?.(rbac);

    const guardOptions: GuardOptions = {
      getSubject: options.getSubject,
      getResource: options.getResource,
      getContext: options.getContext,
      denyUnannotatedRoutes: options.denyUnannotatedRoutes ?? true,
    };

    return {
      module: RbacModule,
      providers: [
        Reflector,
        { provide: RBAC_INSTANCE, useValue: rbac },
        { provide: RBAC_GUARD_OPTIONS, useValue: guardOptions },
        {
          provide: RbacGuard,
          useFactory: (
            reflector: Reflector,
            rbacInstance: RBAC,
            resolved: GuardOptions
          ) => new RbacGuard(reflector, rbacInstance, resolved),
          inject: [Reflector, RBAC_INSTANCE, RBAC_GUARD_OPTIONS],
        },
      ],
      exports: [RbacGuard, RBAC_INSTANCE],
    };
  }
}
