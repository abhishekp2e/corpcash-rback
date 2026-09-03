import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { RBAC, type Subject } from "@corpcash/rbac-core";
import {
  RBAC_GUARD_OPTIONS,
  RBAC_INSTANCE,
  RBAC_PERMISSION_KEY,
  RBAC_PUBLIC_KEY,
  RBAC_STORE,
  PublicRoute,
  RbacAdminModule,
  RbacGuard,
  RbacModule,
  RequirePermission,
  type PermissionMetadata,
} from "../nestjs/index.js";
import { memoryStore } from "@corpcash/rbac-store";

interface HandlerMetadata {
  permission?: PermissionMetadata;
  isPublic?: boolean;
}

/**
 * The guard only ever asks the reflector for two keys, so a map keyed by
 * metadata key is enough to drive it without a Nest application.
 */
function createHarness(metadata: HandlerMetadata) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === RBAC_PERMISSION_KEY
        ? metadata.permission
        : key === RBAC_PUBLIC_KEY
          ? metadata.isPublic
          : undefined,
  } as unknown as Reflector;

  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  return { reflector, context };
}

const rbacConfig = {
  roles: {
    admin: { permissions: ["*:*"] },
    viewer: { permissions: ["wallet:read"] },
  },
};

const viewer: Subject = { id: "1", roles: ["viewer"] };
const admin: Subject = { id: "2", roles: ["admin"] };

describe("RbacGuard", () => {
  it("allows a request that matches the required permission", async () => {
    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "read" },
    });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => viewer,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("throws ForbiddenException when the permission is missing", async () => {
    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "delete" },
    });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => viewer,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });

  it("throws UnauthorizedException when there is no subject", async () => {
    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "read" },
    });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => null,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException
    );
  });

  it("throws UnauthorizedException when the subject has no id", async () => {
    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "read" },
    });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => ({ id: "", roles: ["admin"] }),
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException
    );
  });

  it("denies unannotated handlers by default", async () => {
    const { reflector, context } = createHarness({});
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => viewer,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });

  it("lets PublicRoute opt a handler out", async () => {
    const { reflector, context } = createHarness({ isPublic: true });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => viewer,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("allows unannotated handlers only when explicitly switched off", async () => {
    const { reflector, context } = createHarness({});
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => viewer,
      denyUnannotatedRoutes: false,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("awaits async policies and an async getSubject", async () => {
    const rbac = new RBAC(rbacConfig);
    rbac.registerPolicyFor(
      "wallet",
      "delete",
      async ({ subject, resource }) => {
        const ownerId =
          typeof resource === "object" ? resource.ownerId : undefined;
        return ownerId === subject.id;
      }
    );

    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "delete" },
    });

    const owned = new RbacGuard(reflector, rbac, {
      getSubject: async () => admin,
      getResource: () => ({ type: "wallet", id: "w1", ownerId: admin.id }),
    });
    await expect(owned.canActivate(context)).resolves.toBe(true);

    const notOwned = new RbacGuard(reflector, rbac, {
      getSubject: async () => admin,
      getResource: () => ({
        type: "wallet",
        id: "w2",
        ownerId: "someone-else",
      }),
    });
    await expect(notOwned.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });

  it("checks the declared resource when getResource reports another type", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reflector, context } = createHarness({
      permission: { resource: "report", action: "read" },
    });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => viewer,
      getResource: () => ({ type: "wallet", id: "w1" }),
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("denies rather than crashing on an unknown role", async () => {
    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "read" },
    });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => ({ id: "9", roles: ["ghost"] }),
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });
});

describe("decorators", () => {
  class WalletController {
    list() {}
    health() {}
  }

  it("RequirePermission attaches the resource and action", () => {
    RequirePermission("wallet", "read")(
      WalletController.prototype,
      "list",
      Object.getOwnPropertyDescriptor(WalletController.prototype, "list")!
    );

    expect(
      Reflect.getMetadata(RBAC_PERMISSION_KEY, WalletController.prototype.list)
    ).toEqual({ resource: "wallet", action: "read" });
  });

  it("PublicRoute marks a handler exempt", () => {
    PublicRoute()(
      WalletController.prototype,
      "health",
      Object.getOwnPropertyDescriptor(WalletController.prototype, "health")!
    );

    expect(
      Reflect.getMetadata(RBAC_PUBLIC_KEY, WalletController.prototype.health)
    ).toBe(true);
  });
});

