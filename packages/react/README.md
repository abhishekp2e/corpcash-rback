# @corpcash/rbac-react

React provider, hooks, and gates over `@corpcash/rbac-core`.

**Frontend RBAC is UX only.** The backend must authorize every API request.

- [Install](#install)
- [Flow](#flow)
- [1. Bootstrap from the API](#1-bootstrap-from-the-api)
- [2. Generic UI vs instance UI](#2-generic-ui-vs-instance-ui)
- [Exports](#exports)
- [Props](#props)

## Install

```bash
npm install @corpcash/rbac-react@^0.3.0 @corpcash/rbac-core@^0.3.0 react
```

## Flow

Do **not** send the role graph or policy code to the browser. Send **effective
permissions** from the backend, then wrap the tree.

```
Login / user switch
        │
        ▼
GET /me/authorization  →  { subject, roles, permissions }
        │
        ▼
<RBACProvider subject={...} permissions={...}>
        │
        ├── useCan / <Can> / <RequirePermission>   generic UI
        └── GET /wallets/:id/capabilities          instance UI (policies)
```

`permissions` expands inheritance on the server. It does **not** apply
policies. Treat it as an upper bound: the API can still return 403.

```
1. Fetch GET /me/authorization after login
2. <RBACProvider subject permissions>
3. Hide buttons with useCan / <Can> (type-level only)
4. For one record (delete this wallet), ask the backend capabilities API
5. Never copy ownership / amount policies into React
```

---

## 1. Bootstrap from the API

```tsx
import {
  RBACProvider,
  useCan,
  useRole,
  useRBAC,
  Can,
  RequirePermission,
  RequireRole,
} from "@corpcash/rbac-react";

const auth = await fetch("/me/authorization").then((r) => r.json());
// { subject: { id, roles }, permissions: ["wallet:read", ...] }

function App() {
  return (
    <RBACProvider
      subject={auth.subject}
      permissions={auth.permissions}
      onInvalidPermissions={(invalid) =>
        reportToSentry("unusable permissions", invalid)
      }
    >
      <Dashboard />
    </RBACProvider>
  );
}
```

Pass `permissions`, not `roles`. Permission-only mode is the recommended
setup.

Malformed `resource:action` strings are skipped (fail closed). They grant
nothing, are reported via `onInvalidPermissions`, and appear on
`useRBAC().invalidPermissions`.

The engine is memoised on the **content** of `permissions` / `roles`, so an
inline array does not rebuild it on every render.

---

## 2. Generic UI vs instance UI

**Generic** — the check is not tied to one record (`wallet:create`, show the
list). Use hooks and components below.

**Instance** — ownership or amount rules. Do not evaluate those in React. Call
the same `authorize()` the mutating route uses, e.g.
`GET /wallets/:id/capabilities`, and hide the button from that payload.

Even if someone shows a hidden button, `DELETE /wallets/:id` still returns 403.

---

## Exports

### `RBACProvider`

Wraps the tree. Creates an `RBAC` engine from `permissions` or `roles`.

```tsx
<RBACProvider subject={subject} permissions={permissions}>
  <App />
</RBACProvider>
```

Must wrap any hook or gate. `useRBAC` / `useCan` throw if used outside.

### `useRBAC()`

```tsx
function Debug() {
  const { can, subject, invalidPermissions, rbac } = useRBAC();

  return (
    <pre>
      {JSON.stringify(
        {
          id: subject.id,
          canCreate: can("wallet", "create"),
          invalidPermissions,
        },
        null,
        2
      )}
    </pre>
  );
}
```

| Field                              | Meaning                    |
| ---------------------------------- | -------------------------- |
| `rbac`                             | The in-memory engine       |
| `subject`                          | The `subject` prop         |
| `invalidPermissions`               | Skipped permission strings |
| `can(resource, action, instance?)` | Same check as `useCan`     |

### `useCan(resource, action, instance?)`

```tsx
function Toolbar() {
  const canCreate = useCan("wallet", "create");
  const canDeleteThis = useCan("wallet", "delete", {
    type: "wallet",
    id: wallet.id,
  });

  return (
    <>
      {canCreate && <button>Create</button>}
      {canDeleteThis && <button>Delete</button>}
    </>
  );
}
```

The optional third argument is a resource **instance**. On the client this
still only checks the permission list unless you also passed `roles` and
registered policies — which you should not do in the browser. For ownership,
use a capabilities endpoint.

### `useRole(roleName)`

Inheritance-aware **only** if the provider was given a `roles` config. In
permission-only mode it checks `subject.roles` only.

```tsx
function AdminLink() {
  const isAdmin = useRole("admin");
  return isAdmin ? <a href="/admin">Admin</a> : null;
}
```

### `<Can>`

Conditional render by permission.

```tsx
<Can resource="wallet" action="create">
  <button>Create wallet</button>
</Can>

<Can
  resource="wallet"
  action="delete"
  resourceInstance={{ type: "wallet", id: wallet.id }}
  fallback={<span>Denied</span>}
>
  <DeleteButton />
</Can>
```

### `<RequirePermission>`

Same check as `<Can>`, intended as a page / section guard.

```tsx
<RequirePermission resource="wallet" action="read" fallback={<p>No access</p>}>
  <WalletList />
</RequirePermission>
```

### `<RequireRole>`

Role guard. Same inheritance rules as `useRole`.

```tsx
<RequireRole role="admin" fallback={<p>Admins only</p>}>
  <AdminPanel />
</RequireRole>
```

---

## Props

### `RBACProvider`

| Prop                   | Required    | Purpose                                                   |
| ---------------------- | ----------- | --------------------------------------------------------- |
| `subject`              | yes         | `{ id, roles, attributes? }`                              |
| `permissions`          | recommended | Effective list from the API                               |
| `roles`                | no          | Full graph. Do not send this to the browser in production |
| `onInvalidPermissions` | no          | Called when `permissions` has unusable entries            |
| `children`             | yes         | Tree                                                      |

`permissions` and `roles` together: the provider prefers `permissions` (it
constructs `new RBAC({ permissions })` when that prop is set).

### `<Can>` / `<RequirePermission>`

| Prop               | Purpose                               |
| ------------------ | ------------------------------------- |
| `resource`         | Resource type (`wallet`)              |
| `action`           | Action (`create`)                     |
| `resourceInstance` | Optional instance for the engine      |
| `fallback`         | Rendered when denied (default `null`) |
| `children`         | Rendered when allowed                 |

### `<RequireRole>`

| Prop       | Purpose                                          |
| ---------- | ------------------------------------------------ |
| `role`     | Role name                                        |
| `fallback` | Rendered when the subject does not have the role |
| `children` | Rendered when they do                            |

Types also exported: `RBACProviderProps`, `RBACContextValue`, `CanProps`,
`RequirePermissionProps`, `RequireRoleProps`.

Runnable apps: [`examples/react`](../../examples/react),
[`examples/nextjs`](../../examples/nextjs).

## License

MIT
