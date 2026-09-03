import type { RoleDefinition } from "@corpcash/rbac-core";
import type { RBACStore, StoredRBACConfig, StoredRole } from "./types.js";
import { tableNames } from "./ident.js";
import { assertAssignable, deleteRoleIO, upsertRoleIO } from "./operations.js";
import {
  assertRoleName,
  rolesRecord,
  validateStoredConfig,
} from "./validate.js";

interface PgQueryResult {
  rows: Record<string, unknown>[];
}

interface PgPool {
  query: (text: string, values?: unknown[]) => Promise<PgQueryResult>;
  end?: () => Promise<void>;
}

export interface PostgresStoreOptions {
  connectionString?: string;
  pool?: PgPool;
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
  return [];
}

function rowToRole(row: Record<string, unknown>): StoredRole {
  return {
    name: String(row.name),
    permissions: asStringArray(row.permissions),
    inherits: asStringArray(row.inherits),
  };
}

async function loadPg(options: PostgresStoreOptions): Promise<PgPool> {
  if (options.pool) return options.pool;
  if (!options.connectionString) {
    throw new Error(
      "postgresStore requires `connectionString` or an existing `pool`."
    );
  }

  try {
    const pg = (await import("pg")) as {
      default?: { Pool: new (config: { connectionString: string }) => PgPool };
      Pool?: new (config: { connectionString: string }) => PgPool;
    };
    const Pool = pg.default?.Pool ?? pg.Pool;
    if (!Pool) throw new Error("missing Pool");
    return new Pool({ connectionString: options.connectionString });
  } catch {
    throw new Error(
      "The `pg` package is required for postgresStore. Install it with `npm install pg`."
    );
  }
}

export function postgresStore(options: PostgresStoreOptions): RBACStore {
  const tables = tableNames(options.tablePrefix);
  let poolPromise: Promise<PgPool> | undefined;
  let createdPool = false;

  const pool = () => {
    if (!poolPromise) {
      createdPool = !options.pool;
      poolPromise = loadPg(options);
    }
    return poolPromise;
  };

  const query = async (text: string, values?: unknown[]) =>
    (await pool()).query(text, values);

  const io = {
    async listRoles(): Promise<StoredRole[]> {
      const result = await query(
        `SELECT name, permissions, inherits FROM ${tables.roles} ORDER BY name`
      );
      return result.rows.map(rowToRole);
    },
    async writeRole(name: string, def: RoleDefinition) {
      await query(
        `INSERT INTO ${tables.roles} (name, permissions, inherits, updated_at)
         VALUES ($1, $2::jsonb, $3::jsonb, NOW())
         ON CONFLICT (name) DO UPDATE SET
           permissions = EXCLUDED.permissions,
           inherits = EXCLUDED.inherits,
           updated_at = NOW()`,
        [
          name,
          JSON.stringify(def.permissions ?? []),
          JSON.stringify(def.inherits ?? []),
        ]
      );
    },
    async removeRole(name: string) {
      await query(`DELETE FROM ${tables.roles} WHERE name = $1`, [name]);
    },
    async subjectsWithRole(role: string) {
      const result = await query(
        `SELECT subject_id FROM ${tables.assignments} WHERE role_name = $1`,
        [role]
      );
      return result.rows.map((row) => String(row.subject_id));
    },
  };

  return {
    async migrate() {
      await query(`
        CREATE TABLE IF NOT EXISTS ${tables.roles} (
          name TEXT PRIMARY KEY,
          permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
          inherits JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS ${tables.assignments} (
          subject_id TEXT NOT NULL,
          role_name TEXT NOT NULL,
          PRIMARY KEY (subject_id, role_name),
          FOREIGN KEY (role_name) REFERENCES ${tables.roles}(name)
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS ${tables.settings} (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          strict_roles BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);
      await query(
        `INSERT INTO ${tables.settings} (id, strict_roles)
         VALUES (1, FALSE)
         ON CONFLICT (id) DO NOTHING`
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
      const result = await query(
        `SELECT role_name FROM ${tables.assignments}
         WHERE subject_id = $1 ORDER BY role_name`,
        [subjectId]
      );
      return result.rows.map((row) => String(row.role_name));
    },

    async setRolesForSubject(subjectId, roles) {
      await assertAssignable(io, roles);
      await query(`DELETE FROM ${tables.assignments} WHERE subject_id = $1`, [
        subjectId,
      ]);
      for (const role of roles) {
        await query(
          `INSERT INTO ${tables.assignments} (subject_id, role_name)
           VALUES ($1, $2)`,
          [subjectId, role]
        );
      }
    },

    async assignRole(subjectId, role) {
      const roleName = assertRoleName(role);
      await assertAssignable(io, [roleName]);
      await query(
        `INSERT INTO ${tables.assignments} (subject_id, role_name)
         VALUES ($1, $2)
         ON CONFLICT (subject_id, role_name) DO NOTHING`,
        [subjectId, roleName]
      );
    },

    async revokeRole(subjectId, role) {
      await query(
        `DELETE FROM ${tables.assignments}
         WHERE subject_id = $1 AND role_name = $2`,
        [subjectId, role]
      );
    },

    async getSettings() {
      const result = await query(
        `SELECT strict_roles FROM ${tables.settings} WHERE id = 1`
      );
      return { strictRoles: Boolean(result.rows[0]?.strict_roles) };
    },

    async updateSettings(patch) {
      if (patch.strictRoles === undefined) return;
      await query(
        `INSERT INTO ${tables.settings} (id, strict_roles)
         VALUES (1, $1)
         ON CONFLICT (id) DO UPDATE SET strict_roles = EXCLUDED.strict_roles`,
        [patch.strictRoles]
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
