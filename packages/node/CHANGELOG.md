# @corpcash/rbac-node

## 0.3.0

### Minor Changes

- a515d50: Database-backed RBAC config.
  
  - Added `@corpcash/rbac-store` with `memoryStore`, `createRBACFromStore`, and
    PostgreSQL / MySQL / MongoDB adapters for roles, inheritance, settings, and
    subject-role assignments.
  - `RBAC.reload()` replaces the compiled role graph without dropping policies
    or `onDecision`. An invalid reload leaves the previous compiled state.
  - Express `createRbacAdminRouter` and Nest `RbacModule.forRootAsync` +
    `RbacAdminModule` expose a small `rbac:manage` API for live role and
    assignment changes.

### Patch Changes

- Updated dependencies [a515d50]
  - @corpcash/rbac-core@0.3.0
  - @corpcash/rbac-store@0.3.0

## 0.2.0

### Minor Changes

- f67b3ef: Production hardening.
  
  - Unknown subject roles are ignored and reported through `ignoredRoles` instead
    of throwing, so a stale token cannot turn an authorization check into a 500.
    Opt back into the old behaviour with `strictRoles: true`.
  - Role configuration is validated when the engine is constructed: cycles,
    dangling `inherits` targets, malformed permission strings, and supplying both
    `roles` and `permissions` now fail at startup.
  - Added `authorizeAsync` / `canAsync` so policies can await ownership lookups.
    The Express middleware and the Nest guard use the async path.
  - Added an `onDecision` audit hook that receives every decision.
  - Role permissions are parsed once and inheritance closures are cached, so a
    decision no longer re-parses strings or re-walks the graph per request.
  - Express: 401 for a subject with no id, the route's declared resource always
    decides which permission is checked, async `getSubject` is supported, and
    errors reach the express error handler.
  - NestJS: handlers the guard covers that carry no `@RequirePermission` are now
    denied by default, with `@PublicRoute()` as the explicit opt-out and
    `denyUnannotatedRoutes: false` for the looser Nest convention. Also
    `UnauthorizedException` for missing subjects, and a `configure` hook for
    registering policies at startup. Binding the guard globally with
    `{ provide: APP_GUARD, useClass: RbacGuard }` skips that configuration, so the
    guard now refuses to construct and names `useExisting` as the fix instead of
    failing later with an unrelated error.
  - React: `useRole` accounts for inherited roles, malformed permissions from an
    API are skipped rather than thrown during render, and the engine is memoised
    on permission content instead of array identity.

### Patch Changes

- Updated dependencies [f67b3ef]
  - @corpcash/rbac-core@0.2.0
