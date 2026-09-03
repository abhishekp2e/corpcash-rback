import type { RBACConfig, RoleDefinition } from "@corpcash/rbac-core";

export type StoredRBACConfig = Pick<RBACConfig, "roles" | "strictRoles">;

export type StoredRole = { name: string } & RoleDefinition;

export interface RBACSettings {
  strictRoles: boolean;
}

export interface RBACStore {
  migrate(): Promise<void>;
  loadConfig(): Promise<StoredRBACConfig>;
  seed(config: StoredRBACConfig): Promise<void>;

  listRoles(): Promise<StoredRole[]>;
  upsertRole(name: string, def: RoleDefinition): Promise<void>;
  deleteRole(name: string): Promise<void>;

  getRolesForSubject(subjectId: string): Promise<string[]>;
  setRolesForSubject(subjectId: string, roles: string[]): Promise<void>;
  assignRole(subjectId: string, role: string): Promise<void>;
  revokeRole(subjectId: string, role: string): Promise<void>;

  getSettings(): Promise<RBACSettings>;
  updateSettings(patch: Partial<RBACSettings>): Promise<void>;

  close?(): Promise<void>;
}

export class StoreNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreNotFoundError";
  }
}
