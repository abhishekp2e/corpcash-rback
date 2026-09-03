import {
  CircularRoleInheritanceError,
  InvalidPermissionError,
  InvalidRBACConfigError,
  type RBAC,
} from "@corpcash/rbac-core";
import {
  StoreNotFoundError,
  reloadFromStore,
  type RBACStore,
  type StoredRole,
} from "@corpcash/rbac-store";

export const ADMIN_RESOURCE = "rbac";
export const ADMIN_ACTION = "manage";

export interface RoleWriteBody {
  name?: string;
  permissions?: string[];
  inherits?: string[];
}

export function roleDefinitionFrom(body: RoleWriteBody) {
  return {
    permissions: body.permissions ?? [],
    inherits: body.inherits ?? [],
  };
}

export async function findRole(
  store: RBACStore,
  name: string
): Promise<StoredRole> {
  const role = (await store.listRoles()).find((entry) => entry.name === name);
  if (!role) throw new StoreNotFoundError(`Role "${name}" was not found.`);
  return role;
}

export async function createRole(
  store: RBACStore,
  rbac: RBAC,
  body: RoleWriteBody
): Promise<StoredRole> {
  const name = body.name?.trim();
  if (!name) {
    throw new InvalidRBACConfigError("Role name must be a non-empty string.");
  }
  const existing = (await store.listRoles()).some((role) => role.name === name);
  if (existing) {
    throw new InvalidRBACConfigError(`Role "${name}" already exists.`);
  }
  await store.upsertRole(name, roleDefinitionFrom(body));
  await reloadFromStore(rbac, store);
  return findRole(store, name);
}

export async function replaceRole(
  store: RBACStore,
  rbac: RBAC,
  name: string,
  body: RoleWriteBody
): Promise<StoredRole> {
  await store.upsertRole(name, roleDefinitionFrom(body));
  await reloadFromStore(rbac, store);
  return findRole(store, name);
}

export async function removeRole(
  store: RBACStore,
  rbac: RBAC,
  name: string
): Promise<void> {
  await store.deleteRole(name);
  await reloadFromStore(rbac, store);
}

export async function replaceSettings(
  store: RBACStore,
  rbac: RBAC,
  patch: { strictRoles?: boolean }
) {
  await store.updateSettings(patch);
  await reloadFromStore(rbac, store);
  return store.getSettings();
}

export function isClientError(error: unknown): boolean {
  return (
    error instanceof StoreNotFoundError ||
    error instanceof InvalidRBACConfigError ||
    error instanceof InvalidPermissionError ||
    error instanceof CircularRoleInheritanceError
  );
}

export function statusFor(error: unknown): number {
  if (error instanceof StoreNotFoundError) return 404;
  if (isClientError(error)) return 400;
  return 500;
}
