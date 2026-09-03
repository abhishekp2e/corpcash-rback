# Examples

Five runnable apps. The two API examples share one role configuration and one
wallet store so their behaviour can be compared side by side; the two UI
examples run in permission-only mode, which is how a browser should use this
library.

```bash
pnpm install
pnpm build          # the examples consume the built packages
```

| Example                | Run                                 | URL                     | Shows                                                        |
| ---------------------- | ----------------------------------- | ----------------------- | ------------------------------------------------------------ |
| [`express`](./express) | `pnpm --filter example-express dev` | `http://localhost:3001` | Middleware, async ownership policy, audit hook               |
| [`nestjs`](./nestjs)   | `pnpm --filter example-nestjs dev`  | `http://localhost:3002` | Global guard, deny-by-default, `@PublicRoute()`, `configure` |
| [`react`](./react)     | `pnpm --filter example-react dev`   | `http://localhost:5173` | `useCan`, `useRole`, `<Can>`, `<RequirePermission>`          |
| [`nextjs`](./nextjs)   | `pnpm --filter example-nextjs dev`  | `http://localhost:3003` | App Router with the provider in a client component           |
| [`store`](./store)     | `pnpm --filter example-store dev`   | `http://localhost:3004` | DB-backed roles, assignments, and the `/rbac` admin API      |

## Shared setup (API examples)

[`shared/rbac.config.ts`](./shared/rbac.config.ts) defines the roles:

| Role        | Permissions                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `viewer`    | `wallet:read`, `transaction:read`                                                                         |
| `developer` | inherits `viewer` + `wallet:create`, `wallet:update`, `wallet:delete`, `contract:read`, `contract:deploy` |
| `admin`     | `*:*`                                                                                                     |

Both APIs read the caller from an `x-user-id` header, which maps to `viewer`
(`viewer-1`), `developer` (`dev-1`) or `admin` (`admin-1`). No header means no
subject.

[`shared/wallets.store.ts`](./shared/wallets.store.ts) holds two wallets behind
an awaited lookup, so the ownership policy has something to load:
`wallet_1` belongs to `dev-1`, `wallet_2` belongs to `viewer-1`.

## The delete matrix

`wallet:delete` is granted broadly to `developer` and `admin`, then narrowed by
an async ownership policy registered on `wallet:delete`. Permissions are checked
first, so the two denials are distinguishable:

| Request                                  | Result                     |
| ---------------------------------------- | -------------------------- |
| `developer` deletes `wallet_1` (owns it) | `200`                      |
| `developer` deletes `wallet_2`           | `403` `POLICY_DENIED`      |
| `admin` deletes `wallet_1` (holds `*:*`) | `403` `POLICY_DENIED`      |
| `viewer` deletes `wallet_1`              | `403` `MISSING_PERMISSION` |
| no header                                | `401`                      |

A wildcard role is not above a policy: `admin` matches the permission and is
still denied because it does not own the wallet.

```bash
curl -X DELETE -H 'x-user-id: developer' http://localhost:3001/wallets/wallet_1
# {"deleted":"wallet_1"}

curl -X DELETE -H 'x-user-id: admin' http://localhost:3001/wallets/wallet_1
# {"statusCode":403,"error":"Forbidden","message":"…","reason":"POLICY_DENIED"}
```

Every decision is printed by the `onDecision` hook, allowed or denied:

```json
{
  "event": "authorization",
  "subject": "dev-1",
  "action": "delete",
  "resource": "wallet",
  "allowed": false,
  "reason": "POLICY_DENIED",
  "matchedRole": "developer",
  "durationMs": 6
}
```

## Express

[`express/src/index.ts`](./express/src/index.ts) registers the middleware per
route. The `DELETE` route passes `getResource` so the policy receives the wallet
instance while the route's declared `wallet` still decides which permission is
checked.

`GET /me/authorization` returns `getEffectivePermissions(subject)` — the list a
frontend should be initialised with.

## NestJS

[`nestjs/src/main.ts`](./nestjs/src/main.ts) registers the guard **globally**
with `APP_GUARD`, so every handler needs `@RequirePermission` or `@PublicRoute`:

| Request                                  | Result                              |
| ---------------------------------------- | ----------------------------------- |
| `GET /me/authorization` (`@PublicRoute`) | `200`, no subject required          |
| `GET /me/forgotten` (unannotated)        | `403` `MISSING_PERMISSION_METADATA` |

`/me/forgotten` is deliberately left undecorated to show that a forgotten
decorator closes an endpoint instead of exposing it. The ownership policy is
registered through the module's `configure` hook, which runs against the engine
at startup.

The same wiring is covered end to end in
[`packages/node/src/__tests__/nestjs.e2e.test.ts`](../packages/node/src/__tests__/nestjs.e2e.test.ts),
which boots a real application and asserts each of these responses.

## Store

[`store/src/index.ts`](./store/src/index.ts) persists the shared role config
through `@corpcash/rbac-store`. It uses `memoryStore()` unless `DATABASE_URL` is
set, in which case it uses Postgres. Demo users are written as assignments, and
`/rbac` is the admin API (`rbac:manage` via the admin `*:*` role).

```bash
pnpm --filter example-store dev
# or DATABASE_URL=postgres://… pnpm --filter example-store dev

curl -H 'x-user-id: admin' http://localhost:3004/rbac/roles
curl -X POST -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/roles \
  -d '{"name":"auditor","permissions":["wallet:read"]}'
```

See [`store/README.md`](./store/README.md) for more.

## React and Next.js

Both initialise `RBACProvider` with a flat permission list rather than the role
configuration, mirroring a browser that fetched `GET /me/authorization`. The
React example has a role switcher so you can watch the UI change; the Next.js
example puts the provider in a `"use client"` component.

**These examples control visibility only.** The API examples are the ones
enforcing anything.
