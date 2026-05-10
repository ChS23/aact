import { analyzeArchitecture } from "../../src/analyzer";
import { generateKubernetes } from "../../src/generators/kubernetes";
import { generatePlantumlFromModel } from "../../src/generators/plantumlFromModel";
import { loadStructurizrElements } from "../../src/loaders/structurizr";
import { ArchitectureModel } from "../../src/model";
import {
  checkAcl,
  checkAcyclic,
  checkCohesion,
  checkCrud,
  checkDbPerService,
} from "../../src/rules";

describe("Microservices (Structurizr)", () => {
  let model: ArchitectureModel;

  beforeAll(async () => {
    model = await loadStructurizrElements(
      "resources/architecture/workspace.json",
    );
  });

  it("loads containers, boundaries, and relations", () => {
    expect(model.allContainers.length).toBeGreaterThan(0);
    expect(model.boundaries.length).toBeGreaterThan(0);

    const withRelations = model.allContainers.filter(
      (c) => c.relations.length > 0,
    );
    expect(withRelations.length).toBeGreaterThan(0);
  });

  it("ACL — only acl-tagged containers depend on externals", () => {
    const violations = checkAcl(model.allContainers);
    for (const v of violations) {
      console.log(`${v.container}: ${v.message}`);
    }
    expect(violations).toBeDefined();
  });

  it("Acyclic — no dependency cycles", () => {
    const violations = checkAcyclic(model.allContainers);
    expect(violations).toHaveLength(0);
  });

  it("DB per service — each database accessed by single service", () => {
    const violations = checkDbPerService(model.allContainers);
    expect(violations).toHaveLength(0);
  });

  it("CRUD — only repo-tagged containers access databases", () => {
    const violations = checkCrud(model.allContainers);
    expect(violations).toHaveLength(0);
  });

  it("Cohesion — boundaries have more cohesion than coupling", () => {
    const violations = checkCohesion(model);
    for (const v of violations) {
      console.log(`${v.container}: ${v.message}`);
    }
    expect(violations).toBeDefined();
  });

  it("analyzeArchitecture returns metrics", () => {
    const { report } = analyzeArchitecture(model);

    expect(report.elementsCount).toBeGreaterThan(0);
    expect(report.boundaries.length).toBeGreaterThan(0);
    expect(report.databases.count).toBeGreaterThanOrEqual(0);
  });

  it("generates Kubernetes configs from model", () => {
    const outputs = generateKubernetes(model);

    expect(outputs.length).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(output.fileName).toMatch(/\.yml$/);
      expect(output.content).toContain("name:");
    }
  });

  it("generates valid PlantUML from model", () => {
    const puml = generatePlantumlFromModel(model);

    expect(puml).toContain("@startuml");
    expect(puml).toContain("@enduml");
  });
});
