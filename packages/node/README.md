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
  getSubject: (req) => req.user, // may also return a promise
});

app.get("/wallets", authorize("wallet", "read"), handler);
app.delete(
  "/wallets/:id",
  authorize({
    resource: "wallet",
    action: "delete",
    getResource: (req) => ({ type: "wallet", id: req.params.id }),
    getContext: (req) => ({ tenantId: req.headers["x-tenant"] }),
  }),
  handler
);
```

- **401** when there is no subject, or the subject has no `id`.
- **403** when the engine denies, with the deny `reason` in the body.
- Anything thrown while resolving the subject or a policy is passed to `next()`,
  so it reaches your error handler instead of hanging the request.
- Async policies are awaited: the middleware uses `authorizeAsync`.

Override the responses with `onUnauthenticated` and `onForbidden`.

### getResource and the declared resource

The route's `resource` is the contract and always decides which permission is
checked. `getResource` supplies the **instance** handed to policies; if it
reports a different `type`, the declared one wins and a warning is logged once.

## NestJS

```typescript
import {
  RbacModule,
  RbacGuard,
  RequirePermission,
  PublicRoute,
} from "@corpcash/rbac-node/nestjs";

@Module({
  imports: [
    RbacModule.forRoot({
      roles: rbacConfig.roles,
      getSubject: (ctx) => ctx.switchToHttp().getRequest().user,
      // Register policies against the engine at startup
      configure: (rbac) =>
        rbac.registerPolicyFor(
          "wallet",
          "delete",
          async ({ subject, resource }) => {
            const wallet = await wallets.findById(String(resource.id));
            return wallet?.ownerId === subject.id;
          }
        ),
    }),
  ],
})
export class AppModule {}

@Controller("wallets")
@UseGuards(RbacGuard) // required — the decorator alone does nothing
export class WalletsController {
  @Get()
  @RequirePermission("wallet", "read")
  list() {}
}
```

### Registering the guard globally

`@UseGuards` has to be repeated on every controller, and a controller that
misses it is unprotected. Bind the guard once instead:

```typescript
@Module({
  imports: [RbacModule.forRoot({ ... })],
  controllers: [WalletsController],
  providers: [{ provide: APP_GUARD, useExisting: RbacGuard }],
})
export class AppModule {}
```

`useExisting` reuses the configured instance that `RbacModule` exports, so the
guard keeps your `getSubject` and `getResource`. `useClass` asks Nest to build
its own guard without them; that now fails at startup with a message telling you
to switch, rather than at the first request. The module must be imported by
whichever module registers `APP_GUARD`.

Combined with the deny-by-default below, this means no handler can be reached
without an explicit decision about it.

### Unannotated handlers are denied

A handler the guard covers but that carries no `@RequirePermission` is **denied**,
so a forgotten or misspelled decorator closes the door instead of opening it.
Mark deliberate exceptions explicitly:

```typescript
@Controller("health")
@UseGuards(RbacGuard)
export class HealthController {
  @Get()
  @PublicRoute()
  check() {
    return { ok: true };
  }
}
```

This is stricter than the usual Nest convention. To get the looser behaviour
where unannotated handlers pass through:

```typescript
RbacModule.forRoot({
  denyUnannotatedRoutes: false,
  // …
});
```

The guard throws `UnauthorizedException` when there is no subject and
`ForbiddenException` when the engine denies, with the deny `reason` attached.

## Auditing

`onDecision` is forwarded to the engine, so both adapters emit one event per
decision:

```typescript
RbacModule.forRoot({
  roles,
  getSubject,
  onDecision: ({ request, result }) =>
    logger.info({ subject: request.subject.id, ...result }),
});
```

## License

MIT
