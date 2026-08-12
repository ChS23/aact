import { generate } from "../../../src/formats/plantuml/generate";
import { parseSource } from "../../../src/formats/plantuml/parser";
import type { ElementSpec } from "../../helpers/makeModel";
import { makeModel } from "../../helpers/makeModel";

const renderModel = (
  containers: ElementSpec[],
  boundaries: Parameters<typeof makeModel>[0]["boundaries"] = [],
  options?: Parameters<typeof generate>[1],
): string => {
  const model = makeModel({ elements: containers, boundaries });
  const output = generate(model, options);
  return output.files[0].content;
};

describe("plantuml generate", () => {
  it("generates valid plantuml with startuml/enduml", () => {
    const result = renderModel([]);
    expect(result).toContain("@startuml");
    expect(result).toContain("@enduml");
    expect(result).toContain("C4_Container.puml");
  });

  it("output has files: [{ path: 'architecture.puml' }]", () => {
    const model = makeModel({});
    const output = generate(model);
    expect(output.files).toHaveLength(1);
    expect(output.files[0].path).toBe("architecture.puml");
  });

  it("renders containers outside boundaries", () => {
    const result = renderModel([{ name: "orders", label: "Orders Service" }]);
    expect(result).toContain('Container(orders, "Orders Service"');
  });

  it("renders ContainerDb kind", () => {
    const result = renderModel([
      { name: "orders_db", label: "Orders DB", kind: "ContainerDb" },
    ]);
    expect(result).toContain('ContainerDb(orders_db, "Orders DB"');
  });

  it("renders System_Ext (kind=System + external=true)", () => {
    const result = renderModel([
      {
        name: "ext_api",
        label: "External API",
        kind: "System",
        external: true,
      },
    ]);
    expect(result).toContain('System_Ext(ext_api, "External API"');
  });

  it("renders System as System, not falling back to Container", () => {
    const result = renderModel([
      { name: "core", label: "Core", kind: "System" },
    ]);
    expect(result).toContain('System(core, "Core"');
    expect(result).not.toMatch(/Container\(core,/);
  });

  it("renders Component as Component, not falling back to Container", () => {
    const result = renderModel([
      { name: "auth_module", label: "Auth Module", kind: "Component" },
    ]);
    expect(result).toContain('Component(auth_module, "Auth Module"');
    expect(result).not.toMatch(/Container\(auth_module,/);
  });

  it("renders Person kind", () => {
    const result = renderModel([
      { name: "user", label: "User", kind: "Person" },
    ]);
    expect(result).toContain('Person(user, "User"');
  });

  it("renders container tags joined with +", () => {
    const result = renderModel([
      { name: "gateway_acl", label: "Gateway ACL", tags: ["acl", "repo"] },
    ]);
    expect(result).toContain('$tags="acl+repo"');
  });

  it("renders relations with technology", () => {
    const result = renderModel([
      {
        name: "orders",
        relations: [{ to: "payments", technology: "REST" }],
      },
      { name: "payments" },
    ]);
    expect(result).toContain('Rel(orders, payments, "", "REST")');
  });

  it("escapes PlantUML Creole markup in generated text arguments", () => {
    const url = "https://gateway.int.com:443/goods/v1";
    const result = renderModel([
      {
        name: "gateway",
        label: "Gateway // Edge",
        properties: { endpoint: url },
        relations: [
          {
            to: "goods",
            description: `GET ${url}`,
            technology: url,
          },
        ],
      },
      { name: "goods" },
    ]);

    expect(result).toContain('Container(gateway, "Gateway ~// Edge")');
    expect(result).toContain('AddProperty("endpoint", "https:~//gateway');
    expect(result).toContain(
      'Rel(gateway, goods, "GET https:~//gateway.int.com:443/goods/v1", "https:~//gateway.int.com:443/goods/v1")',
    );
    expect(result).not.toContain(
      'Rel(gateway, goods, "GET https://gateway.int.com:443/goods/v1", "https://gateway.int.com:443/goods/v1")',
    );

    const parsed = parseSource(result, "generated.puml");
    expect(parsed.parseErrors).toEqual([]);
    const gateway = parsed.model.elements.gateway;
    expect(gateway?.label).toBe("Gateway // Edge");
    expect(gateway?.properties?.endpoint).toBe(url);
    expect(gateway?.relations[0]?.description).toBe(`GET ${url}`);
    expect(gateway?.relations[0]?.technology).toBe(url);
  });

  it("renders async relation tags", () => {
    const result = renderModel([
      {
        name: "orders",
        relations: [{ to: "notifications", tags: ["async"] }],
      },
      { name: "notifications" },
    ]);
    expect(result).toContain('$tags="async"');
  });

  it("renders boundaries with containers inside", () => {
    const result = renderModel(
      [{ name: "orders", label: "Orders" }],
      [
        {
          name: "platform",
          label: "Platform",
          elementNames: ["orders"],
        },
      ],
    );
    expect(result).toContain('System_Boundary(platform, "Platform")');
    expect(result).toContain('Container(orders, "Orders"');
    const lines = result.split("\n");
    const boundaryLine = lines.findIndex((l) =>
      l.includes("System_Boundary(platform"),
    );
    const containerLine = lines.findIndex((l) =>
      l.includes("Container(orders"),
    );
    expect(containerLine).toBeGreaterThan(boundaryLine);
  });

  it("renders nested boundaries", () => {
    const result = renderModel(
      [{ name: "svc", label: "Service" }],
      [
        {
          name: "parent",
          label: "Parent",
          boundaryNames: ["child"],
        },
        { name: "child", label: "Child", elementNames: ["svc"] },
      ],
    );
    // makeModel passes rootBoundaryNames default = all boundaries — but
    // child should not be root if parent contains it. makeModel default
    // covers that case via rootBoundaryNames? Let's verify.
    expect(result).toContain('System_Boundary(parent, "Parent")');
    expect(result).toContain('System_Boundary(child, "Child")');
    expect(result).toContain('Container(svc, "Service"');
  });

  it("wraps in project boundary when boundaryLabel is set", () => {
    const model = makeModel({
      elements: [
        { name: "svc", label: "Service" },
        {
          name: "ext",
          label: "Ext",
          kind: "System",
          external: true,
        },
      ],
      boundaries: [{ name: "ctx", label: "Context", elementNames: ["svc"] }],
    });
    const output = generate(model, { boundaryLabel: "My System" });
    const result = output.files[0].content;

    expect(result).toMatchInlineSnapshot(`
      "@startuml
      !include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
      LAYOUT_WITH_LEGEND()
      AddRelTag("async", \$lineStyle = DottedLine())

      Boundary(project, "My System") {
        System_Boundary(ctx, "Context") {
          Container(svc, "Service")
        }
        System_Ext(ext, "Ext")
      }

      @enduml"
    `);
  });

  it("does NOT emit $tags suffix when container.tags is an empty array", () => {
    const result = renderModel([{ name: "svc", label: "Svc", tags: [] }]);
    expect(result).toContain('Container(svc, "Svc")');
    expect(result).not.toContain("$tags=");
  });

  it("does NOT emit $tags suffix when relation.tags is an empty array", () => {
    const result = renderModel([
      { name: "a", relations: [{ to: "b", tags: [] }] },
      { name: "b" },
    ]);
    expect(result).toContain("Rel(a, b,");
    expect(result).not.toContain("$tags=");
  });

  it("renders a full model end-to-end (regression snapshot)", () => {
    const model = makeModel({
      elements: [
        {
          name: "orders_api",
          label: "Orders API",
          relations: [
            { to: "orders_repo" },
            { to: "ext_payments", technology: "REST", tags: ["async"] },
          ],
        },
        {
          name: "orders_repo",
          label: "Orders Repo",
          tags: ["repo"],
          relations: [{ to: "orders_db", technology: "SQL" }],
        },
        { name: "orders_db", label: "Orders DB", kind: "ContainerDb" },
        {
          name: "ext_payments",
          label: "External Payments",
          kind: "System",
          external: true,
        },
      ],
      boundaries: [
        {
          name: "orders",
          label: "Orders Context",
          elementNames: ["orders_api", "orders_repo", "orders_db"],
        },
      ],
    });

    expect(generate(model).files[0].content).toMatchInlineSnapshot(`
      "@startuml
      !include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml
      LAYOUT_WITH_LEGEND()
      AddRelTag("async", $lineStyle = DottedLine())

      System_Boundary(orders, "Orders Context") {
        Container(orders_api, "Orders API")
        Container(orders_repo, "Orders Repo", $tags="repo")
        ContainerDb(orders_db, "Orders DB")
      }
      System_Ext(ext_payments, "External Payments")

      Rel(orders_api, orders_repo, "")
      Rel(orders_api, ext_payments, "", "REST", $tags="async")
      Rel(orders_repo, orders_db, "", "SQL")
      @enduml"
    `);
  });

  it("does not render boundary containers as standalone", () => {
    const result = renderModel(
      [
        { name: "inside_svc" },
        { name: "ext", label: "External", kind: "System", external: true },
      ],
      [{ name: "ctx", label: "Context", elementNames: ["inside_svc"] }],
    );
    const lines = result.split("\n");
    const insideOccurrences = lines.filter((l) => l.includes("inside_svc"));
    expect(insideOccurrences).toHaveLength(1);
    expect(result).toContain('System_Ext(ext, "External"');
  });
});
