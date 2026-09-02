export { RBAC } from "./rbac.js";

export type {
  Action,
  AuthorizationDecision,
  AuthorizationReason,
  AuthorizationRequest,
  AuthorizationResult,
  DecisionListener,
  PolicyContext,
  PolicyFn,
  RBACConfig,
  Resource,
  ResourceInstance,
  RoleDefinition,
  Subject,
} from "./types/index.js";

export {
  AsyncPolicyError,
  CircularRoleInheritanceError,
  InvalidPermissionError,
  InvalidRBACConfigError,
  UnknownRoleError,
} from "./errors.js";

export {
  formatPermission,
  parsePermission,
  tryParsePermission,
} from "./permissions/parse.js";

export { getResourceType } from "./types/index.js";
