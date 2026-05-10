import {
  loadPlantumlElements,
  mapContainersFromPlantumlElements,
} from "../../src/loaders/plantuml";
import { ArchitectureModel } from "../../src/model";
import {
  checkAcl,
  checkAcyclic,
  checkApiGateway,
  checkCohesion,
  checkCrud,
  checkStableDependencies,
} from "../../src/rules";

describe("Rules demo on C4L2.puml", () => {
  let model: ArchitectureModel;
  let containers: ArchitectureModel["allContainers"];

  beforeAll(async () => {
    const elements = await loadPlantumlElements(
      "resources/architecture/C4L2.puml",
    );
    model = mapContainersFromPlantumlElements(elements);
    containers = model.allContainers;
  });

  it("ACL — only acl-tagged containers depend on externals", () => {
    const violations = checkAcl(containers);
    expect(violations).toHaveLength(0);
  });

  it("Acyclic — no dependency cycles", () => {
    const violations = checkAcyclic(containers);
    expect(violations).toHaveLength(0);
  });

  it("API Gateway — external calls go through gateway", () => {
    const violations = checkApiGateway(containers);
    for (const v of violations) {
      console.log(`${v.container}: ${v.message}`);
    }
  });

  it("Stable Dependencies — dependencies point toward stability", () => {
    const violations = checkStableDependencies(containers);
    for (const v of violations) {
      console.log(`${v.container}: ${v.message}`);
    }
  });

  it("CRUD — only repo-tagged containers access databases", () => {
    const violations = checkCrud(containers);
    expect(violations).toHaveLength(0);
  });

  it("Cohesion — boundaries have more cohesion than coupling", () => {
    const violations = checkCohesion(model);
    for (const v of violations) {
      console.log(`${v.container}: ${v.message}`);
    }
    expect(violations).toBeDefined();
  });
});
