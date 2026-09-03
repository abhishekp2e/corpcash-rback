import { RBAC, type DecisionListener } from "@corpcash/rbac-core";
import type { RBACStore } from "./types.js";
import type { Subject } from "@corpcash/rbac-core";

export interface CreateRBACFromStoreOptions {
  onDecision?: DecisionListener;
}

export async function createRBACFromStore(
  store: RBACStore,
  options: CreateRBACFromStoreOptions = {}
): Promise<RBAC> {
  const config = await store.loadConfig();
  return new RBAC({
    roles: config.roles,
    strictRoles: config.strictRoles,
    onDecision: options.onDecision,
  });
}

export async function reloadFromStore(
  rbac: RBAC,
  store: RBACStore
): Promise<void> {
  rbac.reload(await store.loadConfig());
}

export function createStoreSubjectResolver<T>(
  store: RBACStore,
  getId: (input: T) => string | undefined | Promise<string | undefined>
): (input: T) => Promise<Subject | null> {
  return async (input) => {
    const id = await getId(input);
    if (!id) return null;
    return { id, roles: await store.getRolesForSubject(id) };
  };
}
