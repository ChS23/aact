import { generatePlantumlFromModel } from "../../src/generators/plantumlFromModel";
import type { ArchitectureModel } from "../../src/model";
import type { Boundary } from "../../src/model/boundary";
import type { Container } from "../../src/model/container";

const makeContainer = (
  overrides: Partial<Container> & Pick<Container, "name">,
): Container => ({
  label: overrides.name,
  type: "Container",
  description: "",
  relations: [],
  ...overrides,
});

describe("generatePlantumlFromModel", () => {
  it("generates valid plantuml with startuml/enduml", () => {
    const model: ArchitectureModel = { boundaries: [], allContainers: [] };
    const result = generatePlantumlFromModel(model);

    expect(result).toContain("@startuml");
    expect(result).toContain("@enduml");
    expect(result).toContain("C4_Container.puml");
  });

  it("renders containers outside boundaries", () => {
    const svc = makeContainer({ name: "orders", label: "Orders Service" });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [svc],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('Container(orders, "Orders Service"');
  });

  it("renders ContainerDb type", () => {
    const db = makeContainer({
      name: "orders_db",
      label: "Orders DB",
      type: "ContainerDb",
    });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [db],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('ContainerDb(orders_db, "Orders DB"');
  });

  it("renders System_Ext type", () => {
    const ext = makeContainer({
      name: "ext_api",
      label: "External API",
      type: "System_Ext",
    });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [ext],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('System_Ext(ext_api, "External API"');
  });

  it("renders System type as System, not falling back to Container", () => {
    const system = makeContainer({
      name: "core",
      label: "Core",
      type: "System",
    });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [system],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('System(core, "Core"');
    expect(result).not.toMatch(/Container\(core,/);
  });

  it("renders Component type as Component, not falling back to Container", () => {
    const component = makeContainer({
      name: "auth_module",
      label: "Auth Module",
      type: "Component",
    });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [component],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('Component(auth_module, "Auth Module"');
    expect(result).not.toMatch(/Container\(auth_module,/);
  });

  it("renders Person type", () => {
    const person = makeContainer({
      name: "user",
      label: "User",
      type: "Person",
    });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [person],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('Person(user, "User"');
  });

  it("renders container tags", () => {
    const svc = makeContainer({
      name: "gateway_acl",
      label: "Gateway ACL",
      tags: ["acl", "repo"],
    });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [svc],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('$tags="acl+repo"');
  });

  it("renders relations with technology", () => {
    const target = makeContainer({ name: "payments" });
    const source = makeContainer({
      name: "orders",
      relations: [{ to: target, technology: "REST" }],
    });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [source, target],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('Rel(orders, payments, "", "REST")');
  });

  it("renders async relation tags", () => {
    const target = makeContainer({ name: "notifications" });
    const source = makeContainer({
      name: "orders",
      relations: [{ to: target, tags: ["async"] }],
    });
    const model: ArchitectureModel = {
      boundaries: [],
      allContainers: [source, target],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('$tags="async"');
  });

  it("renders boundaries with containers inside", () => {
    const svc = makeContainer({ name: "orders", label: "Orders" });
    const boundary: Boundary = {
      name: "platform",
      label: "Platform",
      type: "Boundary",
      boundaries: [],
      containers: [svc],
    };
    const model: ArchitectureModel = {
      boundaries: [boundary],
      allContainers: [svc],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('Boundary(platform, "Platform")');
    expect(result).toContain('Container(orders, "Orders"');
    // Container should be inside boundary, not rendered separately
    const lines = result.split("\n");
    const boundaryLine = lines.findIndex((l) =>
      l.includes("Boundary(platform"),
    );
    const containerLine = lines.findIndex((l) =>
      l.includes("Container(orders"),
    );
    expect(containerLine).toBeGreaterThan(boundaryLine);
  });

  it("renders nested boundaries", () => {
    const inner = makeContainer({ name: "svc", label: "Service" });
    const childBoundary: Boundary = {
      name: "child",
      label: "Child",
      type: "Boundary",
      boundaries: [],
      containers: [inner],
    };
    const parentBoundary: Boundary = {
      name: "parent",
      label: "Parent",
      type: "Boundary",
      boundaries: [childBoundary],
      containers: [],
    };
    const model: ArchitectureModel = {
      boundaries: [parentBoundary],
      allContainers: [inner],
    };

    const result = generatePlantumlFromModel(model);

    expect(result).toContain('Boundary(parent, "Parent")');
    expect(result).toContain('Boundary(child, "Child")');
    expect(result).toContain('Container(svc, "Service"');
  });

  it("wraps in project boundary when boundaryLabel is set", () => {
    const svc = makeContainer({ name: "svc", label: "Service" });
    const boundary: Boundary = {
      name: "ctx",
      label: "Context",
      type: "Boundary",
      boundaries: [],
      containers: [svc],
    };
    const model: ArchitectureModel = {
      boundaries: [boundary],
      allContainers: [svc],
    };

    const result = generatePlantumlFromModel(model, {
      boundaryLabel: "My System",
    });

    expect(result).toContain('Boundary(project, "My System")');
  });

  it("does not render boundary containers as standalone", () => {
    const inside = makeContainer({ name: "inside_svc" });
    const outside = makeContainer({
      name: "ext",
      label: "External",
      type: "System_Ext",
    });
    const boundary: Boundary = {
      name: "ctx",
      label: "Context",
      type: "Boundary",
      boundaries: [],
      containers: [inside],
    };
    const model: ArchitectureModel = {
      boundaries: [boundary],
      allContainers: [inside, outside],
    };

    const result = generatePlantumlFromModel(model);
    const lines = result.split("\n");

    // inside_svc appears only once (inside boundary)
    const insideOccurrences = lines.filter((l) => l.includes("inside_svc"));
    expect(insideOccurrences).toHaveLength(1);

    // ext appears as standalone
    expect(result).toContain('System_Ext(ext, "External"');
  });
});
