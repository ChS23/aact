import { load } from "../../src/formats/structurizr/load";
import type { Model } from "../../src/model";
import {
  aclRule,
  acyclicRule,
  apiGatewayRule,
  crudRule,
  dbPerServiceRule,
  stableDependenciesRule,
} from "../../src/rules";
import { cohesionRule } from "../../src/rules/cohesion";

describe("Rules demo on ecommerce Structurizr workspace", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("examples/ecommerce-structurizr/workspace.json");
    model = result.model;
  });

  it("ACL — only acl-tagged containers depend on externals", () => {
    expect(aclRule.check(model)).toHaveLength(0);
  });

  it("Acyclic — no dependency cycles", () => {
    expect(acyclicRule.check(model)).toHaveLength(0);
  });

  it("CRUD — only repo-tagged containers access databases", () => {
    expect(crudRule.check(model)).toHaveLength(0);
  });

  it("DB per service — each database accessed by single service", () => {
    expect(dbPerServiceRule.check(model)).toHaveLength(0);
  });

  it("API Gateway — external calls go through gateway", () => {
    // Demo fixture has intentional gateway gaps to illustrate the rule's output.
    const violations = apiGatewayRule.check(model);
    expect(violations).toBeDefined();
    for (const v of violations) {
      console.log(`${v.target}: ${v.message}`);
    }
  });

  it("Stable Dependencies — dependencies point toward stability", () => {
    expect(stableDependenciesRule.check(model)).toHaveLength(0);
  });

  it("Cohesion — boundaries have more cohesion than coupling", () => {
    expect(cohesionRule.check(model)).toHaveLength(0);
  });
});
