# Corpcash RBAC

A TypeScript-first RBAC authorization library for Node.js and React.

## Packages

| Package                                    | Description                             |
| ------------------------------------------ | --------------------------------------- |
| [`@corpcash/rbac-core`](./packages/core)   | Framework-agnostic authorization engine |
| [`@corpcash/rbac-node`](./packages/node)   | Express middleware and NestJS guards    |
| [`@corpcash/rbac-react`](./packages/react) | React provider, hooks, and components   |

## Architecture

One authorization engine (`rbac-core`) with thin integration layers for Node and React. Both consume the same permission model:

**subject + action + resource + context → allow/deny**

```
                    @corpcash/rbac-core
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       @corpcash/rbac-node      @corpcash/rbac-react
              │                         │
         Backend API               React UI
         (security)                (UX only)
```

## Quick Start

```bash
pnpm install
pnpm build
pnpm verify   # typecheck, lint, format check, tests with coverage
```

## Core Usage

```typescript
import { RBAC } from "@corpcash/rbac-core";

const rbac = new RBAC({
  roles: {
    viewer: { permissions: ["wallet:read"] },
    developer: {
      inherits: ["viewer"],
      permissions: ["wallet:create", "contract:deploy"],
    },
    admin: { permissions: ["*:*"] },
  },
  onDecision: ({ request, result }) =>
    logger.info({ subject: request.subject.id, ...result }),
});

const user = { id: "u1", roles: ["developer"] };

rbac.can(user, "read", "wallet"); // true
rbac.authorize({ subject: user, action: "deploy", resource: "contract" });

// Policies that need a lookup
rbac.registerPolicyFor("wallet", "delete", async ({ subject, resource }) => {
  const wallet = await wallets.findById(String(resource.id));
  return wallet?.ownerId === subject.id;
});
await rbac.canAsync(user, "delete", { type: "wallet", id: "w1" });
```

Configuration is validated when the engine is constructed — cycles, dangling
`inherits`, and malformed permissions fail at startup. A subject carrying a role
that no longer exists is denied, not thrown at: the unknown role is skipped and
reported in `result.ignoredRoles`.

## Express

```typescript
import { createRBAC } from "@corpcash/rbac-node";
import { createExpressMiddleware } from "@corpcash/rbac-node/express";

const rbac = createRBAC({ roles: { ... } });
const { authorize } = createExpressMiddleware({
  rbac,
  getSubject: (req) => req.user,
});

router.get("/wallets", authorize("wallet", "read"), listWallets);
```

## NestJS

```typescript
import { APP_GUARD } from "@nestjs/core";
import {
  RbacModule,
  RbacGuard,
  RequirePermission,
} from "@corpcash/rbac-node/nestjs";

@Module({
  imports: [
    RbacModule.forRoot({
      roles: { ... },
      getSubject: (ctx) => ctx.switchToHttp().getRequest().user,
    }),
  ],
  controllers: [WalletsController],
  providers: [{ provide: APP_GUARD, useExisting: RbacGuard }],
})
export class AppModule {}

@Controller("wallets")
export class WalletsController {
  @Delete(":id")
  @RequirePermission("wallet", "delete")
  deleteWallet() {}
}
```

A handler the guard covers but that has no `@RequirePermission` is denied, so a
forgotten decorator cannot open an endpoint. Mark deliberate exceptions with
`@PublicRoute()`, or set `denyUnannotatedRoutes: false` for the looser Nest
convention. Scope the guard per controller with `@UseGuards(RbacGuard)` instead
if you would rather adopt it gradually.

## React

```tsx
import { RBACProvider, useCan, Can } from "@corpcash/rbac-react";

<RBACProvider subject={user} permissions={user.permissions}>
  <Can resource="wallet" action="create">
    <CreateWalletButton />
  </Can>
</RBACProvider>;
```

## Security

**Frontend RBAC is not security.** It controls visibility and UX. The backend must always enforce authorization on every API request.

Define roles once on the backend. Send **effective permissions** to the frontend via an endpoint like `GET /me/authorization`. That list expands roles and inheritance but not policies, so it is an upper bound on what the backend will allow.

## Examples

Four runnable apps — see [`examples/README.md`](./examples/README.md) for the
shared role setup and the request-by-request results.

| Example                                  | Shows                                                        |
| ---------------------------------------- | ------------------------------------------------------------ |
| [`examples/express`](./examples/express) | Middleware, async ownership policy, audit hook               |
| [`examples/nestjs`](./examples/nestjs)   | Global guard, deny-by-default, `@PublicRoute()`, `configure` |
| [`examples/react`](./examples/react)     | `useCan`, `useRole`, `<Can>`, role switcher                  |
| [`examples/nextjs`](./examples/nextjs)   | App Router with the provider in a client component           |

The two API examples share one role config and one wallet store, so the same
delete request is allowed for the owner, denied by policy for a wildcard admin,
and denied for a missing permission for a viewer.

## Contributing

```bash
pnpm verify            # everything CI runs
pnpm check:packages    # publint + are-the-types-wrong on the built packages
pnpm --filter @corpcash/rbac-core bench
pnpm changeset         # describe your change; releases are driven by changesets
```

99 tests cover the three packages, including an end-to-end suite that boots a
real NestJS application over HTTP. Run one package's suite with
`pnpm --filter @corpcash/rbac-node test`.

## License

MIT — see [LICENSE](./LICENSE).
