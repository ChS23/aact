import { loadStructurizrElements } from "../../src/loaders/structurizr";
import { ArchitectureModel } from "../../src/model";
import {
  checkAcl,
  checkAcyclic,
  checkApiGateway,
  checkCohesion,
  checkCrud,
  checkDbPerService,
  checkStableDependencies,
} from "../../src/rules";

describe("Rules demo on ecommerce Structurizr workspace", () => {
  let model: ArchitectureModel;

  beforeAll(async () => {
    model = await loadStructurizrElements(
      "examples/ecommerce-structurizr/workspace.json",
    );
  });

  it("ACL — only acl-tagged containers depend on externals", () => {
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

  it("API Gateway — external calls go through gateway", () => {
    expect(checkApiGateway(model.allContainers)).toHaveLength(0);
  });

  it("Stable Dependencies — dependencies point toward stability", () => {
    expect(checkStableDependencies(model.allContainers)).toHaveLength(0);
  });

  it("Cohesion — boundaries have more cohesion than coupling", () => {
    expect(checkCohesion(model)).toHaveLength(0);
  });
});
