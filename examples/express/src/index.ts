import express, { type Request } from "express";
import { createRBAC } from "@corpcash/rbac-node";
import { createExpressMiddleware } from "@corpcash/rbac-node/express";
import { rbacConfig, demoUsers } from "../../shared/rbac.config.js";

const app = express();
app.use(express.json());

const rbac = createRBAC(rbacConfig);

rbac.registerPolicyFor("wallet", "delete", ({ subject, resource }) => {
  if (typeof resource === "object" && "ownerId" in resource) {
    return subject.id === resource.ownerId;
  }
  return true;
});

const { authorize } = createExpressMiddleware({
  rbac,
  getSubject: (req: Request) => req.headers["x-user-id"] as string | undefined
    ? demoUsers[
        req.headers["x-user-id"] as keyof typeof demoUsers
      ] ?? null
    : null,
});

app.get("/wallets", authorize("wallet", "read"), (_req, res) => {
  res.json([{ id: "wallet_1", ownerId: "dev-1" }]);
});

app.post("/wallets", authorize("wallet", "create"), (_req, res) => {
  res.status(201).json({ id: "wallet_new" });
});

app.delete(
  "/wallets/:id",
  authorize({
    resource: "wallet",
    action: "delete",
    getResource: (req: Request) => ({
      type: "wallet",
      id: String(req.params.id),
      ownerId: (req.headers["x-wallet-owner"] as string) ?? "dev-1",
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
    permissions: rbac.getEffectivePermissions(subject),
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Express example running on http://localhost:${PORT}`);
  console.log("Try: curl -H 'x-user-id: developer' http://localhost:3001/wallets");
});
