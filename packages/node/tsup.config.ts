import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    express: "src/middleware/express.ts",
    nestjs: "src/nestjs/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ["express", "@nestjs/common", "rxjs", "reflect-metadata"],
});
