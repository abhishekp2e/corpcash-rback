# Store example

Persists the shared role config through `@corpcash/rbac-store` and mounts the
`/rbac` admin API.

```bash
pnpm install
pnpm build
pnpm --filter example-store dev
```

Uses `memoryStore()` by default. Set `DATABASE_URL` to a Postgres connection
string to use `postgresStore` instead (requires `pg`).

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/rbac pnpm --filter example-store dev
```

Listens on `http://localhost:3004`.

## Try it

`x-user-id` maps to the shared demo users (`viewer`, `developer`, `admin`) and
loads their roles from the store.

```bash
# wallets — same permission check as the Express example
curl -H 'x-user-id: developer' http://localhost:3004/wallets

# list roles (admin holds *:* so it satisfies rbac:manage)
curl -H 'x-user-id: admin' http://localhost:3004/rbac/roles

# create a role — the in-memory engine reloads
curl -X POST -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/roles \
  -d '{"name":"auditor","permissions":["wallet:read"]}'

# assign it
curl -X POST -H 'x-user-id: admin' -H 'content-type: application/json' \
  http://localhost:3004/rbac/subjects/viewer-1/roles \
  -d '{"role":"auditor"}'

# viewer cannot manage RBAC
curl -H 'x-user-id: viewer' http://localhost:3004/rbac/roles
# 403
```

Policies stay in code: `wallet:delete` is still narrowed by the ownership
policy from [`shared/wallets.store.ts`](../shared/wallets.store.ts).
