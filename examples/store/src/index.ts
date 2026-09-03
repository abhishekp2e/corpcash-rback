import express, { type Request } from "express";
import { createRBACFromStore, memoryStore } from "@corpcash/rbac-store";
import { createStoreSubjectResolver } from "@corpcash/rbac-store";
import { createExpressMiddleware } from "@corpcash/rbac-node/express";
import { createRbacAdminRouter } from "@corpcash/rbac-node/express";
import { rbacConfig, demoUsers } from "../../shared/rbac.config.js";
import { findWalletById, listWallets } from "../../shared/wallets.store.js";

async function createStore() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { postgresStore } = await import("@corpcash/rbac-store/postgres");
    return postgresStore({ connectionString: url });
  }
  return memoryStore();
}

const store = await createStore();
await store.migrate();
await store.seed(rbacConfig);

for (const user of Object.values(demoUsers)) {
  const existing = await store.getRolesForSubject(user.id);
  if (existing.length === 0) {
    await store.setRolesForSubject(user.id, user.roles);
  }
}

const rbac = await createRBACFromStore(store, {
  onDecision: ({ request, result, durationMs }) => {
    console.log(
      JSON.stringify({
        event: "authorization",
        subject: request.subject.id,
        action: result.action,
        resource: result.resource,
        allowed: result.allowed,
        reason: result.reason,
        durationMs,
      })
    );
  },
});

rbac.registerPolicyFor("wallet", "delete", async ({ subject, resource }) => {
  if (typeof resource !== "object") return false;
  const wallet = await findWalletById(String(resource.id));
  return wallet?.ownerId === subject.id;
});

const getSubject = createStoreSubjectResolver(store, (req: Request) => {
  const header = req.headers["x-user-id"];
  if (typeof header !== "string") return undefined;
  return demoUsers[header as keyof typeof demoUsers]?.id ?? header;
});

const app = express();
app.use(express.json());

const { authorize } = createExpressMiddleware({ rbac, getSubject });
app.use("/rbac", createRbacAdminRouter({ store, rbac, getSubject }));

app.get("/wallets", authorize("wallet", "read"), (_req, res) => {
  res.json(listWallets());
});

app.get("/me/authorization", async (req, res) => {
  const subject = await getSubject(req);
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

const PORT = 3004;
app.listen(PORT, () => {
  const backend = process.env.DATABASE_URL ? "postgres" : "memory";
  console.log(`Store example (${backend}) on http://localhost:${PORT}`);
  console.log("\nTry:");
  console.log("  curl -H 'x-user-id: developer' http://localhost:3004/wallets");
  console.log("  curl -H 'x-user-id: admin' http://localhost:3004/rbac/roles");
  console.log(
    "  curl -X POST -H 'x-user-id: admin' -H 'content-type: application/json' " +
      "http://localhost:3004/rbac/roles " +
      `-d '{"name":"auditor","permissions":["wallet:read"]}'`
  );
});
