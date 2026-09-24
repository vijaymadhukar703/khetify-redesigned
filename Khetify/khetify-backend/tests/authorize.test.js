const authorize = require("../middlewares/authorize");
const { hasCapability, deniedForRole } = require("../config/permissions");

function run(role, ...requirements) {
  const req = { user: { role } };
  let status = null;
  let body = null;
  let nextCalled = false;
  const res = {
    status(c) {
      status = c;
      return this;
    },
    json(b) {
      body = b;
      return this;
    },
  };
  authorize(...requirements)(req, res, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled };
}

describe("authorize() capability gating", () => {
  test("company_admin passes any capability (wildcard *)", () => {
    expect(run("company_admin", "grn:post").nextCalled).toBe(true);
    expect(run("super_admin", "recall:execute").nextCalled).toBe(true);
  });

  test("warehouse_operator can create a GRN but cannot approve adjustments", () => {
    expect(run("warehouse_operator", "grn:create").nextCalled).toBe(true);
    const denied = run("warehouse_operator", "adjustment:approve");
    expect(denied.nextCalled).toBe(false);
    expect(denied.status).toBe(403);
  });

  test("entity wildcard grants all actions on that entity", () => {
    // warehouse_manager has grn:* → grn:post is implied
    expect(run("warehouse_manager", "grn:post").nextCalled).toBe(true);
  });

  test("auditor is read-only: report:read yes, anything:write no", () => {
    expect(run("auditor", "report:read").nextCalled).toBe(true);
    expect(run("auditor", "audit:read").nextCalled).toBe(true);
    expect(run("auditor", "order:create").nextCalled).toBe(false);
    expect(run("auditor", "shipment:verify").nextCalled).toBe(false);
  });

  test("legacy role-name argument still works", () => {
    expect(run("company_admin", "company_admin").nextCalled).toBe(true);
    expect(run("warehouse_operator", "company_admin").nextCalled).toBe(false);
  });

  test("ANY requirement satisfied passes (OR semantics)", () => {
    expect(run("sales_manager", "order:create", "grn:post").nextCalled).toBe(true);
  });

  test("missing role falls back to company_admin (legacy tokens)", () => {
    const req = {};
    let next = false;
    authorize("inventory:read")(req, { status: () => ({ json: () => {} }) }, () => {
      next = true;
    });
    expect(next).toBe(true);
  });
});

describe("hasCapability() resolution", () => {
  test("driver can update own shipment but not others", () => {
    expect(hasCapability("driver", "shipment:update_own")).toBe(true);
    expect(hasCapability("driver", "shipment:verify")).toBe(false);
  });
});

describe("warehouse transfer is denied to company_admin (view-only)", () => {
  test("company_admin is explicitly denied inventory:transfer despite the * wildcard", () => {
    expect(hasCapability("company_admin", "inventory:transfer")).toBe(false);
    expect(deniedForRole("company_admin")).toContain("inventory:transfer");
    // the deny also blocks it at the route middleware layer
    expect(run("company_admin", "inventory:transfer").nextCalled).toBe(false);
    expect(run("company_admin", "inventory:transfer").status).toBe(403);
  });

  test("operations_manager keeps inventory:transfer (via inventory:*)", () => {
    expect(hasCapability("operations_manager", "inventory:transfer")).toBe(true);
    expect(run("operations_manager", "inventory:transfer").nextCalled).toBe(true);
  });

  test("admin retains all read access and non-transfer writes", () => {
    expect(hasCapability("company_admin", "shipment:read")).toBe(true);
    // Creating a shipment is NOT one of them — it is denied like inventory:transfer.
    expect(hasCapability("company_admin", "shipment:create")).toBe(false);
    expect(hasCapability("company_admin", "inventory:read")).toBe(true);
    expect(hasCapability("company_admin", "grn:post")).toBe(true);
  });

  test("shipment:create is denied to company_admin, and kept by the roles that ship", () => {
    // Goods are shipped by the warehouse side; the admin's Shipment Tracking view
    // is oversight. The deny beats "*" at the route middleware too.
    expect(deniedForRole("company_admin")).toContain("shipment:create");
    expect(run("company_admin", "shipment:create").nextCalled).toBe(false);
    expect(run("company_admin", "shipment:create").status).toBe(403);

    expect(run("operations_manager", "shipment:create").nextCalled).toBe(true);
    expect(run("transport_manager", "shipment:create").nextCalled).toBe(true);

    expect(run("sales_manager", "shipment:create").status).toBe(403);
  });

  test("cost:read was removed only from operations_manager", () => {
    expect(hasCapability("operations_manager", "cost:read")).toBe(false);
    expect(hasCapability("operations_manager", "report:read")).toBe(true);
    // other cost-holding roles are untouched
    expect(hasCapability("company_admin", "cost:read")).toBe(true);
    expect(hasCapability("sales_manager", "cost:read")).toBe(true);
    expect(hasCapability("inventory_manager", "cost:read")).toBe(true);
  });
});
