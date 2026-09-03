import { describe } from "vitest";
import { describeStoreContract } from "./contract.js";

const postgresUrl = process.env.TEST_DATABASE_URL;
const mysqlUrl = process.env.TEST_MYSQL_URL;
const mongoUrl = process.env.TEST_MONGO_URL;

describe.skipIf(!postgresUrl)("postgresStore", () => {
  describeStoreContract("postgresStore", async () => {
    const { postgresStore } = await import("../postgres.js");
    const prefix = `rbac_${Date.now().toString(36)}_`;
    return postgresStore({
      connectionString: postgresUrl,
      tablePrefix: prefix,
    });
  });
});

describe.skipIf(!mysqlUrl)("mysqlStore", () => {
  describeStoreContract("mysqlStore", async () => {
    const { mysqlStore } = await import("../mysql.js");
    const prefix = `rbac_${Date.now().toString(36)}_`;
    return mysqlStore({
      url: mysqlUrl,
      tablePrefix: prefix,
    });
  });
});

describe.skipIf(!mongoUrl)("mongoStore", () => {
  describeStoreContract("mongoStore", async () => {
    const { mongoStore } = await import("../mongodb.js");
    return mongoStore({
      url: mongoUrl,
      dbName: `rbac_test_${Date.now().toString(36)}`,
    });
  });
});
