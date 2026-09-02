"use client";

import { RBACProvider, Can, useCan } from "@corpcash/rbac-react";

const subject = { id: "dev-1", roles: ["developer"] };
const permissions = [
  "wallet:read",
  "wallet:create",
  "transaction:read",
  "contract:deploy",
];

function WalletActions() {
  const canCreate = useCan("wallet", "create");
  const canDelete = useCan("wallet", "delete");

  return (
    <div>
      <p>Can create: {canCreate ? "yes" : "no"}</p>
      <p>Can delete: {canDelete ? "yes" : "no"}</p>
      <Can resource="wallet" action="create">
        <button>Create Wallet</button>
      </Can>
    </div>
  );
}

export default function WalletsPage() {
  return (
    <RBACProvider subject={subject} permissions={permissions}>
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Next.js Wallets (App Router)</h1>
        <p>
          RBACProvider wraps protected UI. Backend must enforce authorization
          on API routes.
        </p>
        <WalletActions />
      </main>
    </RBACProvider>
  );
}
