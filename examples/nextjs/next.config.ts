import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@corpcash/rbac-react", "@corpcash/rbac-core"],
};

export default nextConfig;
