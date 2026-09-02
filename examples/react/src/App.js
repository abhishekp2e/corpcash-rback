import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { RBACProvider, useCan, useRole, Can, RequirePermission, } from "@corpcash/rbac-react";
const userPermissions = {
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
    ].filter(Boolean);
    return (_jsx("ul", { children: menu.map((item) => (_jsx("li", { children: item.label }, item.label))) }));
}
function Dashboard() {
    const canCreateWallet = useCan("wallet", "create");
    const canDeployContract = useCan("contract", "deploy");
    const isAdmin = useRole("admin");
    return (_jsxs("div", { style: { fontFamily: "system-ui", padding: 24 }, children: [_jsx("h1", { children: "Wallet Dashboard" }), _jsxs("p", { children: ["Admin role: ", isAdmin ? "yes" : "no"] }), _jsx("h2", { children: "Navigation" }), _jsx(NavMenu, {}), _jsx("h2", { children: "Actions" }), _jsx(Can, { resource: "wallet", action: "create", children: _jsx("button", { children: "Create Wallet" }) }), " ", _jsx(Can, { resource: "wallet", action: "delete", fallback: _jsx("span", { children: "No delete access" }), children: _jsx("button", { children: "Delete Wallet" }) }), " ", canCreateWallet && _jsx("span", { children: "(can create via hook)" }), canDeployContract && _jsx("button", { children: "Deploy Contract" }), _jsx(RequirePermission, { resource: "wallet", action: "read", fallback: _jsx("p", { children: "Access denied to wallet section." }), children: _jsxs("section", { children: [_jsx("h2", { children: "Wallet List" }), _jsx("p", { children: "You can view wallets." })] }) })] }));
}
export function App() {
    const [role, setRole] = useState("developer");
    const subject = users[role];
    const permissions = userPermissions[role];
    return (_jsxs("div", { children: [_jsxs("div", { style: { padding: 16, background: "#f5f5f5" }, children: [_jsxs("label", { children: ["Simulate user role:", " ", _jsxs("select", { value: role, onChange: (e) => setRole(e.target.value), children: [_jsx("option", { value: "viewer", children: "viewer" }), _jsx("option", { value: "developer", children: "developer" }), _jsx("option", { value: "admin", children: "admin" })] })] }), _jsx("p", { style: { fontSize: 12, color: "#666" }, children: "Frontend RBAC controls UX only. Backend must enforce authorization." })] }), _jsx(RBACProvider, { subject: subject, permissions: permissions, children: _jsx(Dashboard, {}) })] }));
}
