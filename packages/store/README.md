# @corpcash/rbac-store

Persist the serializable RBAC config — roles, inheritance, `strictRoles`, and
subject-role assignments — in PostgreSQL, MySQL, or MongoDB. The decision
engine stays in memory.

Full monorepo guide: [`../../README.md`](../../README.md).

- [What is stored](#what-is-stored)
- [Install](#install)
- [Flow: connect → migrate → two write paths](#flow-connect--migrate--two-write-paths)
- [1. Connect the database](#1-connect-the-database)
- [2. Call `migrate()` in your startup](#2-call-migrate-in-your-startup)
- [3. Load the engine](#3-load-the-engine)
- [4. Two ways to add roles and permissions](#4-two-ways-to-add-roles-and-permissions)
- [Store methods](#store-methods)
- [Admin HTTP API](#admin-http-api)
- [Adapters and schema](#adapters-and-schema)

## What is stored

| In the database                     | Stays in application code                  |
| ----------------------------------- | ------------------------------------------ |
| Role names, permissions, `inherits` | `PolicyFn` (`registerPolicyFor`)           |
| `strictRoles`                       | `onDecision`                               |
| Subject id → role names             | Express / Nest `getSubject`, `getResource` |

Policies are functions. There is no policy DSL and no admin route for them —
register them after `createRBACFromStore`.

## Install

```bash
npm install @corpcash/rbac-store@^0.3.0 @corpcash/rbac-core@^0.3.0
npm install pg
# or: npm install mysql2
# or: npm install mongodb
```

For the admin HTTP API, also install `@corpcash/rbac-node@^0.3.0`.

## Flow: connect → migrate → two write paths

The package does **not** connect or migrate when you import it. Your app
startup must do this:

```
1. Create a store adapter (postgres / mysql / mongo / memory)
2. await store.migrate()     ← you call this; creates tables only
3. optional store.seed(...)  ← first-boot roles if the table is empty
4. createRBACFromStore(store)
5. registerPolicyFor(...)    ← instance rules stay in code
6. Add roles / permissions / assignments with either:

      A. Store methods          B. Admin HTTP API (/rbac)
         store.upsertRole(...)     POST /rbac/roles
         store.assignRole(...)     PUT  /rbac/subjects/:id/roles
```

Both write paths use the **same tables**. The admin router calls the store
methods, then reloads the in-memory engine after role-graph writes.

```
store.upsertRole  ──►  rbac_roles
POST /rbac/roles  ──┘
                         │
                         ▼
              reloadFromStore (admin does this)
                         │
                         ▼
              in-memory RBAC engine
```

Assignment writes do **not** need a reload: `getSubject` reads
`rbac_assignments` on each request.

## 1. Connect the database

```typescript
import { postgresStore } from "@corpcash/rbac-store/postgres";
// import { mysqlStore } from "@corpcash/rbac-store/mysql";
// import { mongoStore } from "@corpcash/rbac-store/mongodb";
// import { memoryStore } from "@corpcash/rbac-store";

const store = postgresStore({
  connectionString: process.env.DATABASE_URL,
  // or: pool: existingPgPool,
  // tablePrefix: "rbac_",   // default
});
```

| Import                                 | Options                                       |
| -------------------------------------- | --------------------------------------------- |
| `@corpcash/rbac-store/postgres`        | `{ connectionString }` or `{ pool }`          |
| `@corpcash/rbac-store/mysql`           | `{ url }` or `{ pool }`                       |
| `@corpcash/rbac-store/mongodb`         | `{ url, dbName? }` or `{ db }` / `{ client }` |
| `@corpcash/rbac-store` `memoryStore()` | tests and apps without a database             |

Connecting only builds the adapter. Tables do not exist until you call
`migrate()` (or create them yourself).

## 2. Call `migrate()` in your startup

`migrate()` is idempotent. It creates schema and the default settings row. It
does **not** insert roles, permissions, or assignments.

```typescript
const store = postgresStore({ connectionString: process.env.DATABASE_URL });
await store.migrate();
```

Call it once at process start, after you have a store instance — the same
place you already boot Express/Nest. See
[`examples/store/src/index.ts`](../../examples/store/src/index.ts).

Schema created:

- `rbac_roles(name PK, permissions json, inherits json, updated_at)`
- `rbac_assignments(subject_id, role_name, PK(subject_id, role_name))`
- `rbac_settings(id=1, strict_roles)`

Mongo uses collections of the same names. Override the `rbac_` prefix with
`tablePrefix` / `collectionPrefix` (letters, digits, underscore only).

## 3. Load the engine

```typescript
import {
  createRBACFromStore,
  createStoreSubjectResolver,
  reloadFromStore,
} from "@corpcash/rbac-store";

// Optional first boot: insert roles only if none exist
await store.seed({
  roles: {
    viewer: { permissions: ["wallet:read"] },
    admin: { permissions: ["*:*"] },
  },
});

const rbac = await createRBACFromStore(store, {
  onDecision: ({ result }) => console.info(result),
});

// Instance rules — not stored, not on /rbac
rbac.registerPolicyFor("wallet", "delete", async ({ subject, resource }) => {
  if (typeof resource !== "object") return false;
  const wallet = await wallets.findById(String(resource.id));
  return wallet?.ownerId === subject.id;
});

const getSubject = createStoreSubjectResolver(store, (req) => req.user?.id);
```

`createRBACFromStore` calls `store.loadConfig()` and builds the in-memory
engine. Empty tables → empty role graph.

If you skip `seed()`, create the first admin in code so `/rbac` can be used
(every admin route requires `rbac:manage` or `*:*`):

```typescript
if ((await store.listRoles()).length === 0) {
  await store.upsertRole("admin", { permissions: ["*:*"] });
  await store.assignRole("your-admin-user-id", "admin");
  await reloadFromStore(rbac, store);
}
```

## 4. Two ways to add roles and permissions

|              | Store methods                                       | Admin HTTP API                          |
| ------------ | --------------------------------------------------- | --------------------------------------- |
| Who calls it | Your app, a script, or a custom UI                  | `curl`, Postman, or an admin screen     |
| Package      | `@corpcash/rbac-store`                              | `@corpcash/rbac-node`                   |
| Reload       | You call `reloadFromStore` after role-graph writes  | Router reloads after role-graph writes  |
| Auth         | Whatever wraps your script                          | Caller must have `rbac:manage` or `*:*` |
| Same data    | `rbac_roles` / `rbac_assignments` / `rbac_settings` | Same tables                             |

Pick one per write. Mixing is fine: seed with store methods, then edit live
via `/rbac`.

---

## Store methods

After `migrate()`, use these on the `RBACStore` instance. Role-graph writes
validate permissions (`resource:action`) and inheritance **before** commit.

Reload after: `upsertRole`, `deleteRole`, `updateSettings`, `seed` (if it
inserted). Do **not** reload after assignment methods.

### `migrate()`

Creates tables / collections if they are missing. Safe to call on every boot.

```typescript
await store.migrate();
```

### `seed(config)`

Inserts roles (and optional `strictRoles`) **only when no role exists**. Later
deploys are a no-op.

```typescript
await store.seed({
  roles: {
    viewer: { permissions: ["wallet:read", "transaction:read"] },
    developer: {
      inherits: ["viewer"],
      permissions: ["wallet:create", "wallet:delete"],
    },
    admin: { permissions: ["*:*"] },
  },
  strictRoles: false,
});
```

### `loadConfig()`

Returns `{ roles, strictRoles }` for the engine. Used by
`createRBACFromStore` and `reloadFromStore`.

```typescript
const config = await store.loadConfig();
// { roles: { viewer: { permissions, inherits }, ... }, strictRoles: false }
```

### `listRoles()`

```typescript
const roles = await store.listRoles();
// [{ name: "viewer", permissions: ["wallet:read"], inherits: [] }, ...]
```

### `upsertRole(name, def)`

Create or replace a role. Then reload the engine.

```typescript
import { reloadFromStore } from "@corpcash/rbac-store";

await store.upsertRole("viewer", {
  permissions: ["wallet:read", "transaction:read"],
});

await store.upsertRole("developer", {
  inherits: ["viewer"],
  permissions: ["wallet:create", "wallet:delete", "contract:deploy"],
});

await store.upsertRole("auditor", { permissions: ["wallet:read"] });
await reloadFromStore(rbac, store);
```

Invalid `inherits` (unknown role or cycle) or a permission that is not
`resource:action` throws `InvalidRBACConfigError` /
`CircularRoleInheritanceError` / `InvalidPermissionError`.

### `deleteRole(name)`

Fails if the role does not exist (`StoreNotFoundError`), is still assigned, or
is inherited by another role.

```typescript
await store.deleteRole("auditor");
await reloadFromStore(rbac, store);
```

### `getRolesForSubject(subjectId)`

```typescript
const roles = await store.getRolesForSubject("user-42");
// ["developer"]
```

### `setRolesForSubject(subjectId, roles)`

Replaces the subject's roles. Each name must already exist. No reload.

```typescript
await store.setRolesForSubject("user-42", ["developer"]);
await store.setRolesForSubject("user-42", []); // revoke all
```

### `assignRole(subjectId, role)`

Adds one role. Idempotent if already assigned. No reload.

```typescript
await store.assignRole("user-42", "viewer");
```

### `revokeRole(subjectId, role)`

Removes one assignment. No error if it was not assigned. No reload.

```typescript
await store.revokeRole("user-42", "viewer");
```

### `getSettings()` / `updateSettings(patch)`

```typescript
await store.getSettings();
// { strictRoles: false }

await store.updateSettings({ strictRoles: true });
await reloadFromStore(rbac, store);
```

`strictRoles: true` makes an unknown role on a subject throw instead of
skipping it.

### `close()`

Optional. Closes a pool/client **this store created**. Skip it if you passed
your own `pool` / `client`.

```typescript
await store.close?.();
```

### Helpers (not on `RBACStore`, same package)

```typescript
import {
  createRBACFromStore,
  reloadFromStore,
  createStoreSubjectResolver,
  StoreNotFoundError,
} from "@corpcash/rbac-store";

const rbac = await createRBACFromStore(store, { onDecision });
await reloadFromStore(rbac, store);
const getSubject = createStoreSubjectResolver(store, (req) => req.user?.id);
```

---

## Admin HTTP API

These routes are the second write path. They sit in `@corpcash/rbac-node` and
call the store methods above.

### Mount (Express)

```typescript
import { createRbacAdminRouter } from "@corpcash/rbac-node/express";

app.use("/rbac", createRbacAdminRouter({ store, rbac, getSubject }));
```

If `getSubject` is omitted, the router reads `x-user-id` and loads that
subject's roles from the store.

### Mount (NestJS)

```typescript
import { RbacModule, RbacAdminModule } from "@corpcash/rbac-node/nestjs";

RbacModule.forRootAsync({
  store,
  getSubject: (ctx) => ctx.switchToHttp().getRequest().user,
  configure: (rbac) => rbac.registerPolicyFor("wallet", "delete", policy),
});
RbacAdminModule.register();
```

### Auth

Every route requires permission `rbac:manage` (or `*:*`). Typical errors:
**401** no subject, **403** missing permission, **400** invalid graph,
**404** missing role.

The examples below use the store example on port **3004** and
`x-user-id: admin` (admin has `*:*`).

### Roles

**List roles** — `GET /rbac/roles` → `store.listRoles()`

```bash
curl -H 'x-user-id: admin' http://localhost:3004/rbac/roles
```

```json
[
  { "name": "admin", "permissions": ["*:*"], "inherits": [] },
  { "name": "viewer", "permissions": ["wallet:read"], "inherits": [] }
]
```

**Create role** — `POST /rbac/roles` → `upsertRole` + reload. **201**

```bash
curl -X POST -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/roles \
  -d '{"name":"auditor","permissions":["wallet:read"]}'
```

```json
{ "name": "auditor", "permissions": ["wallet:read"], "inherits": [] }
```

With inheritance:

```bash
curl -X POST -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/roles \
  -d '{"name":"developer","inherits":["viewer"],"permissions":["wallet:delete"]}'
```

**Get one role** — `GET /rbac/roles/:name`

```bash
curl -H 'x-user-id: admin' http://localhost:3004/rbac/roles/auditor
```

**Replace role** — `PUT /rbac/roles/:name` → `upsertRole` + reload

```bash
curl -X PUT -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/roles/auditor \
  -d '{"permissions":["wallet:read","transaction:read"],"inherits":[]}'
```

**Delete role** — `DELETE /rbac/roles/:name` → `deleteRole` + reload. **204**

```bash
curl -X DELETE -H 'x-user-id: admin' \
  http://localhost:3004/rbac/roles/auditor
```

### Assignments

**List a subject's roles** — `GET /rbac/subjects/:id/roles`

```bash
curl -H 'x-user-id: admin' \
  http://localhost:3004/rbac/subjects/viewer-1/roles
```

```json
{ "subjectId": "viewer-1", "roles": ["viewer"] }
```

**Replace all roles** — `PUT /rbac/subjects/:id/roles` → `setRolesForSubject`

```bash
curl -X PUT -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/subjects/user-42/roles \
  -d '{"roles":["developer"]}'
```

**Add one role** — `POST /rbac/subjects/:id/roles` → `assignRole`. **201**

```bash
curl -X POST -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/subjects/user-42/roles \
  -d '{"role":"auditor"}'
```

**Remove one role** — `DELETE /rbac/subjects/:id/roles/:role` → `revokeRole`.
**204**

```bash
curl -X DELETE -H 'x-user-id: admin' \
  http://localhost:3004/rbac/subjects/user-42/roles/auditor
```

### Settings

**Get** — `GET /rbac/settings` → `getSettings`

```bash
curl -H 'x-user-id: admin' http://localhost:3004/rbac/settings
```

```json
{ "strictRoles": false }
```

**Patch** — `PATCH /rbac/settings` → `updateSettings` + reload

```bash
curl -X PATCH -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/settings \
  -d '{"strictRoles":true}'
```

### Route map

| Method | Path                             | Store method         | Reloads engine |
| ------ | -------------------------------- | -------------------- | -------------- |
| GET    | `/rbac/roles`                    | `listRoles`          | no             |
| POST   | `/rbac/roles`                    | `upsertRole`         | yes            |
| GET    | `/rbac/roles/:name`              | `listRoles` (find)   | no             |
| PUT    | `/rbac/roles/:name`              | `upsertRole`         | yes            |
| DELETE | `/rbac/roles/:name`              | `deleteRole`         | yes            |
| GET    | `/rbac/subjects/:id/roles`       | `getRolesForSubject` | no             |
| PUT    | `/rbac/subjects/:id/roles`       | `setRolesForSubject` | no             |
| POST   | `/rbac/subjects/:id/roles`       | `assignRole`         | no             |
| DELETE | `/rbac/subjects/:id/roles/:role` | `revokeRole`         | no             |
| GET    | `/rbac/settings`                 | `getSettings`        | no             |
| PATCH  | `/rbac/settings`                 | `updateSettings`     | yes            |

Runnable app: [`examples/store`](../../examples/store) (`pnpm --filter
example-store dev`). Use `DATABASE_URL` for Postgres; otherwise `memoryStore()`.

---

## Adapters and schema

Writes validate the graph before commit. You cannot delete a role that others
inherit or that is still assigned.

A runnable walkthrough is in [`examples/store`](../../examples/store).

## License

MIT
