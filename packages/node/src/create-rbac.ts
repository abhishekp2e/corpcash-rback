import { RBAC, type RBACConfig } from "@corpcash/rbac-core";

export function createRBAC(config: RBACConfig): RBAC {
  return new RBAC(config);
}

export { RBAC };
export type {
  AuthorizationDecision,
  AuthorizationResult,
  RBACConfig,
  Subject,
} from "@corpcash/rbac-core";
