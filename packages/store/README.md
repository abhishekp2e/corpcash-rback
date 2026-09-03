# @corpcash/rbac-store

Persist the serializable RBAC config — roles, inheritance, `strictRoles`, and
subject-role assignments — in PostgreSQL, MySQL, or MongoDB. The decision
engine stays in memory.

## What is stored

| In the database                     | Stays in application code                  |
| ----------------------------------- | ------------------------------------------ |
| Role names, permissions, `inherits` | `PolicyFn` (`registerPolicyFor`)           |
| `strictRoles`                       | `onDecision`                               |
| Subject id → role names             | Express / Nest `getSubject`, `getResource` |

Policies are functions (often closing over a wallet store or ORM). There is no
policy DSL — register them after `createRBACFromStore`.

## Installation

```bash
npm install @corpcash/rbac-store @corpcash/rbac-core
# plus the driver you use
npm install pg
# or mysql2
# or mongodb
```

## Connect and load

```typescript
import { createRBACFromStore, reloadFromStore } from "@corpcash/rbac-store";
import { postgresStore } from "@corpcash/rbac-store/postgres";

const store = postgresStore({ connectionString: process.env.DATABASE_URL });
await store.migrate();
await store.seed({
  roles: {
    viewer: { permissions: ["wallet:read"] },
    admin: { permissions: ["*:*"] },
  },
});

const rbac = await createRBACFromStore(store, {
  onDecision: ({ result }) => console.info(result),
});

rbac.registerPolicyFor("wallet", "delete", async ({ subject, resource }) => {
  const wallet = await wallets.findById(String(resource.id));
  return wallet?.ownerId === subject.id;
});
```

`seed()` is a no-op when any role already exists, so deploys do not wipe live
config.

After an admin write, reload the in-memory graph:

```typescript
await store.upsertRole("auditor", { permissions: ["wallet:read"] });
await reloadFromStore(rbac, store);
```

Subject assignments are read per request, so they do not need a reload:

```typescript
import { createStoreSubjectResolver } from "@corpcash/rbac-store";

const getSubject = createStoreSubjectResolver(store, (req) => req.user?.id);
```

The frontend still receives **effective permissions** from
`rbac.getEffectivePermissions(subject)` — an upper bound that does not apply
policies.

## Adapters

| Import                                 | Options                                       |
| -------------------------------------- | --------------------------------------------- |
| `@corpcash/rbac-store/postgres`        | `{ connectionString }` or `{ pool }`          |
| `@corpcash/rbac-store/mysql`           | `{ url }` or `{ pool }`                       |
| `@corpcash/rbac-store/mongodb`         | `{ url, dbName? }` or `{ db }` / `{ client }` |
| `@corpcash/rbac-store` `memoryStore()` | tests and apps without a database             |

Table / collection names default to the `rbac_` prefix (`rbac_roles`,
`rbac_assignments`, `rbac_settings`). Override with `tablePrefix` or
`collectionPrefix` (letters, digits, underscore only).

## Schema

Relational adapters create:

- `rbac_roles(name PK, permissions json, inherits json, updated_at)`
- `rbac_assignments(subject_id, role_name, PK(subject_id, role_name))`
- `rbac_settings(id=1, strict_roles)`

Mongo uses collections of the same names. `migrate()` is idempotent.

Writes validate the role graph and permission strings **before** commit.
Deleting a role that others inherit, or that is still assigned, fails.

## Store methods

```ts
await store.migrate();
await store.seed(config); // no-op if any role exists
await store.loadConfig(); // { roles, strictRoles }

await store.listRoles();
await store.upsertRole(name, def);
await store.deleteRole(name);

await store.getRolesForSubject(id);
await store.setRolesForSubject(id, roles);
await store.assignRole(id, role);
await store.revokeRole(id, role);

await store.getSettings();
await store.updateSettings({ strictRoles: true });
```

Writes validate the full graph first. Deleting a role that other roles inherit,
or that is still assigned to a subject, throws `InvalidRBACConfigError`.

## Admin API

`@corpcash/rbac-node` mounts a small HTTP API in front of the store. Every
route requires `rbac:manage` (or `*:*`).

```typescript
import { createRBACFromStore } from "@corpcash/rbac-store";
import { createRbacAdminRouter } from "@corpcash/rbac-node/express";

app.use("/rbac", createRbacAdminRouter({ store, rbac }));
```

| Method         | Path                             |
| -------------- | -------------------------------- |
| GET/POST       | `/rbac/roles`                    |
| GET/PUT/DELETE | `/rbac/roles/:name`              |
| GET/PUT/POST   | `/rbac/subjects/:id/roles`       |
| DELETE         | `/rbac/subjects/:id/roles/:role` |
| GET/PATCH      | `/rbac/settings`                 |

NestJS: `RbacModule.forRootAsync({ store, getSubject, configure })` plus
`RbacAdminModule.register()`. Full route table is in the
[`@corpcash/rbac-node` README](../node).

A runnable app is in [`examples/store`](../../examples/store).

## License

MIT
