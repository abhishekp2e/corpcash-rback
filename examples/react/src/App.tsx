import { useState } from "react";
import {
  RBACProvider,
  useCan,
  useRole,
  Can,
  RequirePermission,
} from "@corpcash/rbac-react";

const userPermissions: Record<string, string[]> = {
  viewer: ["wallet:read", "transaction:read"],
  developer: [
    "wallet:read",
    "wallet:create",
    "wallet:update",
    "transaction:read",
    "contract:deploy",
  ],
  admin: ["*:*"],
};

const users = {
  viewer: { id: "viewer-1", roles: ["viewer"] },
  developer: { id: "dev-1", roles: ["developer"] },
  admin: { id: "admin-1", roles: ["admin"] },
};

function NavMenu() {
  const canReadWallet = useCan("wallet", "read");
  const canReadTransaction = useCan("transaction", "read");
  const canManageAdmin = useCan("admin", "manage");

  const menu = [
    canReadWallet && { label: "Wallets" },
    canReadTransaction && { label: "Transactions" },
    canManageAdmin && { label: "Admin" },
  ].filter(Boolean) as { label: string }[];

  return (
    <ul>
      {menu.map((item) => (
        <li key={item.label}>{item.label}</li>
      ))}
    </ul>
  );
}

function Dashboard() {
  const canCreateWallet = useCan("wallet", "create");
  const canDeployContract = useCan("contract", "deploy");
  const isAdmin = useRole("admin");

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Wallet Dashboard</h1>
      <p>Admin role: {isAdmin ? "yes" : "no"}</p>
      <h2>Navigation</h2>
      <NavMenu />
      <h2>Actions</h2>
      <Can resource="wallet" action="create">
        <button>Create Wallet</button>
      </Can>{" "}
      <Can
        resource="wallet"
        action="delete"
        fallback={<span>No delete access</span>}
      >
        <button>Delete Wallet</button>
      </Can>{" "}
      {canCreateWallet && <span>(can create via hook)</span>}
      {canDeployContract && <button>Deploy Contract</button>}
      <RequirePermission
        resource="wallet"
        action="read"
        fallback={<p>Access denied to wallet section.</p>}
      >
        <section>
          <h2>Wallet List</h2>
          <p>You can view wallets.</p>
        </section>
      </RequirePermission>
    </div>
  );
}

export function App() {
  const [role, setRole] = useState<keyof typeof users>("developer");
  const subject = users[role];
  const permissions = userPermissions[role];

  return (
    <div>
      <div style={{ padding: 16, background: "#f5f5f5" }}>
        <label>
          Simulate user role:{" "}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as keyof typeof users)}
          >
            <option value="viewer">viewer</option>
            <option value="developer">developer</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <p style={{ fontSize: 12, color: "#666" }}>
          Frontend RBAC controls UX only. Backend must enforce authorization.
        </p>
      </div>
      <RBACProvider subject={subject} permissions={permissions}>
        <Dashboard />
      </RBACProvider>
    </div>
  );
}
