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
import { RBACProvider, useCan, Can, RequirePermission } from "@corpcash/rbac-react";

function App() {
  return (
    <RBACProvider
      subject={{ id: user.id, roles: user.roles }}
      permissions={user.permissions}
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

## API

| Export | Description |
|--------|-------------|
| `RBACProvider` | Context provider wrapping the RBAC engine |
| `useRBAC()` | Access engine, subject, and `can()` |
| `useCan(resource, action, instance?)` | Permission check hook |
| `useRole(roleName)` | Role membership check |
| `<Can>` | Conditional render by permission |
| `<RequirePermission>` | Page/section guard |
| `<RequireRole>` | Role-based guard (convenience) |

## License

MIT
