import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RBACProvider, useCan } from "../provider/RBACProvider.js";
import { Can } from "../components/Can.js";

const subject = { id: "u1", roles: ["developer"] };
const permissions = [
  "wallet:read",
  "wallet:create",
  "transaction:read",
];

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
