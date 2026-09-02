# @corpcash/rbac-react

React hooks and components for `@corpcash/rbac-core`.

## Installation

```bash
npm install @corpcash/rbac-react @corpcash/rbac-core react
```

## Important

**Frontend RBAC controls UX only.** Never rely on it for security. The backend must enforce authorization on every API call.

Initialize with **effective permissions** from your backend (e.g. `GET /me/authorization`), not the full role configuration.

## Usage

```tsx
import {
  RBACProvider,
  useCan,
  Can,
  RequirePermission,
} from "@corpcash/rbac-react";

function App() {
  return (
    <RBACProvider
      subject={{ id: user.id, roles: user.roles }}
      permissions={user.permissions}
      onInvalidPermissions={(invalid) =>
        reportToSentry("unusable permissions", invalid)
      }
    >
      <Dashboard />
    </RBACProvider>
  );
}

function Dashboard() {
  const canCreate = useCan("wallet", "create");

  return (
    <>
      {canCreate && <button>Create</button>}
      <Can resource="wallet" action="delete" fallback={<span>Denied</span>}>
        <DeleteButton />
      </Can>
      <RequirePermission resource="wallet" action="read">
        <WalletList />
      </RequirePermission>
    </>
  );
}
```

## Malformed permissions never break the tree

Permissions arrive over the network, so an entry that is not `resource:action`
is skipped rather than thrown during render. Skipped entries are reported
through `onInvalidPermissions` and exposed as `useRBAC().invalidPermissions`.
A skipped permission grants nothing, so the UI fails closed.

## useRole and inheritance

`useRole` asks the engine, so it accounts for inheritance when the provider was
given a `roles` config: a `developer` that inherits `viewer` returns `true` for
`useRole("viewer")`. In permission-only mode — the recommended setup — there is
no role graph on the client, so it falls back to the subject's own roles.

## API

| Export                                | Description                               |
| ------------------------------------- | ----------------------------------------- |
| `RBACProvider`                        | Context provider wrapping the RBAC engine |
| `useRBAC()`                           | Access engine, subject, and `can()`       |
| `useCan(resource, action, instance?)` | Permission check hook                     |
| `useRole(roleName)`                   | Role membership check, inheritance-aware  |
| `<Can>`                               | Conditional render by permission          |
| `<RequirePermission>`                 | Page/section guard                        |
| `<RequireRole>`                       | Role-based guard (convenience)            |

The engine is memoised on the **content** of `permissions` / `roles`, so passing
an inline array or object literal does not rebuild it on every render.

## License

MIT
