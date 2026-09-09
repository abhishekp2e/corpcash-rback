# Corpcash RBAC

TypeScript-first RBAC for Node.js and React. One authorization model on the
backend and the UI:

**subject + action + resource + context → allow / deny**

This page is the consolidated guide: overview, integration, APIs, and UI.

| Package                                    | Role                                                          |
| ------------------------------------------ | ------------------------------------------------------------- |
| [`@corpcash/rbac-core`](./packages/core)   | Engine. Decisions happen here, in memory.                     |
| [`@corpcash/rbac-node`](./packages/node)   | Express middleware, NestJS guards, admin HTTP API.            |
| [`@corpcash/rbac-store`](./packages/store) | Persist roles and assignments in Postgres, MySQL, or MongoDB. |
| [`@corpcash/rbac-react`](./packages/react) | Provider, hooks, and gates. **UX only — not security.**       |

Current release: **0.3.0**.

```
                         @corpcash/rbac-core
                                │
           ┌────────────────────┼────────────────────┐
           ▼                    ▼                    ▼
  @corpcash/rbac-node   @corpcash/rbac-store   @corpcash/rbac-react
           │                    │                    │
      Backend API        Postgres / MySQL /      React UI
      (security)              Mongo              (UX only)
                         roles + assignments
```

- [1. Rules](#1-rules)
- [2. Install](#2-install)
- [3. Concepts](#3-concepts)
- [4. Backend integration](#4-backend-integration)
- [5. Database store](#5-database-store)
- [6. Admin HTTP API](#6-admin-http-api)
- [7. API reference](#7-api-reference)
- [8. UI integration](#8-ui-integration)
- [9. Examples](#9-examples)
- [10. Package READMEs](#10-package-readmes)

---

## 1. Rules

1. The **backend** is the security boundary. Every mutating route runs
   `authorize()` / the Nest guard.
2. The **frontend** only hides buttons and sections. Never trust it.
3. Define roles once (file or database). Send the frontend **effective
   permissions** (`GET /me/authorization`), not the role graph or policy code.
4. Policies can only **narrow** a grant. They never add a permission.
5. Persist **roles and assignments** in a database if you need live edits.
   Policy functions and `onDecision` stay in application code.
6. Default deny: missing permission or failed policy → 403.

---

## 2. Install

```bash
npm install @corpcash/rbac-core@^0.3.0 @corpcash/rbac-node@^0.3.0
npm install @corpcash/rbac-store@^0.3.0 pg          # or mysql2 / mongodb
npm install @corpcash/rbac-react@^0.3.0 react       # UI
```

This monorepo (development):

```bash
pnpm install
pnpm build
pnpm verify
```

Apps next to this repo can use `file:` links, for example
`file:../corpcash-rback/packages/core`. Rebuild the library after engine
changes.

---

## 3. Concepts

| Concept        | Meaning                                              | Example                                      |
| -------------- | ---------------------------------------------------- | -------------------------------------------- |
| **Subject**    | Who is asking (`id`, `roles`, optional `attributes`) | `{ id: "dev-1", roles: ["developer"] }`      |
| **Role**       | Named set of permissions, optional `inherits`        | `developer` inherits `viewer`                |
| **Permission** | `resource:action`                                    | `wallet:read`, `*:*`                         |
| **Action**     | Operation string                                     | `read`, `delete`, `deploy`                   |
| **Resource**   | Type string or instance                              | `"wallet"` or `{ type: "wallet", id: "w1" }` |
| **Policy**     | Extra check after a permission matches               | owner of the wallet                          |

Evaluation order: resolve subject → expand roles → match permission (wildcards
allowed) → run matching policies → deny if anything fails.

Wildcards: `wallet:*` (all actions on wallet), `*:read` (read anything),
`*:*` (everything).

---

## 4. Backend integration

Engine details: [`packages/core/README.md`](./packages/core/README.md).
Express / Nest / admin: [`packages/node/README.md`](./packages/node/README.md).

### 4.1 In-memory engine (no database)

```typescript
import { createRBAC } from "@corpcash/rbac-node";
// or: import { RBAC } from "@corpcash/rbac-core";

const rbac = createRBAC({
  roles: {
    viewer: { permissions: ["wallet:read", "transaction:read"] },
    developer: {
      inherits: ["viewer"],
      permissions: ["wallet:create", "wallet:delete", "contract:deploy"],
    },
    admin: { permissions: ["*:*"] },
  },
  onDecision: ({ request, result, durationMs }) => {
    logger.info({ subject: request.subject.id, ...result, durationMs });
  },
});

rbac.registerPolicyFor("wallet", "delete", async ({ subject, resource }) => {
  if (typeof resource !== "object") return false;
  const wallet = await wallets.findById(String(resource.id));
  return wallet?.ownerId === subject.id;
});
```

`onDecision` exceptions are swallowed so a broken logger cannot change a
decision.

### 4.2 Express

```typescript
import { createExpressMiddleware } from "@corpcash/rbac-node/express";

const { authorize } = createExpressMiddleware({
  rbac,
  getSubject: (req) => req.user, // sync or async
  // onUnauthenticated, onForbidden — optional response overrides
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
  handler
);
```

| Status  | When                                      |
| ------- | ----------------------------------------- |
| **401** | No subject, or subject has no `id`        |
| **403** | Engine denied (`reason` in the JSON body) |

Thrown errors go to `next()` (your Express error handler). Async policies are
awaited.

The route's `resource` always decides which permission is checked.
`getResource` only supplies the **instance** for policies.

Hand the UI its permission list:

```typescript
app.get("/me/authorization", (req, res) => {
  const subject = req.user;
  if (!subject) return res.status(401).json({ error: "Unauthorized" });
  res.json({
    subject,
    roles: subject.roles,
    permissions: rbac.getEffectivePermissions(subject),
  });
});
```

That list expands inheritance but **not** policies. Treat it as an upper bound.

### 4.3 NestJS

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
      configure: (rbac) =>
        rbac.registerPolicyFor("wallet", "delete", ownershipPolicy),
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

Database-backed Nest:

```typescript
RbacModule.forRootAsync({
  store,
  getSubject: (ctx) => ctx.switchToHttp().getRequest().user,
  configure: (rbac) => rbac.registerPolicyFor("wallet", "delete", policy),
});
```

---

## 5. Database store

Connect → `migrate()` (you call it) → then add roles with **store methods** or
the **admin HTTP API**. Full method list, `curl` examples, and the two write
paths: [`packages/store/README.md`](./packages/store/README.md).

The engine stays in memory. The database holds only serializable config.

| In the database                     | Stays in code                              |
| ----------------------------------- | ------------------------------------------ |
| Role names, permissions, `inherits` | `PolicyFn` (`registerPolicyFor`)           |
| `strictRoles`                       | `onDecision`                               |
| Subject id → role names             | Express / Nest `getSubject`, `getResource` |

### Connect

```typescript
import { createRBACFromStore, reloadFromStore } from "@corpcash/rbac-store";
import { postgresStore } from "@corpcash/rbac-store/postgres";
// import { mysqlStore } from "@corpcash/rbac-store/mysql";
// import { mongoStore } from "@corpcash/rbac-store/mongodb";
// import { memoryStore } from "@corpcash/rbac-store";

const store = postgresStore({ connectionString: process.env.DATABASE_URL });
await store.migrate();
await store.seed(rbacConfig); // no-op if any role already exists

const rbac = await createRBACFromStore(store, { onDecision });
rbac.registerPolicyFor("wallet", "delete", ownershipPolicy);

await store.upsertRole("auditor", { permissions: ["wallet:read"] });
await reloadFromStore(rbac, store);
```

| Import                          | Options                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| `@corpcash/rbac-store/postgres` | `{ connectionString }` or `{ pool }`, optional `tablePrefix`               |
| `@corpcash/rbac-store/mysql`    | `{ url }` or `{ pool }`, optional `tablePrefix`                            |
| `@corpcash/rbac-store/mongodb`  | `{ url, dbName? }` or `{ db }` / `{ client }`, optional `collectionPrefix` |
| `memoryStore()`                 | Tests / apps with no database                                              |

Default table / collection prefix: `rbac_` → `rbac_roles`,
`rbac_assignments`, `rbac_settings`. Prefixes may only use letters, digits,
and underscore.

### Schema (created by `migrate()`)

- `rbac_roles(name PK, permissions json, inherits json, updated_at)`
- `rbac_assignments(subject_id, role_name, PK(subject_id, role_name))`
- `rbac_settings(id=1, strict_roles)`

Mongo uses collections of the same names.

Writes validate the graph before commit. You cannot delete a role that others
inherit or that is still assigned.

Resolve subjects from assignments (no reload needed when assignments change):

```typescript
import { createStoreSubjectResolver } from "@corpcash/rbac-store";

const getSubject = createStoreSubjectResolver(store, (req) => req.user?.id);
```

---

## 6. Admin HTTP API

Mount after the engine is loaded from the store. Every route requires
`rbac:manage` (or `*:*` on the caller).

```typescript
import { createRbacAdminRouter } from "@corpcash/rbac-node/express";

app.use("/rbac", createRbacAdminRouter({ store, rbac, getSubject }));
```

If `getSubject` is omitted, the router reads `x-user-id` and loads roles from
the store. Nest: import `RbacAdminModule.register()` next to
`RbacModule.forRootAsync`.

| Method | Path                             | Body                                |
| ------ | -------------------------------- | ----------------------------------- |
| GET    | `/rbac/roles`                    |                                     |
| POST   | `/rbac/roles`                    | `{ name, permissions?, inherits? }` |
| GET    | `/rbac/roles/:name`              |                                     |
| PUT    | `/rbac/roles/:name`              | `{ permissions?, inherits? }`       |
| DELETE | `/rbac/roles/:name`              |                                     |
| GET    | `/rbac/subjects/:id/roles`       |                                     |
| PUT    | `/rbac/subjects/:id/roles`       | `{ roles: string[] }`               |
| POST   | `/rbac/subjects/:id/roles`       | `{ role }`                          |
| DELETE | `/rbac/subjects/:id/roles/:role` |                                     |
| GET    | `/rbac/settings`                 |                                     |
| PATCH  | `/rbac/settings`                 | `{ strictRoles?: boolean }`         |

Role-graph writes reload the in-memory engine. Assignment writes do not.

Typical errors: **401** unauthenticated, **403** no `rbac:manage`, **400**
invalid graph / unknown role, **404** missing role.

---

## 7. API reference

### 7.1 `@corpcash/rbac-core` — `RBAC`

```typescript
const rbac = new RBAC({
  roles?: Record<string, { permissions?: string[]; inherits?: string[] }>;
  permissions?: string[];      // frontend / permission-only; not with roles
  strictRoles?: boolean;       // default false: unknown subject roles are skipped
  onDecision?: (decision) => void;
});
```

| Method                                    | Purpose                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `can(subject, action, resource)`          | Sync boolean                                                                                                       |
| `canAsync(subject, action, resource)`     | Async boolean (await policies)                                                                                     |
| `authorize(request)`                      | Sync `{ allowed, reason, ... }`                                                                                    |
| `authorizeAsync(request)`                 | Async decision                                                                                                     |
| `registerPolicyFor(resource, action, fn)` | Policy after a permission match                                                                                    |
| `registerPolicy(key, fn)`                 | Same, key is `"resource:action"`                                                                                   |
| `reload(config)`                          | Replace compiled roles; policies and `onDecision` stay. Invalid config is rejected and the previous graph remains. |
| `getEffectivePermissions(subject)`        | Flat list for the frontend (no policies)                                                                           |
| `getEffectiveRoles(subject)`              | Roles including inheritance                                                                                        |
| `hasRole(subject, role)`                  | Inheritance-aware                                                                                                  |
| `invalidPermissions`                      | Skipped entries in permission-only mode                                                                            |

`authorize` request: `{ subject, action, resource, context? }`.

Result `reason`: `AUTHORIZED` | `MISSING_PERMISSION` | `POLICY_DENIED` |
`NO_SUBJECT`. Optional `matchedRole`, `matchedPermission`, `ignoredRoles`.

| Error                          | When                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `InvalidRBACConfigError`       | `roles` + `permissions` together, dangling `inherits` |
| `CircularRoleInheritanceError` | Cycle in the role graph                               |
| `InvalidPermissionError`       | Permission is not `resource:action`                   |
| `UnknownRoleError`             | Unknown subject role and `strictRoles: true`          |
| `AsyncPolicyError`             | Async policy used with sync `authorize()`             |

Helpers: `parsePermission`, `tryParsePermission`, `formatPermission`,
`validateRoleGraph`, `getResourceType`.

### 7.2 `@corpcash/rbac-node`

| Export                                                                                | From                          |
| ------------------------------------------------------------------------------------- | ----------------------------- |
| `createRBAC(config)`                                                                  | `@corpcash/rbac-node`         |
| `createRBACFromStore`, `reloadFromStore`, `memoryStore`, `createStoreSubjectResolver` | re-exported from store        |
| `createForbiddenResponse`, `createUnauthorizedResponse`                               | custom 401/403 bodies         |
| `createExpressMiddleware`, `createRbacAdminRouter`                                    | `@corpcash/rbac-node/express` |
| `RbacModule`, `RbacModule.forRoot`, `RbacModule.forRootAsync`                         | `@corpcash/rbac-node/nestjs`  |
| `RbacGuard`, `RequirePermission`, `PublicRoute`, `RbacAdminModule`                    | `@corpcash/rbac-node/nestjs`  |
| `RBAC_INSTANCE`, `RBAC_STORE`, `RBAC_GUARD_OPTIONS`                                   | Nest injection tokens         |

### 7.3 `@corpcash/rbac-store` — `RBACStore`

| Method                                                                    | Purpose                                 |
| ------------------------------------------------------------------------- | --------------------------------------- |
| `migrate()`                                                               | Idempotent schema / indexes             |
| `seed(config)`                                                            | Insert roles if the store is empty      |
| `loadConfig()`                                                            | `{ roles, strictRoles }` for the engine |
| `listRoles()` / `upsertRole` / `deleteRole`                               | Role graph                              |
| `getRolesForSubject` / `setRolesForSubject` / `assignRole` / `revokeRole` | Assignments                             |
| `getSettings` / `updateSettings`                                          | `strictRoles`                           |
| `close?()`                                                                | Close a pool/client this store created  |

`StoreNotFoundError` — role not found on get/delete.

### 7.4 `@corpcash/rbac-react`

| Export                                | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `RBACProvider`                        | Wraps the engine. Prefer `permissions` from the API, not `roles`. |
| `useRBAC()`                           | `{ can, subject, invalidPermissions, ... }`                       |
| `useCan(resource, action, instance?)` | Permission check                                                  |
| `useRole(roleName)`                   | Role check (inheritance if a role config was passed)              |
| `<Can resource action fallback?>`     | Conditional render                                                |
| `<RequirePermission>`                 | Section / page guard                                              |
| `<RequireRole>`                       | Role guard                                                        |

Malformed `resource:action` strings are skipped (fail closed) and reported via
`onInvalidPermissions` / `useRBAC().invalidPermissions`.

---

## 8. UI integration

Hooks, gates, and bootstrap:
[`packages/react/README.md`](./packages/react/README.md).

**Frontend RBAC is not security.** The API must authorize every request.

### Bootstrap

```
Login / user switch
        │
        ▼
GET /me/authorization   →  { subject, roles, permissions }
        │
        ▼
<RBACProvider subject={...} permissions={...}>
```

```tsx
import {
  RBACProvider,
  useCan,
  useRole,
  Can,
  RequirePermission,
} from "@corpcash/rbac-react";

<RBACProvider subject={auth.subject} permissions={auth.permissions}>
  <Dashboard />
</RBACProvider>;
```

### Generic UI (permission only)

Use when the check is not tied to one record:

```tsx
const canCreate = useCan("wallet", "create");

<Can resource="wallet" action="create">
  <button>Create wallet</button>
</Can>

<RequirePermission resource="wallet" action="read">
  <WalletList />
</RequirePermission>
```

### Instance UI (policy-aware)

Ownership and org/amount rules live on the backend. Do not copy them in React.
Ask the API, for example `GET /wallets/:id/capabilities`, which runs the same
`authorize()` as the mutating route.

```tsx
const caps = await fetchWalletCapabilities(wallet.id);
const canDelete = caps.capabilities.delete.allowed;
```

Even if someone shows a hidden button, `DELETE /wallets/:id` still returns 403.

---

## 9. Examples

```bash
pnpm install && pnpm build
```

| App     | Command                             | URL   | Shows                                                           |
| ------- | ----------------------------------- | ----- | --------------------------------------------------------------- |
| Express | `pnpm --filter example-express dev` | :3001 | Middleware, ownership policy                                    |
| NestJS  | `pnpm --filter example-nestjs dev`  | :3002 | Global guard, `@PublicRoute`                                    |
| Store   | `pnpm --filter example-store dev`   | :3004 | DB-backed roles + `/rbac` (`memoryStore` unless `DATABASE_URL`) |
| React   | `pnpm --filter example-react dev`   | :5173 | `useCan`, `<Can>`, role switcher                                |
| Next.js | `pnpm --filter example-nextjs dev`  | :3003 | App Router + client provider                                    |

Shared demo roles: `viewer`, `developer` (inherits viewer), `admin` (`*:*`).
APIs take `x-user-id: viewer | developer | admin`.

```bash
curl -H 'x-user-id: developer' http://localhost:3001/wallets
curl -H 'x-user-id: admin' http://localhost:3004/rbac/roles
```

Details: [`examples/README.md`](./examples/README.md).

---

## 10. Package READMEs

Full implementation guides (flow, every export, examples) on each package:

- [`packages/core/README.md`](./packages/core/README.md) — engine methods, helpers, errors
- [`packages/node/README.md`](./packages/node/README.md) — Express, Nest, admin HTTP
- [`packages/store/README.md`](./packages/store/README.md) — connect, migrate, store methods, admin `curl`
- [`packages/react/README.md`](./packages/react/README.md) — provider, hooks, gates

Demo-stack walkthrough (Corpcash backend + frontend):
[`../docs/BACKEND_FRONTEND_INTEGRATION.md`](../docs/BACKEND_FRONTEND_INTEGRATION.md)
(that path is the `feature-poc/docs` folder next to this repo).

```bash
pnpm verify
pnpm changeset
```

MIT — [LICENSE](./LICENSE).
