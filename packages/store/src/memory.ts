import type { RoleDefinition } from "@corpcash/rbac-core";
import type { RBACStore, StoredRBACConfig, StoredRole } from "./types.js";
import { assertAssignable, deleteRoleIO, upsertRoleIO } from "./operations.js";
import {
  assertRoleName,
  cloneRole,
  rolesRecord,
  validateStoredConfig,
} from "./validate.js";

export function memoryStore(
  initial?: StoredRBACConfig
): RBACStore & { close(): Promise<void> } {
  const roles = new Map<string, RoleDefinition>();
  const assignments = new Map<string, Set<string>>();
  let strictRoles = initial?.strictRoles ?? false;

  if (initial?.roles) {
    validateStoredConfig(initial);
    for (const [name, def] of Object.entries(initial.roles)) {
      roles.set(name, cloneRole(def));
    }
  }

  function listed(): StoredRole[] {
    return [...roles.entries()].map(([name, def]) => ({
      name,
      ...cloneRole(def),
    }));
  }

  const io = {
    async listRoles() {
      return listed();
    },
    async writeRole(name: string, def: RoleDefinition) {
      roles.set(name, cloneRole(def));
    },
    async removeRole(name: string) {
      roles.delete(name);
    },
    async subjectsWithRole(role: string) {
      return [...assignments.entries()]
        .filter(([, set]) => set.has(role))
        .map(([subjectId]) => subjectId);
    },
  };

  return {
    async migrate() {
      // In-memory store has no schema.
    },

    async loadConfig() {
      return {
        roles: rolesRecord(listed()),
        strictRoles,
      };
    },

    async seed(config) {
      if (roles.size > 0) return;
      validateStoredConfig(config);
      for (const [name, def] of Object.entries(config.roles ?? {})) {
        roles.set(assertRoleName(name), cloneRole(def));
      }
      if (config.strictRoles !== undefined) {
        strictRoles = config.strictRoles;
      }
    },

    listRoles: () => io.listRoles(),
    upsertRole: (name, def) => upsertRoleIO(io, name, def),
    deleteRole: (name) => deleteRoleIO(io, name),

    async getRolesForSubject(subjectId) {
      return [...(assignments.get(subjectId) ?? [])].sort();
    },

    async setRolesForSubject(subjectId, roleNames) {
      await assertAssignable(io, roleNames);
      assignments.set(subjectId, new Set(roleNames));
    },

    async assignRole(subjectId, role) {
      const roleName = assertRoleName(role);
      await assertAssignable(io, [roleName]);
      const current = assignments.get(subjectId) ?? new Set<string>();
      current.add(roleName);
      assignments.set(subjectId, current);
    },

    async revokeRole(subjectId, role) {
      assignments.get(subjectId)?.delete(role);
    },

    async getSettings() {
      return { strictRoles };
    },

    async updateSettings(patch) {
      if (patch.strictRoles !== undefined) {
        strictRoles = patch.strictRoles;
      }
    },

    async close() {
      roles.clear();
      assignments.clear();
    },
  };
}
