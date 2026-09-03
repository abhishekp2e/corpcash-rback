# @corpcash/rbac-store

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
