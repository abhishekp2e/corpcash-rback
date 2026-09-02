# @corpcash/rbac-node

Node.js adapters for `@corpcash/rbac-core`.

## Installation

```bash
npm install @corpcash/rbac-node @corpcash/rbac-core
```

## Express

```typescript
import { createRBAC } from "@corpcash/rbac-node";
import { createExpressMiddleware } from "@corpcash/rbac-node/express";

const rbac = createRBAC({ roles: rbacConfig.roles });

const { authorize } = createExpressMiddleware({
  rbac,
  getSubject: (req) => req.user, // from your auth middleware
});

app.get("/wallets", authorize("wallet", "read"), handler);
app.delete(
  "/wallets/:id",
  authorize({
    resource: "wallet",
    action: "delete",
    getResource: (req) => ({ type: "wallet", id: req.params.id, ownerId: ... }),
  }),
  handler
);
```

Returns **401** when no subject, **403** when denied.

## NestJS

```typescript
import { RbacModule, RbacGuard, RequirePermission } from "@corpcash/rbac-node/nestjs";

@Module({
  imports: [
    RbacModule.forRoot({
      roles: rbacConfig.roles,
      getSubject: (ctx) => ctx.switchToHttp().getRequest().user,
    }),
  ],
})
export class AppModule {}

@Controller("wallets")
@UseGuards(RbacGuard)
export class WalletsController {
  @Get()
  @RequirePermission("wallet", "read")
  list() {}
}
```

## License

MIT
