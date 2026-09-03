import type { RoleDefinition } from "@corpcash/rbac-core";
import type { RBACStore, StoredRBACConfig, StoredRole } from "./types.js";
import { assertSafeIdent } from "./ident.js";
import { assertAssignable, deleteRoleIO, upsertRoleIO } from "./operations.js";
import {
  assertRoleName,
  cloneRole,
  rolesRecord,
  validateStoredConfig,
} from "./validate.js";

interface MongoFilter {
  [key: string]: unknown;
}

interface MongoCollection {
  createIndex(
    keys: Record<string, number>,
    options?: { unique?: boolean }
  ): Promise<unknown>;
  find(filter?: MongoFilter): { toArray(): Promise<Record<string, unknown>[]> };
  findOne(filter: MongoFilter): Promise<Record<string, unknown> | null>;
  updateOne(
    filter: MongoFilter,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<unknown>;
  deleteOne(filter: MongoFilter): Promise<unknown>;
  deleteMany(filter: MongoFilter): Promise<unknown>;
}

interface MongoDb {
  collection(name: string): MongoCollection;
}

interface MongoClientLike {
  db(name?: string): MongoDb;
  connect(): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface MongoStoreOptions {
  url?: string;
  db?: MongoDb;
  client?: MongoClientLike;
  dbName?: string;
  collectionPrefix?: string;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function docToRole(doc: Record<string, unknown>): StoredRole {
  return {
    name: String(doc.name),
    permissions: asStringArray(doc.permissions),
    inherits: asStringArray(doc.inherits),
  };
}

async function loadDb(
  options: MongoStoreOptions
): Promise<{ db: MongoDb; close?: () => Promise<void> }> {
  if (options.db) return { db: options.db };
  if (options.client) {
    return { db: options.client.db(options.dbName) };
  }
  if (!options.url) {
    throw new Error(
      "mongoStore requires `url`, an existing `db`, or a `client`."
    );
  }

  try {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(options.url);
    await client.connect();
    return {
      db: client.db(options.dbName),
      close: () => client.close(),
    };
  } catch {
    throw new Error(
      "The `mongodb` package is required for mongoStore. Install it with `npm install mongodb`."
    );
  }
}

export function mongoStore(options: MongoStoreOptions): RBACStore {
  const prefix = assertSafeIdent(
    options.collectionPrefix ?? "rbac_",
    "collection prefix"
  );
  const names = {
    roles: `${prefix}roles`,
    assignments: `${prefix}assignments`,
    settings: `${prefix}settings`,
  };

  let ready: Promise<{ db: MongoDb; close?: () => Promise<void> }> | undefined;

  const conn = () => {
    if (!ready) ready = loadDb(options);
    return ready;
  };

  const col = async (name: string) => (await conn()).db.collection(name);

  const io = {
    async listRoles(): Promise<StoredRole[]> {
      const docs = await (await col(names.roles)).find({}).toArray();
      return docs.map(docToRole).sort((a, b) => a.name.localeCompare(b.name));
    },
    async writeRole(name: string, def: RoleDefinition) {
      await (
        await col(names.roles)
      ).updateOne(
        { name },
        {
          $set: {
            name,
            permissions: def.permissions ?? [],
            inherits: def.inherits ?? [],
            updated_at: new Date(),
          },
        },
        { upsert: true }
      );
    },
    async removeRole(name: string) {
      await (await col(names.roles)).deleteOne({ name });
    },
    async subjectsWithRole(role: string) {
      const docs = await (
        await col(names.assignments)
      )
        .find({ role_name: role })
        .toArray();
      return docs.map((doc) => String(doc.subject_id));
    },
  };

  return {
    async migrate() {
      const roles = await col(names.roles);
      const assignments = await col(names.assignments);
      const settings = await col(names.settings);
      await roles.createIndex({ name: 1 }, { unique: true });
      await assignments.createIndex(
        { subject_id: 1, role_name: 1 },
        { unique: true }
      );
      await settings.createIndex({ id: 1 }, { unique: true });
      await settings.updateOne(
        { id: 1 },
        { $setOnInsert: { id: 1, strict_roles: false } },
        { upsert: true }
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
        await io.writeRole(assertRoleName(name), cloneRole(def));
      }
      if (config.strictRoles !== undefined) {
        await this.updateSettings({ strictRoles: config.strictRoles });
      }
    },

    listRoles: () => io.listRoles(),
    upsertRole: (name, def) => upsertRoleIO(io, name, def),
    deleteRole: (name) => deleteRoleIO(io, name),

    async getRolesForSubject(subjectId) {
      const docs = await (
        await col(names.assignments)
      )
        .find({ subject_id: subjectId })
        .toArray();
      return docs.map((doc) => String(doc.role_name)).sort();
    },

    async setRolesForSubject(subjectId, roles) {
      await assertAssignable(io, roles);
      await (
        await col(names.assignments)
      ).deleteMany({ subject_id: subjectId });
      for (const role of roles) {
        await (
          await col(names.assignments)
        ).updateOne(
          { subject_id: subjectId, role_name: role },
          { $set: { subject_id: subjectId, role_name: role } },
          { upsert: true }
        );
      }
    },

    async assignRole(subjectId, role) {
      const roleName = assertRoleName(role);
      await assertAssignable(io, [roleName]);
      await (
        await col(names.assignments)
      ).updateOne(
        { subject_id: subjectId, role_name: roleName },
        { $set: { subject_id: subjectId, role_name: roleName } },
        { upsert: true }
      );
    },

    async revokeRole(subjectId, role) {
      await (
        await col(names.assignments)
      ).deleteOne({ subject_id: subjectId, role_name: role });
    },

    async getSettings() {
      const doc = await (await col(names.settings)).findOne({ id: 1 });
      return { strictRoles: Boolean(doc?.strict_roles) };
    },

    async updateSettings(patch) {
      if (patch.strictRoles === undefined) return;
      await (
        await col(names.settings)
      ).updateOne(
        { id: 1 },
        { $set: { id: 1, strict_roles: patch.strictRoles } },
        { upsert: true }
      );
    },

    async close() {
      const instance = await conn();
      await instance.close?.();
    },
  };
}
