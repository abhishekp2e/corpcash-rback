import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    postgres: "src/postgres.ts",
    mysql: "src/mysql.ts",
    mongodb: "src/mongodb.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["pg", "mysql2", "mysql2/promise", "mongodb"],
});
