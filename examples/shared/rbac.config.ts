import type { RBACConfig } from "@corpcash/rbac-core";

export const rbacConfig: RBACConfig = {
  roles: {
    viewer: {
      permissions: ["wallet:read", "transaction:read"],
    },
    developer: {
      inherits: ["viewer"],
      permissions: [
        "wallet:create",
        "wallet:update",
        // Granted broadly here; the ownership policy narrows it to own wallets.
        "wallet:delete",
        "contract:read",
        "contract:deploy",
      ],
    },
    admin: {
      permissions: ["*:*"],
    },
  },
};

export const demoUsers = {
  viewer: { id: "viewer-1", roles: ["viewer"] as string[] },
  developer: { id: "dev-1", roles: ["developer"] as string[] },
  admin: { id: "admin-1", roles: ["admin"] as string[] },
};
