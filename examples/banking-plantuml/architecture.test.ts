import { kubernetesFormat } from "../../src/formats/kubernetes";
import { plantumlFormat } from "../../src/formats/plantuml";
import { load } from "../../src/formats/plantuml/load";
import type { Model } from "../../src/model";
import { allElements, targetOf } from "../../src/model";

describe("Architecture (banking C4L2)", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("fixtures/architecture/C4L2.puml");
    model = result.model;
  });

  it("only acl can depend on external systems", () => {
    let badRelations = 0;
    for (const container of allElements(model)) {
      const externalRels = container.relations.filter(
        (r) => targetOf(model, r)?.external === true,
      );
      if (!container.tags.includes("acl") && externalRels.length > 0) {
        console.log(
          `${container.name} ❌ ${externalRels.map((r) => r.to).join(", ")}`,
        );
        badRelations += externalRels.length;
      }
    }
    expect(badRelations).toBe(0);
  });

  it("connect to external systems only by API Gateway or kafka", () => {
    let pass = true;
    for (const container of allElements(model)) {
      for (const rel of container.relations) {
        const target = targetOf(model, rel);
        if (target?.external !== true) continue;
        const techParts = rel.technology?.split(", ") ?? [];
        const valid = techParts.every(
          (t) =>
            t.startsWith("https://gateway.int.com:443/") || /-v\d$/.exec(t),
        );
        if (!valid) {
          console.log(`${container.name} ❌ ${rel.to}`);
          pass = false;
        }
      }
    }
    expect(pass).toBeTruthy();
  });

  it("generate kubernetes manifests from model", () => {
    const output = kubernetesFormat.generate!(model);
    expect(output.files.length).toBeGreaterThan(0);
    for (const file of output.files) {
      expect(file.path).toMatch(/\.yaml$/);
      expect(file.content).toContain("apiVersion:");
    }
  });

  it("generate puml from model", () => {
    const output = plantumlFormat.generate!(model);
    expect(output.files).toHaveLength(1);
    const puml = output.files[0].content;
    expect(puml).toContain("@startuml");
    expect(puml).toContain("@enduml");
  });
});
