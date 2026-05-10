import { Container } from "../../src/model";
import { checkCrud } from "../../src/rules";

describe("checkCrud", () => {
  const db: Container = {
    name: "orders_db",
    label: "Orders DB",
    type: "ContainerDb",
    description: "",
    relations: [],
  };

  const otherService: Container = {
    name: "notifications",
    label: "Notifications",
    type: "Container",
    description: "",
    relations: [],
  };

  it("returns no violations when repo accesses only database", () => {
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

    expect(checkCrud(containers)).toHaveLength(0);
  });

  it("returns violation when non-repo accesses database", () => {
    const containers: Container[] = [
      {
        name: "orders_service",
        label: "Orders Service",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    const violations = checkCrud(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("orders_service");
  });

  it("returns violation when repo has non-database dependencies", () => {
    const containers: Container[] = [
      {
        name: "orders_repo",
        label: "Orders Repo",
        type: "Container",
        tags: ["repo"],
        description: "",
        relations: [{ to: db }, { to: otherService }],
      },
      db,
      otherService,
    ];

    const violations = checkCrud(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("non-database dependencies");
  });

  it("allows relay-tagged containers to access database", () => {
    const containers: Container[] = [
      {
        name: "orders_relay",
        label: "Orders Relay",
        type: "Container",
        tags: ["relay"],
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    expect(checkCrud(containers)).toHaveLength(0);
  });

  it("respects custom repoTags when checking repo outbound dependencies", () => {
    const containers: Container[] = [
      {
        name: "orders_relay",
        label: "Orders Relay",
        type: "Container",
        tags: ["relay"],
        description: "",
        relations: [{ to: db }, { to: otherService }],
      },
      db,
      otherService,
    ];

    const violations = checkCrud(containers, { repoTags: ["relay"] });
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("orders_relay");
    expect(violations[0].message).toContain("non-database dependencies");
  });

  it("returns no violations when container has no db relations", () => {
    const containers: Container[] = [
      {
        name: "api_gateway",
        label: "API Gateway",
        type: "Container",
        description: "",
        relations: [{ to: otherService }],
      },
      otherService,
    ];

    expect(checkCrud(containers)).toHaveLength(0);
  });
});
