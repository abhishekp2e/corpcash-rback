# @corpcash/rbac-node

Express middleware, NestJS guards, and the `/rbac` admin HTTP API over
`@corpcash/rbac-core`.

Store connect, `migrate()`, store methods, and every admin `curl`:
[`@corpcash/rbac-store` README](../store/README.md).

- [Install](#install)
- [Flow](#flow)
- [1. Create the engine](#1-create-the-engine)
- [2. Express](#2-express)
- [3. NestJS](#3-nestjs)
- [4. Admin HTTP API](#4-admin-http-api)
- [Exports](#exports)

## Install

```bash
npm install @corpcash/rbac-node@^0.3.0 @corpcash/rbac-core@^0.3.0
# database-backed roles
npm install @corpcash/rbac-store@^0.3.0 pg
```

## Flow

The backend is the security boundary. This package does not persist config; it
adapts the in-memory engine to HTTP.

```
1. createRBAC({ roles })  or  createRBACFromStore(store)
2. rbac.registerPolicyFor(...)          ← instance rules in code
3. Express authorize() / Nest RbacGuard on every mutating route
4. GET /me/authorization                ← effective permissions for the UI
5. Optional: mount /rbac admin API      ← live role edits (needs rbac:manage)
```

```
request → getSubject → authorizeAsync(subject, action, resource)
        → 401 if no subject
        → 403 if denied (reason in the body)
        → next() / handler if allowed
```

---

## 1. Create the engine

In-memory (file or hardcoded roles):

```typescript
import { createRBAC } from "@corpcash/rbac-node";

const rbac = createRBAC({
  roles: {
    viewer: { permissions: ["wallet:read"] },
    developer: {
      inherits: ["viewer"],
      permissions: ["wallet:create", "wallet:delete"],
    },
    admin: { permissions: ["*:*"] },
  },
  onDecision: ({ request, result }) =>
    logger.info({ subject: request.subject.id, ...result }),
});

rbac.registerPolicyFor("wallet", "delete", ownershipPolicy);
```

`createRBAC` is `new RBAC(config)` from core.

Database-backed:

```typescript
import { createRBACFromStore, reloadFromStore } from "@corpcash/rbac-node";
import { postgresStore } from "@corpcash/rbac-store/postgres";

const store = postgresStore({ connectionString: process.env.DATABASE_URL });
await store.migrate();
await store.seed({ roles: rbacConfig.roles });

const rbac = await createRBACFromStore(store, { onDecision });
rbac.registerPolicyFor("wallet", "delete", ownershipPolicy);
```

`createRBACFromStore`, `reloadFromStore`, `memoryStore`, and
`createStoreSubjectResolver` are re-exported from `@corpcash/rbac-store`.

Hand the UI its upper-bound list:

```typescript
app.get("/me/authorization", async (req, res) => {
  const subject = await getSubject(req);
  if (!subject) return res.status(401).json({ error: "Unauthorized" });
  res.json({
    subject,
    roles: subject.roles,
    permissions: rbac.getEffectivePermissions(subject),
  });
});
```

---

## 2. Express

```typescript
import { createExpressMiddleware } from "@corpcash/rbac-node/express";

const { authorize } = createExpressMiddleware({
  rbac,
  getSubject: (req) => req.user, // sync or async
  // onUnauthenticated, onForbidden — optional
});

app.get("/wallets", authorize("wallet", "read"), listWallets);

app.delete(
  "/wallets/:id",
  authorize({
    resource: "wallet",
    action: "delete",
    getResource: (req) => ({ type: "wallet", id: req.params.id }),
    getContext: (req) => ({ tenantId: req.headers["x-tenant"] }),
  }),
  deleteWallet
);
```

| Status  | When                                      |
| ------- | ----------------------------------------- |
| **401** | No subject, or subject has no `id`        |
| **403** | Engine denied (`reason` in the JSON body) |

Thrown errors (subject resolver, policy) go to `next()`. Async policies are
awaited (`authorizeAsync`).

### `createExpressMiddleware` options

| Option              | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `rbac`              | Engine instance                                   |
| `getSubject`        | `(req) => Subject \| null` (may return a promise) |
| `onUnauthenticated` | Custom 401                                        |
| `onForbidden`       | Custom 403; receives the `AuthorizationResult`    |

```typescript
import {
  createForbiddenResponse,
  createUnauthorizedResponse,
} from "@corpcash/rbac-node";

createExpressMiddleware({
  rbac,
  getSubject,
  onUnauthenticated: (_req, res) =>
    res.status(401).json(createUnauthorizedResponse("Sign in first.")),
  onForbidden: (_req, res, result) =>
    res.status(403).json(createForbiddenResponse("Blocked.", result.reason)),
});
```

### `authorize` options

| Form                                                         | Meaning                         |
| ------------------------------------------------------------ | ------------------------------- |
| `authorize("wallet", "read")`                                | Type-level check                |
| `authorize({ resource, action, getResource?, getContext? })` | Instance + context for policies |

The route's `resource` always decides which permission is checked.
`getResource` only supplies the **instance** for policies. If the instance
`type` differs, the declared type wins and a warning is logged once.

### Default 401 / 403 bodies

```typescript
createUnauthorizedResponse();
// { statusCode: 401, error: "Unauthorized", message: "Authentication required." }

createForbiddenResponse(undefined, result.reason);
// { statusCode: 403, error: "Forbidden", message: "...", reason: "POLICY_DENIED" }
```

---

## 3. NestJS

```typescript
import { APP_GUARD } from "@nestjs/core";
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
      getResource: (ctx) => {
        const req = ctx.switchToHttp().getRequest();
        return req.params.id
          ? { type: "wallet", id: req.params.id }
          : undefined;
      },
      getContext: (ctx) => ({
        tenantId: ctx.switchToHttp().getRequest().headers["x-tenant"],
      }),
      configure: (rbac) =>
        rbac.registerPolicyFor("wallet", "delete", ownershipPolicy),
      onDecision: ({ result }) => logger.info(result),
      denyUnannotatedRoutes: true,
    }),
  ],
  providers: [{ provide: APP_GUARD, useExisting: RbacGuard }],
})
export class AppModule {}

@Controller("wallets")
export class WalletsController {
  @Get()
  @RequirePermission("wallet", "read")
  list() {}

  @Delete(":id")
  @RequirePermission("wallet", "delete")
  remove() {}

  @Get("health")
  @PublicRoute()
  health() {
    return { ok: true };
  }
}
```

Use `{ provide: APP_GUARD, useExisting: RbacGuard }` so Nest reuses the
configured guard. `useClass` builds an empty guard and fails at startup.

Handlers the guard covers that have no `@RequirePermission` are **denied**.
Mark exceptions with `@PublicRoute()`, or set `denyUnannotatedRoutes: false`.

Scope the guard per controller with `@UseGuards(RbacGuard)` if you adopt it
gradually. The decorator alone does nothing without the guard.

### `RbacModule.forRoot` options

| Option                                  | Purpose                                           |
| --------------------------------------- | ------------------------------------------------- |
| `roles` / `permissions` / `strictRoles` | Passed to `createRBAC`                            |
| `onDecision`                            | Audit hook                                        |
| `getSubject`                            | Required. `(ExecutionContext) => Subject \| null` |
| `getResource`                           | Optional instance for policies                    |
| `getContext`                            | Optional context bag                              |
| `denyUnannotatedRoutes`                 | Default `true`                                    |
| `configure`                             | `(rbac) => void` — register policies here         |

### `RbacModule.forRootAsync`

Same as `forRoot`, but `store` replaces `roles` / `permissions` /
`strictRoles`. Loads `store.loadConfig()` at startup.

```typescript
RbacModule.forRootAsync({
  store,
  getSubject: (ctx) => ctx.switchToHttp().getRequest().user,
  configure: (rbac) => rbac.registerPolicyFor("wallet", "delete", policy),
});
```

### Decorators

```typescript
@RequirePermission("wallet", "delete")
@PublicRoute()
```

`RequirePermission` sets `{ resource, action }` metadata. `PublicRoute`
exempts a handler from deny-unannotated.

### Injection tokens

| Token                 | Value                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `RBAC_INSTANCE`       | The `RBAC` engine                                                     |
| `RBAC_STORE`          | Store (async module only)                                             |
| `RBAC_GUARD_OPTIONS`  | `getSubject` / `getResource` / `getContext` / `denyUnannotatedRoutes` |
| `RBAC_PERMISSION_KEY` | Metadata key for `@RequirePermission`                                 |
| `RBAC_PUBLIC_KEY`     | Metadata key for `@PublicRoute`                                       |

```typescript
import { Inject } from "@nestjs/common";
import { RBAC_INSTANCE, RBAC_STORE } from "@corpcash/rbac-node/nestjs";

constructor(
  @Inject(RBAC_INSTANCE) private readonly rbac: RBAC,
  @Inject(RBAC_STORE) private readonly store: RBACStore
) {}
```

The guard throws `UnauthorizedException` when there is no subject and
`ForbiddenException` when the engine denies, with `reason` attached.

---

## 4. Admin HTTP API

Mount after the engine is loaded from a store. Every route requires
`rbac:manage` or `*:*`. Seed an `admin` role with `*:*` before calling these.

Full `curl` examples and the store-method mapping:
[`packages/store/README.md`](../store/README.md#admin-http-api).

### Express

```typescript
import { createRbacAdminRouter } from "@corpcash/rbac-node/express";

app.use("/rbac", createRbacAdminRouter({ store, rbac, getSubject }));
```

If `getSubject` is omitted, the router reads `x-user-id` and loads roles from
the store.

### NestJS

```typescript
import { RbacAdminModule } from "@corpcash/rbac-node/nestjs";

@Module({
  imports: [
    RbacModule.forRootAsync({ store, getSubject, configure }),
    RbacAdminModule.register(),
  ],
  providers: [{ provide: APP_GUARD, useExisting: RbacGuard }],
})
export class AppModule {}
```

`RbacAdminController` is also exported if you register it yourself.

### Routes

| Method | Path                             | Body                                | Reloads |
| ------ | -------------------------------- | ----------------------------------- | ------- |
| GET    | `/rbac/roles`                    |                                     | no      |
| POST   | `/rbac/roles`                    | `{ name, permissions?, inherits? }` | yes     |
| GET    | `/rbac/roles/:name`              |                                     | no      |
| PUT    | `/rbac/roles/:name`              | `{ permissions?, inherits? }`       | yes     |
| DELETE | `/rbac/roles/:name`              |                                     | yes     |
| GET    | `/rbac/subjects/:id/roles`       |                                     | no      |
| PUT    | `/rbac/subjects/:id/roles`       | `{ roles: string[] }`               | no      |
| POST   | `/rbac/subjects/:id/roles`       | `{ role }`                          | no      |
| DELETE | `/rbac/subjects/:id/roles/:role` |                                     | no      |
| GET    | `/rbac/settings`                 |                                     | no      |
| PATCH  | `/rbac/settings`                 | `{ strictRoles?: boolean }`         | yes     |

```bash
curl -H 'x-user-id: admin' http://localhost:3004/rbac/roles

curl -X POST -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/roles \
  -d '{"name":"auditor","permissions":["wallet:read"]}'

curl -X PUT -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/subjects/user-42/roles \
  -d '{"roles":["developer"]}'
```

Typical errors: **401** unauthenticated, **403** no `rbac:manage`, **400**
invalid graph, **404** missing role.

---

## Exports

| Export                                                                                        | From                          |
| --------------------------------------------------------------------------------------------- | ----------------------------- |
| `createRBAC`                                                                                  | `@corpcash/rbac-node`         |
| `RBAC`                                                                                        | re-export of core             |
| `createRBACFromStore`, `reloadFromStore`, `memoryStore`, `createStoreSubjectResolver`         | re-export of store            |
| `createForbiddenResponse`, `createUnauthorizedResponse`                                       | 401/403 bodies                |
| `createExpressMiddleware`, `createRbacAdminRouter`                                            | `@corpcash/rbac-node/express` |
| `RbacModule`, `RbacModule.forRoot`, `RbacModule.forRootAsync`                                 | `@corpcash/rbac-node/nestjs`  |
| `RbacGuard`, `RequirePermission`, `PublicRoute`, `RbacAdminModule`, `RbacAdminController`     | `@corpcash/rbac-node/nestjs`  |
| `RBAC_INSTANCE`, `RBAC_STORE`, `RBAC_GUARD_OPTIONS`, `RBAC_PERMISSION_KEY`, `RBAC_PUBLIC_KEY` | Nest tokens                   |

Types: `ExpressRBACOptions`, `AuthorizeOptions`, `RbacAdminRouterOptions`,
`NestRbacModuleOptions`, `NestRbacModuleAsyncOptions`, `ForbiddenResponse`,
`UnauthorizedResponse`, `RBACStore`, `StoredRBACConfig`.

Examples: [`examples/express`](../../examples/express),
[`examples/nestjs`](../../examples/nestjs),
[`examples/store`](../../examples/store).

## License

MIT
