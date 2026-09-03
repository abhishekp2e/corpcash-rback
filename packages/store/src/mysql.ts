import type { RoleDefinition } from "@corpcash/rbac-core";
import type { RBACStore, StoredRBACConfig, StoredRole } from "./types.js";
import { tableNames } from "./ident.js";
import { assertAssignable, deleteRoleIO, upsertRoleIO } from "./operations.js";
import {
  assertRoleName,
  rolesRecord,
  validateStoredConfig,
} from "./validate.js";

interface MysqlPool {
  query: (
    sql: string,
    values?: unknown[]
  ) => Promise<[Record<string, unknown>[], unknown]>;
  end?: () => Promise<void>;
}

export interface MysqlStoreOptions {
  url?: string;
  pool?: MysqlPool;
  tablePrefix?: string;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  if (Buffer.isBuffer(value)) {
    return asStringArray(value.toString("utf8"));
  }
  return [];
}

function rowToRole(row: Record<string, unknown>): StoredRole {
  return {
    name: String(row.name),
    permissions: asStringArray(row.permissions),
    inherits: asStringArray(row.inherits),
  };
}

async function loadMysql(options: MysqlStoreOptions): Promise<MysqlPool> {
  if (options.pool) return options.pool;
  if (!options.url) {
    throw new Error("mysqlStore requires `url` or an existing `pool`.");
  }

  try {
    const mysql = await import("mysql2/promise");
    return mysql.createPool(options.url);
  } catch {
    throw new Error(
      "The `mysql2` package is required for mysqlStore. Install it with `npm install mysql2`."
    );
  }
}

export function mysqlStore(options: MysqlStoreOptions): RBACStore {
  const tables = tableNames(options.tablePrefix);
  let poolPromise: Promise<MysqlPool> | undefined;
  let createdPool = false;

  const pool = () => {
    if (!poolPromise) {
      createdPool = !options.pool;
      poolPromise = loadMysql(options);
    }
    return poolPromise;
  };

  const query = async (sql: string, values?: unknown[]) => {
    const [rows] = await (await pool()).query(sql, values);
    return rows;
  };

  const io = {
    async listRoles(): Promise<StoredRole[]> {
      const rows = await query(
        `SELECT name, permissions, inherits FROM \`${tables.roles}\` ORDER BY name`
      );
      return rows.map(rowToRole);
    },
    async writeRole(name: string, def: RoleDefinition) {
      await query(
        `INSERT INTO \`${tables.roles}\` (name, permissions, inherits, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE
           permissions = VALUES(permissions),
           inherits = VALUES(inherits),
           updated_at = CURRENT_TIMESTAMP`,
        [
          name,
          JSON.stringify(def.permissions ?? []),
          JSON.stringify(def.inherits ?? []),
        ]
      );
    },
    async removeRole(name: string) {
      await query(`DELETE FROM \`${tables.roles}\` WHERE name = ?`, [name]);
    },
    async subjectsWithRole(role: string) {
      const rows = await query(
        `SELECT subject_id FROM \`${tables.assignments}\` WHERE role_name = ?`,
        [role]
      );
      return rows.map((row) => String(row.subject_id));
    },
  };

  return {
    async migrate() {
      await query(`
        CREATE TABLE IF NOT EXISTS \`${tables.roles}\` (
          name VARCHAR(191) PRIMARY KEY,
          permissions JSON NOT NULL,
          inherits JSON NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS \`${tables.assignments}\` (
          subject_id VARCHAR(191) NOT NULL,
          role_name VARCHAR(191) NOT NULL,
          PRIMARY KEY (subject_id, role_name),
          FOREIGN KEY (role_name) REFERENCES \`${tables.roles}\`(name)
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS \`${tables.settings}\` (
          id TINYINT PRIMARY KEY,
          strict_roles TINYINT(1) NOT NULL DEFAULT 0
        )
      `);
      await query(
        `INSERT IGNORE INTO \`${tables.settings}\` (id, strict_roles) VALUES (1, 0)`
      );
    },

    async loadConfig() {
      const roles = await io.listRoles();
      const settings = await this.getSettings();
      return { roles: rolesRecord(roles), strictRoles: settings.strictRoles };
    },

    async seed(config: StoredRBACConfig) {
      const existing = await io.listRoles();
      if (existing.length > 0) return;
      validateStoredConfig(config);
      for (const [name, def] of Object.entries(config.roles ?? {})) {
        await io.writeRole(assertRoleName(name), def);
      }
      if (config.strictRoles !== undefined) {
        await this.updateSettings({ strictRoles: config.strictRoles });
      }
    },

    listRoles: () => io.listRoles(),
    upsertRole: (name, def) => upsertRoleIO(io, name, def),
    deleteRole: (name) => deleteRoleIO(io, name),

    async getRolesForSubject(subjectId) {
      const rows = await query(
        `SELECT role_name FROM \`${tables.assignments}\`
         WHERE subject_id = ? ORDER BY role_name`,
        [subjectId]
      );
      return rows.map((row) => String(row.role_name));
    },

    async setRolesForSubject(subjectId, roles) {
      await assertAssignable(io, roles);
      await query(
        `DELETE FROM \`${tables.assignments}\` WHERE subject_id = ?`,
        [subjectId]
      );
      for (const role of roles) {
        await query(
          `INSERT INTO \`${tables.assignments}\` (subject_id, role_name)
           VALUES (?, ?)`,
          [subjectId, role]
        );
      }
    },

    async assignRole(subjectId, role) {
      const roleName = assertRoleName(role);
      await assertAssignable(io, [roleName]);
      await query(
        `INSERT IGNORE INTO \`${tables.assignments}\` (subject_id, role_name)
         VALUES (?, ?)`,
        [subjectId, roleName]
      );
    },

    async revokeRole(subjectId, role) {
      await query(
        `DELETE FROM \`${tables.assignments}\`
         WHERE subject_id = ? AND role_name = ?`,
        [subjectId, role]
      );
    },

    async getSettings() {
      const rows = await query(
        `SELECT strict_roles FROM \`${tables.settings}\` WHERE id = 1`
      );
      return { strictRoles: Boolean(rows[0]?.strict_roles) };
    },

    async updateSettings(patch) {
      if (patch.strictRoles === undefined) return;
      await query(
        `INSERT INTO \`${tables.settings}\` (id, strict_roles)
         VALUES (1, ?)
         ON DUPLICATE KEY UPDATE strict_roles = VALUES(strict_roles)`,
        [patch.strictRoles ? 1 : 0]
      );
    },

    async close() {
      if (createdPool) {
        const instance = await pool();
        await instance.end?.();
      }
    },
  };
}
