import "reflect-metadata";
import {
  Controller,
  Delete,
  Get,
  Headers,
  Module,
  Param,
  Post,
  type ExecutionContext,
} from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { createRBAC } from "@corpcash/rbac-node";
import {
  RbacModule,
  RbacGuard,
  RequirePermission,
  PublicRoute,
} from "@corpcash/rbac-node/nestjs";
import { rbacConfig, demoUsers } from "../../shared/rbac.config.js";
import { findWalletById, listWallets } from "../../shared/wallets.store.js";

const rbac = createRBAC(rbacConfig);

function subjectFromContext(context: ExecutionContext) {
  const req = context.switchToHttp().getRequest<{
    headers: Record<string, string | string[] | undefined>;
  }>();
  const userId = req.headers["x-user-id"] as keyof typeof demoUsers | undefined;
  return userId ? (demoUsers[userId] ?? null) : null;
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
    return listWallets();
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
  // The guard is global, so a handler with no @RequirePermission is denied.
  // This one authenticates itself and needs no permission, so it says so.
  @Get("authorization")
  @PublicRoute()
  authorization(@Headers("x-user-id") userId: keyof typeof demoUsers) {
    const subject = demoUsers[userId];
    if (!subject) return { error: "Unauthorized" };
    return {
      user: subject,
      roles: subject.roles,
      permissions: rbac.getEffectivePermissions(subject),
    };
  }

  // Deliberately unannotated: with the guard global and deny-by-default, this
  // returns 403 rather than quietly exposing itself.
  @Get("forgotten")
  forgotten() {
    return { unreachable: true };
  }
}

@Module({
  imports: [
    RbacModule.forRoot({
      roles: rbacConfig.roles,
      getSubject: subjectFromContext,
      getResource: walletFromContext,
      onDecision: ({ request, result, durationMs }) => {
        console.log(
          JSON.stringify({
            event: "authorization",
            subject: request.subject.id,
            action: result.action,
            resource: result.resource,
            allowed: result.allowed,
            reason: result.reason,
            matchedRole: result.matchedRole,
            durationMs,
          })
        );
      },
      // Ownership needs the row, so the policy awaits the lookup.
      configure: (instance) =>
        instance.registerPolicyFor(
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
  // Applied globally: every handler needs @RequirePermission or @PublicRoute.
  providers: [{ provide: APP_GUARD, useExisting: RbacGuard }],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3002);
  console.log("NestJS example running on http://localhost:3002");
  console.log("\nTry:");
  console.log("  curl -H 'x-user-id: developer' http://localhost:3002/wallets");
  console.log(
    "  curl -X DELETE -H 'x-user-id: admin' http://localhost:3002/wallets/wallet_1" +
      "   # 403: not the owner"
  );
  console.log(
    "  curl -H 'x-user-id: admin' http://localhost:3002/me/forgotten" +
      "   # 403: no @RequirePermission"
  );
}

bootstrap();
