import "reflect-metadata";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  type ExecutionContext,
  type INestApplication,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import request from "supertest";
import type { AuthorizationDecision, Subject } from "@corpcash/rbac-core";
import {
  PublicRoute,
  RbacGuard,
  RbacModule,
  RequirePermission,
} from "../nestjs/index.js";

interface WalletRecord {
  id: string;
  ownerId: string;
}

const WALLETS: WalletRecord[] = [
  { id: "wallet_1", ownerId: "dev-1" },
  { id: "wallet_2", ownerId: "viewer-1" },
];

/** Stands in for a database call, so the ownership policy has something to await. */
async function findWalletById(id: string): Promise<WalletRecord | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 1));
  return WALLETS.find((wallet) => wallet.id === id);
}

const users: Record<string, Subject> = {
  viewer: { id: "viewer-1", roles: ["viewer"] },
  developer: { id: "dev-1", roles: ["developer"] },
  admin: { id: "admin-1", roles: ["admin"] },
  ghost: { id: "ghost-1", roles: ["role-that-was-deleted"] },
};

const decisions: AuthorizationDecision[] = [];

function subjectFromContext(context: ExecutionContext) {
  const req = context.switchToHttp().getRequest<{
    headers: Record<string, string | undefined>;
  }>();
  const userId = req.headers["x-user-id"];
  return userId ? (users[userId] ?? null) : null;
}

function walletFromContext(context: ExecutionContext) {
  const req = context.switchToHttp().getRequest<{
    params: Record<string, string>;
  }>();
  return req.params.id ? { type: "wallet", id: req.params.id } : undefined;
}

@Controller("wallets")
class WalletsController {
  @Get()
  @RequirePermission("wallet", "read")
  list() {
    return WALLETS;
  }

  @Post()
  @RequirePermission("wallet", "create")
  create() {
    return { id: "wallet_new" };
  }

  @Delete(":id")
  @RequirePermission("wallet", "delete")
  remove(@Param("id") id: string) {
    return { deleted: id };
  }
}

@Controller("me")
class MeController {
  @Get("authorization")
  @PublicRoute()
  authorization() {
    return { public: true };
  }

  // Deliberately unannotated, to prove deny-by-default closes it.
  @Get("forgotten")
  forgotten() {
    return { unreachable: true };
  }
}

@Module({
  imports: [
    RbacModule.forRoot({
      roles: {
        viewer: { permissions: ["wallet:read"] },
        developer: {
          inherits: ["viewer"],
          permissions: ["wallet:create", "wallet:delete"],
        },
        admin: { permissions: ["*:*"] },
      },
      getSubject: subjectFromContext,
      getResource: walletFromContext,
      onDecision: (decision) => decisions.push(decision),
      configure: (rbac) =>
        rbac.registerPolicyFor(
          "wallet",
          "delete",
          async ({ subject, resource }) => {
            if (typeof resource !== "object") return false;
            const wallet = await findWalletById(String(resource.id));
            return wallet?.ownerId === subject.id;
          }
        ),
    }),
  ],
  controllers: [WalletsController, MeController],
  providers: [{ provide: APP_GUARD, useExisting: RbacGuard }],
})
class AppModule {}

describe("NestJS end to end", () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication["getHttpServer"]>;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, new ExpressAdapter(), {
      logger: false,
    });
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    decisions.length = 0;
  });

  it("allows a request whose role carries the permission", async () => {
    const response = await request(http)
      .get("/wallets")
      .set("x-user-id", "viewer");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
  });

  it("resolves inherited permissions through the running app", async () => {
    const response = await request(http)
      .get("/wallets")
      .set("x-user-id", "developer");

    expect(response.status).toBe(200);
    expect(decisions.at(-1)?.result.matchedRole).toBe("viewer");
  });

  it("answers 401 when no subject can be resolved", async () => {
    const response = await request(http).get("/wallets");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Authentication required.");
  });

  it("answers 403 when the role lacks the permission", async () => {
    const response = await request(http)
      .post("/wallets")
      .set("x-user-id", "viewer");

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe("MISSING_PERMISSION");
  });

  it("awaits the ownership policy before allowing a delete", async () => {
    const response = await request(http)
      .delete("/wallets/wallet_1")
      .set("x-user-id", "developer");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: "wallet_1" });
  });

  it("denies a delete on someone else's wallet even for a wildcard role", async () => {
    const response = await request(http)
      .delete("/wallets/wallet_2")
      .set("x-user-id", "admin");

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe("POLICY_DENIED");
  });

  it("passes the route parameter to the policy as the resource instance", async () => {
    await request(http)
      .delete("/wallets/wallet_2")
      .set("x-user-id", "developer");

    expect(decisions.at(-1)?.result.resource).toBe("wallet");
    expect(decisions.at(-1)?.request.resource).toEqual({
      type: "wallet",
      id: "wallet_2",
    });
  });

  it("lets a @PublicRoute handler through without a subject", async () => {
    const response = await request(http).get("/me/authorization");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ public: true });
    expect(decisions).toHaveLength(0);
  });

  it("denies an unannotated handler because the global guard is deny-by-default", async () => {
    const response = await request(http)
      .get("/me/forgotten")
      .set("x-user-id", "admin");

    expect(response.status).toBe(403);
    expect(response.body.reason).toBe("MISSING_PERMISSION_METADATA");
  });

  it("answers 403 rather than 500 when a subject holds an unknown role", async () => {
    const response = await request(http)
      .get("/wallets")
      .set("x-user-id", "ghost");

    expect(response.status).toBe(403);
    expect(decisions.at(-1)?.result.ignoredRoles).toEqual([
      "role-that-was-deleted",
    ]);
  });

  it("explains the mistake when the guard is bound with useClass", async () => {
    @Module({
      imports: [
        RbacModule.forRoot({
          roles: { viewer: { permissions: ["wallet:read"] } },
          getSubject: () => users.viewer,
        }),
      ],
      controllers: [WalletsController],
      providers: [{ provide: APP_GUARD, useClass: RbacGuard }],
    })
    class MisboundModule {}

    await expect(
      NestFactory.create(MisboundModule, new ExpressAdapter(), {
        logger: false,
        abortOnError: false,
      })
    ).rejects.toThrow(/useExisting/);
  });

  it("reports every decision to the audit hook with a duration", async () => {
    await request(http).get("/wallets").set("x-user-id", "viewer");

    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    expect(decision.request.subject.id).toBe("viewer-1");
    expect(decision.result).toMatchObject({
      allowed: true,
      action: "read",
      resource: "wallet",
      matchedRole: "viewer",
      matchedPermission: "wallet:read",
    });
    expect(decision.durationMs).toBeGreaterThanOrEqual(0);
  });
});
