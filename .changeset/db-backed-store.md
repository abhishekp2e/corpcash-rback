---
"@corpcash/rbac-core": minor
"@corpcash/rbac-node": minor
"@corpcash/rbac-react": minor
"@corpcash/rbac-store": minor
---

Database-backed RBAC config.

- Added `@corpcash/rbac-store` with `memoryStore`, `createRBACFromStore`, and
  PostgreSQL / MySQL / MongoDB adapters for roles, inheritance, settings, and
  subject-role assignments.
- `RBAC.reload()` replaces the compiled role graph without dropping policies
  or `onDecision`. An invalid reload leaves the previous compiled state.
- Express `createRbacAdminRouter` and Nest `RbacModule.forRootAsync` +
  `RbacAdminModule` expose a small `rbac:manage` API for live role and
  assignment changes.
