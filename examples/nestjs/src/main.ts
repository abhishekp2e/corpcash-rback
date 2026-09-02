import "reflect-metadata";
import {
  Controller,
  Delete,
  Get,
  Headers,
  Module,
  Post,
  UseGuards,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createRBAC } from "@corpcash/rbac-node";
import {
  RbacModule,
  RbacGuard,
  RequirePermission,
} from "@corpcash/rbac-node/nestjs";
import { rbacConfig, demoUsers } from "../../shared/rbac.config.js";

const rbac = createRBAC(rbacConfig);

@Controller("wallets")
@UseGuards(RbacGuard)
class WalletsController {
  @Get()
  @RequirePermission("wallet", "read")
  list() {
    return [{ id: "wallet_1", ownerId: "dev-1" }];
  }

  @Post()
  @RequirePermission("wallet", "create")
  create() {
    return { id: "wallet_new" };
  }

  @Delete(":id")
  @RequirePermission("wallet", "delete")
  remove(@Headers("x-user-id") userId: string) {
    return { deleted: true, userId };
  }
}

@Controller("me")
class MeController {
  @Get("authorization")
  authorization(@Headers("x-user-id") userId: keyof typeof demoUsers) {
    const subject = demoUsers[userId];
    if (!subject) return { error: "Unauthorized" };
    return {
      user: subject,
      roles: subject.roles,
      permissions: rbac.getEffectivePermissions(subject),
    };
  }
}

@Module({
  imports: [
    RbacModule.forRoot({
      roles: rbacConfig.roles,
      getSubject: (context: import("@nestjs/common").ExecutionContext) => {
        const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
        const userId = req.headers["x-user-id"] as keyof typeof demoUsers | undefined;
        return userId ? demoUsers[userId] : null;
      },
    }),
  ],
  controllers: [WalletsController, MeController],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3002);
  console.log("NestJS example running on http://localhost:3002");
}

bootstrap();
