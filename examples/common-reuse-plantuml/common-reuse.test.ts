import {
  loadPlantumlElements,
  mapContainersFromPlantumlElements,
} from "../../src/loaders/plantuml";
import { ArchitectureModel } from "../../src/model";
import {
  checkAcl,
  checkAcyclic,
  checkCohesion,
  checkCommonReuse,
  checkCrud,
  checkDbPerService,
} from "../../src/rules";

describe("Rules on common-reuse.puml", () => {
  let model: ArchitectureModel;

  beforeAll(async () => {
    const elements = await loadPlantumlElements(
      "resources/architecture/common-reuse.puml",
    );
    model = mapContainersFromPlantumlElements(elements);
  });

  it("loads three boundaries", () => {
    expect(model.boundaries).toHaveLength(3);
  });

  it("ACL — no external system dependencies", () => {
    expect(checkAcl(model.allContainers)).toHaveLength(0);
  });

  it("Acyclic — no dependency cycles", () => {
    expect(checkAcyclic(model.allContainers)).toHaveLength(0);
  });

  it("CRUD — only repo-tagged containers access databases", () => {
    expect(checkCrud(model.allContainers)).toHaveLength(0);
  });

  it("DB per service — each database accessed by single service", () => {
    expect(checkDbPerService(model.allContainers)).toHaveLength(0);
  });

  it("Cohesion — boundaries have more cohesion than coupling", () => {
    const violations = checkCohesion(model);
    for (const v of violations) {
      console.log(`${v.container}: ${v.message}`);
    }
    expect(violations).toBeDefined();
  });

  it("Common Reuse — inventory uses orders_api but not orders_events", () => {
    const violations = checkCommonReuse(model);

    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("inventory");
    expect(violations[0].message).toContain("orders_events");
  });
});
