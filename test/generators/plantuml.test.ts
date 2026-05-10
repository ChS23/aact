import { generatePlantuml } from "../../src/generators/plantuml";
import type { DeployConfig } from "../../src/loaders/kubernetes";

describe("generatePlantuml", () => {
  it("generates header and boundary", () => {
    const result = generatePlantuml([]);
    expect(result).toContain('@startuml "Demo Generated"');
    expect(result).toContain('Boundary(project, "Our system")');
    expect(result).toContain("@enduml");
  });

  it("uses custom boundaryLabel", () => {
    const result = generatePlantuml([], { boundaryLabel: "My Platform" });
    expect(result).toContain('Boundary(project, "My Platform")');
  });

  it("creates Container for each config", () => {
    const configs: DeployConfig[] = [
      { name: "orders", sections: [] },
      { name: "payments", sections: [] },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Container(orders, "orders")');
    expect(result).toContain('Container(payments, "payments")');
  });

  it("replaces underscores with spaces in container label", () => {
    const configs: DeployConfig[] = [{ name: "order_service", sections: [] }];
    const result = generatePlantuml(configs);
    expect(result).toContain('Container(order_service, "order service")');
  });

  it("adds acl tag to containers ending with acl", () => {
    const configs: DeployConfig[] = [{ name: "payments_acl", sections: [] }];
    const result = generatePlantuml(configs);
    expect(result).toContain(
      'Container(payments_acl, "payments acl", "", "", $tags="acl")',
    );
  });

  it("creates ContainerDb when PG_CONNECTION_STRING exists", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        environment: { PG_CONNECTION_STRING: { prod: "pg://..." } },
        sections: [],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('ContainerDb(orders_db, "DB")');
    expect(result).toContain("Rel(orders, orders_db,");
  });

  it("creates sync relation for non-kafka section", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        sections: [{ name: "payments", prod_value: "http://payments" }],
      },
      { name: "payments", sections: [] },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Rel(orders, payments, ""');
    expect(result).not.toContain("System_Ext(payments");
  });

  it("creates System_Ext for unknown sync target", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [{ name: "ext_gateway", prod_value: "https://ext.com/api" }],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('System_Ext(ext_gateway, "ext_gateway", " ")');
    expect(result).toContain(
      'Rel(orders, ext_gateway, "", "https://ext.com/api")',
    );
  });

  it("creates async relation for kafka sections", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [
          { name: "kafka_events_topic", prod_value: "events-topic-v1" },
        ],
      },
      {
        name: "notifications",
        sections: [
          { name: "kafka_events_topic", prod_value: "events-topic-v1" },
        ],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('Rel(orders, notifications, "", $tags="async")');
  });

  it("creates external async target when no matching consumer", () => {
    const configs: DeployConfig[] = [
      {
        name: "orders",
        sections: [{ name: "kafka_billing_topic", prod_value: "billing-v1" }],
      },
    ];
    const result = generatePlantuml(configs);
    expect(result).toContain('System_Ext(billing, "billing", " ")');
    expect(result).toContain('Rel(orders, billing, ""');
    expect(result).toContain('$tags="async"');
  });

  it("deduplicates bidirectional relations", () => {
    const configs: DeployConfig[] = [
      {
        name: "a",
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        sections: [{ name: "b", prod_value: "http://b" }],
      },
      {
        name: "b",
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        sections: [{ name: "a", prod_value: "http://a" }],
      },
    ];
    const result = generatePlantuml(configs);
    const relCount = (result.match(/Rel\(a, b,|Rel\(b, a,/g) ?? []).length;
    expect(relCount).toBe(1);
  });
});
