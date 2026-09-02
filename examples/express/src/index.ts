import express, { type Request } from "express";
import { createRBAC } from "@corpcash/rbac-node";
import { createExpressMiddleware } from "@corpcash/rbac-node/express";
import { rbacConfig, demoUsers } from "../../shared/rbac.config.js";
import { findWalletById, listWallets } from "../../shared/wallets.store.js";

const app = express();
app.use(express.json());

// The audit hook sees every decision, allowed or denied. Point it at your
// logger; anything it throws is swallowed so it cannot change a decision.
const rbac = createRBAC({
  ...rbacConfig,
  onDecision: ({ request, result, durationMs }) => {
    console.log(
      JSON.stringify({
        event: "authorization",
        subject: request.subject.id,
        action: result.action,
        resource: result.resource,
        allowed: result.allowed,
        reason: result.reason,
        matchedRole: result.matchedRole,
        ignoredRoles: result.ignoredRoles,
        durationMs,
      })
    );
  },
});

// An ownership policy that has to load the wallet first. Policies may return a
// promise; the middleware awaits them.
rbac.registerPolicyFor("wallet", "delete", async ({ subject, resource }) => {
  if (typeof resource !== "object") return false;

  const wallet = await findWalletById(String(resource.id));
  if (!wallet) return false;

  return wallet.ownerId === subject.id;
});

const { authorize } = createExpressMiddleware({
  rbac,
  getSubject: (req: Request) => {
    const userId = req.headers["x-user-id"] as
      keyof typeof demoUsers | undefined;
    return userId ? (demoUsers[userId] ?? null) : null;
  },
});

app.get("/wallets", authorize("wallet", "read"), (_req, res) => {
  res.json(listWallets());
});

app.post("/wallets", authorize("wallet", "create"), (_req, res) => {
  res.status(201).json({ id: "wallet_new" });
});

app.delete(
  "/wallets/:id",
  authorize({
    resource: "wallet",
    action: "delete",
    // Supplies the instance the policy reasons about. The route's "wallet"
    // still decides which permission is checked.
    getResource: (req: Request) => ({
      type: "wallet",
      id: String(req.params.id),
    }),
  }),
  (req, res) => {
    res.json({ deleted: req.params.id });
  }
);

app.get("/me/authorization", (req, res) => {
  const userId = req.headers["x-user-id"] as keyof typeof demoUsers | undefined;
  const subject = userId ? demoUsers[userId] : null;
  if (!subject) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    user: subject,
    roles: subject.roles,
    // Expands roles and inheritance but not policies, so treat it as an upper
    // bound on what the API will actually allow.
    permissions: rbac.getEffectivePermissions(subject),
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Express example running on http://localhost:${PORT}`);
  console.log("\nTry:");
  console.log("  curl -H 'x-user-id: developer' http://localhost:3001/wallets");
  console.log(
    "  curl -X DELETE -H 'x-user-id: admin' http://localhost:3001/wallets/wallet_1" +
      "   # 403: admin has *:* but does not own it"
  );
  console.log(
    "  curl -X DELETE -H 'x-user-id: developer' http://localhost:3001/wallets/wallet_1" +
      "   # 200: owner"
  );
});
