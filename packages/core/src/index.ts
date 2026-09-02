export { RBAC } from "./rbac.js";

export type {
  Action,
  AuthorizationReason,
  AuthorizationRequest,
  AuthorizationResult,
  PolicyContext,
  PolicyFn,
  RBACConfig,
  Resource,
  ResourceInstance,
  RoleDefinition,
  Subject,
} from "./types/index.js";

export {
  CircularRoleInheritanceError,
  UnknownRoleError,
} from "./roles/inheritance.js";

export { parsePermission, formatPermission } from "./permissions/parse.js";

export { getResourceType } from "./types/index.js";
