import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import {
  RBACProvider,
  useCan,
  useRBAC,
  useRole,
} from "../provider/RBACProvider.js";
import { Can, RequirePermission, RequireRole } from "../components/Can.js";

const subject = { id: "u1", roles: ["developer"] };
const permissions = ["wallet:read", "wallet:create", "transaction:read"];

const roles = {
  viewer: { permissions: ["wallet:read"] },
  developer: { inherits: ["viewer"], permissions: ["wallet:create"] },
};

function TestComponent() {
  const canCreate = useCan("wallet", "create");
  const canDelete = useCan("wallet", "delete");
  return (
    <div>
      <span data-testid="create">{canCreate ? "yes" : "no"}</span>
      <span data-testid="delete">{canDelete ? "yes" : "no"}</span>
    </div>
  );
}

describe("RBAC React", () => {
  it("useCan returns true for granted permissions", () => {
    render(
      <RBACProvider subject={subject} permissions={permissions}>
        <TestComponent />
      </RBACProvider>
    );
    expect(screen.getByTestId("create").textContent).toBe("yes");
    expect(screen.getByTestId("delete").textContent).toBe("no");
  });

  it("Can renders children when allowed", () => {
    render(
      <RBACProvider subject={subject} permissions={permissions}>
        <Can resource="wallet" action="create">
          <button>Create</button>
        </Can>
        <Can resource="wallet" action="delete">
          <button>Delete</button>
        </Can>
      </RBACProvider>
    );
    expect(screen.getByText("Create")).toBeDefined();
    expect(screen.queryByText("Delete")).toBeNull();
  });

  it("RequirePermission gates on a resource instance", () => {
    render(
      <RBACProvider subject={subject} permissions={permissions}>
        <RequirePermission
          resource="wallet"
          action="read"
          resourceInstance={{ type: "wallet", id: "w1" }}
          fallback={<span>Hidden</span>}
        >
          <span>Wallet detail</span>
        </RequirePermission>
        <RequirePermission
          resource="wallet"
          action="delete"
          fallback={<span>Hidden</span>}
        >
          <span>Delete wallet</span>
        </RequirePermission>
      </RBACProvider>
    );

    expect(screen.getByText("Wallet detail")).toBeDefined();
    expect(screen.queryByText("Delete wallet")).toBeNull();
    expect(screen.getByText("Hidden")).toBeDefined();
  });

  it("RequireRole renders its fallback for a role the subject lacks", () => {
    render(
      <RBACProvider subject={subject} roles={roles}>
        <RequireRole role="admin" fallback={<span>No admin</span>}>
          <span>Admin area</span>
        </RequireRole>
      </RBACProvider>
    );

    expect(screen.getByText("No admin")).toBeDefined();
  });

  it("Can renders fallback when denied", () => {
    render(
      <RBACProvider subject={subject} permissions={permissions}>
        <Can resource="wallet" action="delete" fallback={<span>Denied</span>}>
          <button>Delete</button>
        </Can>
      </RBACProvider>
    );
    expect(screen.getByText("Denied")).toBeDefined();
  });
});

describe("malformed permissions", () => {
  function BadPermissions({
    onInvalid,
  }: {
    onInvalid: (v: readonly string[]) => void;
  }) {
    return (
      <RBACProvider
        subject={subject}
        permissions={["wallet:read", "oops", ""]}
        onInvalidPermissions={onInvalid}
      >
        <TestComponent />
        <Can resource="wallet" action="read">
          <span>Wallets</span>
        </Can>
      </RBACProvider>
    );
  }

  it("skips unusable entries instead of crashing the tree", () => {
    const onInvalid = vi.fn();
    render(<BadPermissions onInvalid={onInvalid} />);

    expect(screen.getByText("Wallets")).toBeDefined();
    expect(screen.getByTestId("delete").textContent).toBe("no");
    expect(onInvalid).toHaveBeenCalledWith(["oops", ""]);
  });
});

describe("useRole", () => {
  function RoleProbe() {
    const isViewer = useRole("viewer");
    const isAdmin = useRole("admin");
    return (
      <div>
        <span data-testid="viewer">{isViewer ? "yes" : "no"}</span>
        <span data-testid="admin">{isAdmin ? "yes" : "no"}</span>
      </div>
    );
  }

  it("counts inherited roles when a role config is supplied", () => {
    render(
      <RBACProvider subject={subject} roles={roles}>
        <RoleProbe />
        <RequireRole role="viewer">
          <span>Viewer area</span>
        </RequireRole>
      </RBACProvider>
    );

    expect(screen.getByTestId("viewer").textContent).toBe("yes");
    expect(screen.getByTestId("admin").textContent).toBe("no");
    expect(screen.getByText("Viewer area")).toBeDefined();
  });

  it("falls back to the subject's own roles in permission-only mode", () => {
    render(
      <RBACProvider subject={subject} permissions={permissions}>
        <RoleProbe />
      </RBACProvider>
    );

    expect(screen.getByTestId("viewer").textContent).toBe("no");
  });
});

describe("engine identity", () => {
  const seen = new Set<unknown>();

  function EngineProbe() {
    const { rbac } = useRBAC();
    const [count, setCount] = useState(0);
    seen.add(rbac);
    return (
      <button onClick={() => setCount(count + 1)}>{`renders:${count}`}</button>
    );
  }

  it("does not rebuild the engine when an inline permissions array is passed", () => {
    const { rerender } = render(
      <RBACProvider subject={subject} permissions={["wallet:read"]}>
        <EngineProbe />
      </RBACProvider>
    );

    rerender(
      <RBACProvider subject={subject} permissions={["wallet:read"]}>
        <EngineProbe />
      </RBACProvider>
    );

    expect(seen.size).toBe(1);
  });
});
