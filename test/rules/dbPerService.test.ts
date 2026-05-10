import { Container } from "../../src/model";
import { checkDbPerService } from "../../src/rules";

describe("checkDbPerService", () => {
  const db: Container = {
    name: "orders_db",
    label: "Orders DB",
    type: "ContainerDb",
    description: "",
    relations: [],
  };

  it("returns no violations when each db accessed by one service", () => {
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        tags: ["repo"],
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    expect(checkDbPerService(containers)).toHaveLength(0);
  });

  it("returns violation when db accessed by multiple services", () => {
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      {
        name: "payments_service",
        label: "Payments Service",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    const violations = checkDbPerService(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("orders_db");
    expect(violations[0].message).toContain("orders_repo");
    expect(violations[0].message).toContain("payments_service");
  });

  it("returns no violations when no db relations", () => {
    const other: Container = {
      name: "notifications",
      label: "Notifications",
      type: "Container",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "api",
        label: "API",
        type: "Container",
        description: "",
        relations: [{ to: other }],
      },
      other,
    ];

    expect(checkDbPerService(containers)).toHaveLength(0);
  });

  it("respects custom dbType option", () => {
    const cache: Container = {
      name: "redis",
      label: "Redis",
      type: "Cache",
      description: "",
      relations: [],
    };
    const svc1: Container = {
      name: "svc_a",
      label: "A",
      type: "Container",
      description: "",
      relations: [{ to: cache }],
    };
    const svc2: Container = {
      name: "svc_b",
      label: "B",
      type: "Container",
      description: "",
      relations: [{ to: cache }],
    };

    expect(checkDbPerService([svc1, svc2, cache])).toHaveLength(0);
    expect(
      checkDbPerService([svc1, svc2, cache], { dbType: "Cache" }),
    ).toHaveLength(1);
  });

  it("handles multiple databases correctly", () => {
    const db2: Container = {
      name: "users_db",
      label: "Users DB",
      type: "ContainerDb",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      {
        name: "users_repo",
        label: "Users Repo",
        type: "Container",
        description: "",
        relations: [{ to: db2 }],
      },
      db,
      db2,
    ];

    expect(checkDbPerService(containers)).toHaveLength(0);
  });
});
