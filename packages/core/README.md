# @corpcash/rbac-core

Framework-agnostic authorization engine. Decisions happen here, in memory:

**subject + action + resource + context → allow / deny**

Node, store, and React are thin adapters over this package.

- [Install](#install)
- [Flow](#flow)
- [Concepts](#concepts)
- [1. Construct the engine](#1-construct-the-engine)
- [2. Register policies](#2-register-policies)
- [3. Decide](#3-decide)
- [RBAC methods](#rbac-methods)
- [Helpers](#helpers)
- [Errors](#errors)
- [Types](#types)

## Install

```bash
npm install @corpcash/rbac-core@^0.3.0
```

## Flow

The package does not load config from disk or a database. You construct an
`RBAC` instance, optionally register policies, then call `authorize` /
`can` on every decision.

```
1. new RBAC({ roles }) or new RBAC({ permissions })
2. rbac.registerPolicyFor(...)   ← instance rules; stay in code
3. rbac.authorize({ subject, action, resource, context? })
4. Hand the UI rbac.getEffectivePermissions(subject)
5. After a role-graph change: rbac.reload(nextConfig)
```

Evaluation order:

1. Resolve the subject (`id` required)
2. Expand roles (inheritance)
3. Match `resource:action` (wildcards allowed)
4. Run every matching policy — all must pass
5. Default deny if the permission is missing or a policy fails

Policies can only **narrow** a grant. They never add a permission.

To persist roles, use [`@corpcash/rbac-store`](../store). To put this on HTTP,
use [`@corpcash/rbac-node`](../node). For UI gates, use
[`@corpcash/rbac-react`](../react).

## Concepts

| Concept        | Meaning                                | Example                                      |
| -------------- | -------------------------------------- | -------------------------------------------- |
| **Subject**    | Who is asking                          | `{ id: "u1", roles: ["developer"] }`         |
| **Role**       | Named permissions, optional `inherits` | `developer` inherits `viewer`                |
| **Permission** | `resource:action`                      | `wallet:read`, `*:*`                         |
| **Action**     | Operation string                       | `read`, `delete`, `deploy`                   |
| **Resource**   | Type or instance                       | `"wallet"` or `{ type: "wallet", id: "w1" }` |
| **Policy**     | Extra check after a permission match   | owner of the wallet                          |

Wildcards: `wallet:*` (all actions on wallet), `*:read` (read anything),
`*:*` (everything).

---

## 1. Construct the engine

```typescript
import { RBAC } from "@corpcash/rbac-core";

const rbac = new RBAC({
  roles: {
    viewer: { permissions: ["wallet:read", "transaction:read"] },
    developer: {
      inherits: ["viewer"],
      permissions: ["wallet:create", "wallet:delete", "contract:deploy"],
    },
    admin: { permissions: ["*:*"] },
  },
  strictRoles: false,
  onDecision: ({ request, result, durationMs }) => {
    logger.info({ subject: request.subject.id, ...result, durationMs });
  },
});
```

`onDecision` exceptions are swallowed so a broken logger cannot change a
decision.

**Role mode** (`roles`) and **permission-only mode** (`permissions`) cannot be
combined. Permission-only is what the frontend uses after
`GET /me/authorization`:

```typescript
const ui = new RBAC({
  permissions: ["wallet:read", "wallet:create"],
});
```

Malformed entries in `permissions` are skipped (fail closed) and listed on
`rbac.invalidPermissions`. Role-mode permissions that are not
`resource:action` throw at construction.

Configuration is validated when the engine is constructed — cycles, dangling
`inherits`, and bad role permissions fail at startup.

---

## 2. Register policies

```typescript
rbac.registerPolicyFor("wallet", "delete", async ({ subject, resource }) => {
  if (typeof resource !== "object") return false;
  const wallet = await wallets.findById(String(resource.id));
  return wallet?.ownerId === subject.id;
});

// Same thing with an explicit key
rbac.registerPolicy("transaction:approve", ({ subject, resource, context }) => {
  return subject.attributes?.organizationId === context?.organizationId;
});
```

Matching keys, most specific first: `wallet:delete`, `wallet:*`, `*:delete`,
`*:*`. Every registered match must return `true`.

`reload()` keeps policies and `onDecision`. Register policies once at startup.

---

## 3. Decide

```typescript
const subject = { id: "u1", roles: ["developer"] };

rbac.can(subject, "read", "wallet"); // true

const result = rbac.authorize({
  subject,
  action: "delete",
  resource: { type: "wallet", id: "w1" },
  context: { tenantId: "org_1" },
});
// { allowed, reason, resource, action, matchedRole?, matchedPermission?, ignoredRoles? }

await rbac.canAsync(subject, "delete", { type: "wallet", id: "w1" });
await rbac.authorizeAsync({ subject, action: "delete", resource });
```

Use the async pair whenever a matching policy returns a promise. Sync
`authorize()` / `can()` throw `AsyncPolicyError` in that case.

A subject carrying a role that no longer exists is denied on that role, not
thrown at: the unknown role is skipped and reported in `result.ignoredRoles`.
Set `strictRoles: true` to throw `UnknownRoleError` instead.

---

## RBAC methods

### `constructor(config)` / `new RBAC(config)`

| Field         | Purpose                                               |
| ------------- | ----------------------------------------------------- |
| `roles`       | Role graph. Each value: `{ permissions?, inherits? }` |
| `permissions` | Flat list for the UI. Not with `roles`                |
| `strictRoles` | Default `false`: skip unknown subject roles           |
| `onDecision`  | Called after every decision                           |

### `can(subject, action, resource)`

Sync boolean. Same as `authorize(...).allowed`.

```typescript
rbac.can(user, "read", "wallet");
rbac.can(user, "delete", { type: "wallet", id: "w1" });
```

### `canAsync(subject, action, resource)`

Async boolean. Awaits policies.

```typescript
await rbac.canAsync(user, "delete", { type: "wallet", id: "w1" });
```

### `authorize(request)`

Sync `{ allowed, reason, ... }`.

```typescript
rbac.authorize({
  subject: user,
  action: "deploy",
  resource: "contract",
  context: { tenantId: "org_1" },
});
```

`reason`: `AUTHORIZED` | `MISSING_PERMISSION` | `POLICY_DENIED` | `NO_SUBJECT`.

### `authorizeAsync(request)`

Same result, awaits policies. Express/Nest adapters use this.

### `registerPolicyFor(resource, action, fn)`

Register a policy for `resource:action` (wildcards allowed in the key).

```typescript
rbac.registerPolicyFor("wallet", "delete", ownershipPolicy);
rbac.registerPolicyFor(
  "wallet",
  "*",
  ({ subject }) => subject.id !== "blocked"
);
```

`fn` receives `{ subject, action, resource, resourceType, context? }` and
returns `boolean | Promise<boolean>`.

### `registerPolicy(key, fn)`

Same, key is the string `"resource:action"`.

```typescript
rbac.registerPolicy("wallet:delete", ownershipPolicy);
```

### `reload(config)`

Replace compiled roles or the permission list. Policies and `onDecision`
stay. Invalid config throws and the previous graph remains.

```typescript
rbac.reload({
  roles: {
    viewer: { permissions: ["wallet:read"] },
    admin: { permissions: ["*:*"] },
  },
  strictRoles: false,
});
```

With a store: `reloadFromStore(rbac, store)` (see
[`@corpcash/rbac-store`](../store)).

### `getEffectivePermissions(subject)`

Flat list for the frontend. Expands inheritance, **not** policies.

```typescript
rbac.getEffectivePermissions(user);
// ["wallet:read", "wallet:create", "wallet:delete", "contract:deploy"]
```

### `getEffectiveRoles(subject)`

Roles including inheritance.

```typescript
rbac.getEffectiveRoles({ id: "u1", roles: ["developer"] });
// ["developer", "viewer"]
```

### `hasRole(subject, role)`

Inheritance-aware membership.

```typescript
rbac.hasRole(user, "viewer"); // true if user is developer → viewer
```

### `invalidPermissions`

Skipped entries in permission-only mode.

```typescript
const ui = new RBAC({ permissions: ["wallet:read", "not-a-permission"] });
ui.invalidPermissions; // ["not-a-permission"]
```

---

## Helpers

### `parsePermission(permission)` / `tryParsePermission(permission)`

```typescript
import {
  parsePermission,
  tryParsePermission,
  formatPermission,
} from "@corpcash/rbac-core";

parsePermission("wallet:read");
// { resource: "wallet", action: "read" }

tryParsePermission("nope"); // undefined
parsePermission("nope"); // throws InvalidPermissionError

formatPermission("wallet", "read"); // "wallet:read"
```

### `validateRoleGraph(roles)`

Walks inheritance before you persist or construct. Throws
`InvalidRBACConfigError` or `CircularRoleInheritanceError`.

```typescript
import { validateRoleGraph } from "@corpcash/rbac-core";

validateRoleGraph({
  viewer: { permissions: ["wallet:read"] },
  developer: { inherits: ["viewer"], permissions: ["wallet:create"] },
});
```

The store adapters call this before commit.

### `getResourceType(resource)`

```typescript
import { getResourceType } from "@corpcash/rbac-core";

getResourceType("wallet"); // "wallet"
getResourceType({ type: "wallet", id: "w1" }); // "wallet"
```

---

## Errors

| Error                          | When                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `InvalidRBACConfigError`       | `roles` + `permissions` together, dangling `inherits` |
| `CircularRoleInheritanceError` | Cycle in the role graph                               |
| `InvalidPermissionError`       | Permission is not `resource:action` (role mode)       |
| `UnknownRoleError`             | Unknown subject role and `strictRoles: true`          |
| `AsyncPolicyError`             | Async policy used with sync `authorize()` / `can()`   |

```typescript
import {
  AsyncPolicyError,
  CircularRoleInheritanceError,
  InvalidPermissionError,
  InvalidRBACConfigError,
  UnknownRoleError,
} from "@corpcash/rbac-core";
```

---

## Types

```typescript
interface Subject {
  id: string;
  roles: string[];
  attributes?: Record<string, unknown>;
}

type Resource = string | { type: string; id?: string; [key: string]: unknown };

interface AuthorizationRequest {
  subject: Subject;
  action: string;
  resource: Resource;
  context?: Record<string, unknown>;
}

interface AuthorizationResult {
  allowed: boolean;
  reason: "AUTHORIZED" | "MISSING_PERMISSION" | "POLICY_DENIED" | "NO_SUBJECT";
  resource: string;
  action: string;
  matchedRole?: string;
  matchedPermission?: string;
  ignoredRoles?: string[];
}

interface PolicyContext {
  subject: Subject;
  action: string;
  resource: Resource;
  resourceType: string;
  context?: Record<string, unknown>;
}
```

Also exported: `RBACConfig`, `RBACReloadConfig`, `RoleDefinition`,
`DecisionListener`, `AuthorizationDecision`, `PolicyFn`, `Action`,
`ResourceInstance`.

## License

MIT
