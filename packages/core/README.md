# @corpcash/rbac-core

Framework-agnostic RBAC authorization engine.

## Installation

```bash
npm install @corpcash/rbac-core
```

## Concepts

| Concept        | Description                                              |
| -------------- | -------------------------------------------------------- |
| **Subject**    | Who is requesting (`id`, `roles`, optional `attributes`) |
| **Role**       | Named permission collection with optional inheritance    |
| **Permission** | `resource:action` (e.g. `wallet:read`)                   |
| **Resource**   | String type or instance `{ type, id, ... }`              |
| **Action**     | Arbitrary operation string                               |
| **Policy**     | Optional condition after permission match                |

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
// { allowed, reason, matchedRole, matchedPermission, ignoredRoles? }
```

## Configuration is validated at construction

`new RBAC(...)` throws immediately on a bad configuration, so a broken deploy
fails at startup rather than on the first request that touches the bad branch:

- `CircularRoleInheritanceError` — a cycle anywhere in the role graph
- `InvalidRBACConfigError` — an `inherits` entry with no definition, or `roles`
  and `permissions` supplied together
- `InvalidPermissionError` — a role permission that is not `resource:action`

## Unknown roles are ignored, not fatal

A subject can arrive with a role you have since deleted — a token issued before
the last deploy, for instance. Those roles are skipped, the decision is made on
the remaining ones, and the skipped names are reported:

```typescript
const result = rbac.authorize({
  subject: { id: "u1", roles: ["viewer", "legacy_ops"] },
  action: "read",
  resource: "wallet",
});
// { allowed: true, matchedRole: "viewer", ignoredRoles: ["legacy_ops"] }
```

Set `strictRoles: true` to get an `UnknownRoleError` instead. Do that only where
you can handle the throw; on a request path it turns an authorization failure
into a server error.

## Policies

Policies run **after** a permission matched, and they can only narrow the grant:

- A policy never grants something the permissions did not.
- Every policy whose key matches the request must pass. Keys are checked in
  order of specificity — `wallet:delete`, `wallet:*`, `*:delete`, `*:*` — and all
  registered matches must return `true`.

```typescript
rbac.registerPolicyFor("wallet", "delete", ({ subject, resource }) => {
  return typeof resource === "object" && subject.id === resource.ownerId;
});
```

### Async policies

Ownership usually has to be loaded. Return a promise and use the async API:

```typescript
rbac.registerPolicyFor("wallet", "delete", async ({ subject, resource }) => {
  const wallet = await wallets.findById(String(resource.id));
  return wallet?.ownerId === subject.id;
});

await rbac.authorizeAsync({ subject, action: "delete", resource });
await rbac.canAsync(subject, "delete", resource);
```

The synchronous `authorize()` throws `AsyncPolicyError` if a matching policy
returns a promise, rather than silently treating it as `true`.

## Auditing

`onDecision` receives every decision, allowed or denied. Exceptions thrown by
the listener are swallowed, so a broken log sink cannot change a decision:

```typescript
const rbac = new RBAC({
  roles,
  onDecision: ({ request, result, durationMs }) => {
    logger.info({
      subject: request.subject.id,
      action: result.action,
      resource: result.resource,
      allowed: result.allowed,
      reason: result.reason,
      matchedRole: result.matchedRole,
      durationMs,
    });
  },
});
```

## Frontend permissions

```typescript
rbac.getEffectivePermissions(subject); // ["wallet:read", "wallet:create", …]
```

This expands roles and inheritance but **does not apply policies**, so treat it
as an upper bound: the backend can still deny an action that appears in the
list. Use it to drive what the UI shows, never as the authorization decision.

`getEffectiveRoles(subject)` and `hasRole(subject, role)` expand inheritance the
same way.

## Permission-only mode

Pass `permissions` instead of `roles` when the caller already holds a resolved
list (a browser holding the response of `GET /me/authorization`). Entries that
are not valid `resource:action` strings are skipped instead of throwing, and are
listed on `rbac.invalidPermissions`.

## Wildcards

- `wallet:*` — all actions on wallet
- `*:read` — read any resource
- `*:*` — full access

## Default deny

Missing permissions always result in denial.

## Performance

Role permissions are parsed once at construction and inheritance closures are
cached, so a decision is a map lookup and a short scan. `pnpm bench` measures it
against a 21-role inheritance chain.

## License

MIT