describe("string resources from getResource", () => {
  it("passes a matching string through", async () => {
    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "read" },
    });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => viewer,
      getResource: () => "wallet",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("warns and keeps the declared resource when a different string is returned", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "read" },
    });
    const guard = new RbacGuard(reflector, new RBAC(rbacConfig), {
      getSubject: () => viewer,
      getResource: () => "transaction",
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

interface FactoryProvider {
  provide: unknown;
  useValue?: unknown;
  useFactory?: (...args: unknown[]) => unknown;
}

describe("RbacModule.forRoot", () => {
  function build(options: Parameters<typeof RbacModule.forRoot>[0]) {
    const moduleDef = RbacModule.forRoot(options);
    const providers = moduleDef.providers as unknown as FactoryProvider[];
    const find = (token: unknown) =>
      providers.find((provider) => provider.provide === token)!;

    return {
      moduleDef,
      rbac: find(RBAC_INSTANCE).useValue as RBAC,
      guardOptions: find(RBAC_GUARD_OPTIONS).useValue,
      buildGuard: (reflector: Reflector) =>
        find(RbacGuard).useFactory!(
          reflector,
          find(RBAC_INSTANCE).useValue,
          find(RBAC_GUARD_OPTIONS).useValue
        ) as RbacGuard,
    };
  }

  it("exposes the engine and a guard wired to it", async () => {
    const { moduleDef, rbac, buildGuard } = build({
      ...rbacConfig,
      getSubject: () => viewer,
    });

    expect(moduleDef.exports).toContain(RBAC_INSTANCE);
    expect(rbac.can(viewer, "read", "wallet")).toBe(true);

    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "read" },
    });
    await expect(buildGuard(reflector).canActivate(context)).resolves.toBe(
      true
    );
  });

  it("defaults the guard to denying unannotated handlers", () => {
    const { guardOptions } = build({
      ...rbacConfig,
      getSubject: () => viewer,
    });

    expect(guardOptions).toMatchObject({ denyUnannotatedRoutes: true });
  });

  it("runs `configure` so policies are registered at startup", async () => {
    const { buildGuard } = build({
      ...rbacConfig,
      getSubject: () => admin,
      configure: (instance) =>
        instance.registerPolicyFor("wallet", "delete", () => false),
    });

    const { reflector, context } = createHarness({
      permission: { resource: "wallet", action: "delete" },
    });
    await expect(buildGuard(reflector).canActivate(context)).rejects.toThrow(
      ForbiddenException
    );
  });

  it("forwards strictRoles and onDecision to the engine", () => {
    const onDecision = vi.fn();
    const { rbac } = build({
      ...rbacConfig,
      strictRoles: true,
      onDecision,
      getSubject: () => viewer,
    });

    expect(() =>
      rbac.can({ id: "1", roles: ["ghost"] }, "read", "wallet")
    ).toThrow();
    expect(onDecision).not.toHaveBeenCalled();

    rbac.can(viewer, "read", "wallet");
    expect(onDecision).toHaveBeenCalledOnce();
  });
});

describe("RbacModule.forRootAsync", () => {
  it("loads roles from a store and exports the store token", async () => {
    const store = memoryStore();
    await store.migrate();
    await store.seed(rbacConfig);

    const moduleDef = RbacModule.forRootAsync({
      store,
      getSubject: () => viewer,
      configure: (instance) =>
        instance.registerPolicyFor("wallet", "delete", () => false),
    });
    const providers = moduleDef.providers as unknown as FactoryProvider[];
    const instance = providers.find(
      (provider) => provider.provide === RBAC_INSTANCE
    )!;
    const storeProvider = providers.find(
      (provider) => provider.provide === RBAC_STORE
    )!;

    expect(storeProvider.useValue).toBe(store);
    const rbac = (await instance.useFactory?.()) as RBAC;
    expect(rbac.can(viewer, "read", "wallet")).toBe(true);
    expect(rbac.can(admin, "delete", "wallet")).toBe(false);
  });

  it("registers the admin module", () => {
    const moduleDef = RbacAdminModule.register();
    expect(moduleDef.module).toBe(RbacAdminModule);
    expect(moduleDef.controllers).toBeDefined();
  });
});
