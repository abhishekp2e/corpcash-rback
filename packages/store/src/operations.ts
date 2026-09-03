import {
  InvalidRBACConfigError,
  type RoleDefinition,
} from "@corpcash/rbac-core";
import type { StoredRole } from "./types.js";
import { StoreNotFoundError } from "./types.js";
import {
  assertRoleName,
  assertRolesExist,
  nextRolesAfterDelete,
  nextRolesAfterUpsert,
  rolesRecord,
} from "./validate.js";

export interface RoleIO {
  listRoles(): Promise<StoredRole[]>;
  writeRole(name: string, def: RoleDefinition): Promise<void>;
  removeRole(name: string): Promise<void>;
  subjectsWithRole(role: string): Promise<string[]>;
}

export async function upsertRoleIO(
  io: RoleIO,
  name: string,
  def: RoleDefinition
): Promise<void> {
  const current = rolesRecord(await io.listRoles());
  const next = nextRolesAfterUpsert(current, name, def);
  const roleName = assertRoleName(name);
  await io.writeRole(roleName, next[roleName]);
}

export async function deleteRoleIO(io: RoleIO, name: string): Promise<void> {
  const roleName = assertRoleName(name);
  const current = rolesRecord(await io.listRoles());
  if (!current[roleName]) {
    throw new StoreNotFoundError(`Role "${roleName}" was not found.`);
  }

  const assigned = await io.subjectsWithRole(roleName);
  if (assigned.length > 0) {
    throw new InvalidRBACConfigError(
      `Cannot delete role "${roleName}" because it is assigned to ${assigned.length} subject(s).`
    );
  }

  nextRolesAfterDelete(current, roleName);
  await io.removeRole(roleName);
}

export async function assertAssignable(
  io: Pick<RoleIO, "listRoles">,
  roles: readonly string[]
): Promise<void> {
  assertRolesExist(rolesRecord(await io.listRoles()), roles);
}
