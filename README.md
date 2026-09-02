# Corpcash RBAC

A TypeScript-first RBAC authorization library for Node.js and React.

## Packages

| Package | Description |
|---------|-------------|
| [`@corpcash/rbac-core`](./packages/core) | Framework-agnostic authorization engine |
| [`@corpcash/rbac-node`](./packages/node) | Express middleware and NestJS guards |
| [`@corpcash/rbac-react`](./packages/react) | React provider, hooks, and components |

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

> **Full stack integration guide:** [Backend & Frontend Integration](../docs/BACKEND_FRONTEND_INTEGRATION.md) — covers `corpcash-backend`, `corpcash-frontend`, all 6 RBAC concepts, API contracts, and production migration.

```bash
pnpm install
pnpm build
pnpm test
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
});

const user = { id: "u1", roles: ["developer"] };

rbac.can(user, "read", "wallet"); // true
rbac.authorize({ subject: user, action: "deploy", resource: "contract" });
```

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
import { RbacModule, RbacGuard, RequirePermission } from "@corpcash/rbac-node/nestjs";

@RequirePermission("wallet", "delete")
@Delete(":id")
deleteWallet() {}
```

## React

```tsx
import { RBACProvider, useCan, Can } from "@corpcash/rbac-react";

<RBACProvider subject={user} permissions={user.permissions}>
  <Can resource="wallet" action="create">
    <CreateWalletButton />
  </Can>
</RBACProvider>
```

## Security

**Frontend RBAC is not security.** It controls visibility and UX. The backend must always enforce authorization on every API request.

Define roles once on the backend. Send **effective permissions** to the frontend via an endpoint like `GET /me/authorization`.

## Examples

- [`examples/express`](./examples/express) — Express API with wallet routes
- [`examples/nestjs`](./examples/nestjs) — NestJS guards
- [`examples/react`](./examples/react) — Vite + React dashboard
- [`examples/nextjs`](./examples/nextjs) — Next.js App Router

## License

MIT
