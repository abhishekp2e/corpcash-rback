# @corpcash/rbac-core

Framework-agnostic RBAC authorization engine.

## Installation

```bash
npm install @corpcash/rbac-core
```

## Concepts

| Concept | Description |
|---------|-------------|
| **Subject** | Who is requesting (`id`, `roles`, optional `attributes`) |
| **Role** | Named permission collection with optional inheritance |
| **Permission** | `resource:action` (e.g. `wallet:read`) |
| **Resource** | String type or instance `{ type, id, ... }` |
| **Action** | Arbitrary operation string |
| **Policy** | Optional condition after permission match |

## Usage

```typescript
import { RBAC } from "@corpcash/rbac-core";

const rbac = new RBAC({
  roles: {
    admin: { permissions: ["*:*"] },
    developer: {
      inherits: ["viewer"],
      permissions: ["wallet:create"],
    },
    viewer: { permissions: ["wallet:read"] },
  },
});

// Shorthand
rbac.can(subject, "read", "wallet");

// Rich result
const result = rbac.authorize({
  subject,
  action: "delete",
  resource: { type: "wallet", id: "w1", ownerId: "u1" },
  context: { tenantId: "org_1" },
});
// { allowed, reason, matchedRole, matchedPermission }

// Policies
rbac.registerPolicyFor("wallet", "delete", ({ subject, resource }) => {
  return typeof resource === "object" && subject.id === resource.ownerId;
});

// Expand permissions for frontend
rbac.getEffectivePermissions(subject);
```

## Wildcards

- `wallet:*` — all actions on wallet
- `*:read` — read any resource
- `*:*` — full access

## Default Deny

Missing permissions always result in denial.

## License

MIT
