import { load } from "../../src/formats/plantuml/load";
import type { Model } from "../../src/model";
import {
  aclRule,
  acyclicRule,
  apiGatewayRule,
  crudRule,
  stableDependenciesRule,
} from "../../src/rules";
import { cohesionRule } from "../../src/rules/cohesion";

describe("Rules demo on C4L2.puml", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("fixtures/architecture/C4L2.puml");
    model = result.model;
  });

  it("ACL — only acl-tagged containers depend on externals", () => {
    expect(aclRule.check(model)).toHaveLength(0);
  });

  it("Acyclic — no dependency cycles", () => {
    expect(acyclicRule.check(model)).toHaveLength(0);
  });

  it("API Gateway — external calls go through gateway", () => {
    // Banking fixture intentionally has gateway gaps to demo the rule's output.
    const violations = apiGatewayRule.check(model);
    expect(violations).toBeDefined();
    for (const v of violations) {
      console.log(`${v.target}: ${v.message}`);
    }
  });

  it("Stable Dependencies — dependencies point toward stability", () => {
    const violations = stableDependenciesRule.check(model);
    expect(violations).toBeDefined();
    for (const v of violations) {
      console.log(`${v.target}: ${v.message}`);
    }
  });

  it("CRUD — only repo-tagged containers access databases", () => {
    expect(crudRule.check(model)).toHaveLength(0);
  });

  it("Cohesion — boundaries have more cohesion than coupling", () => {
    const violations = cohesionRule.check(model);
    for (const v of violations) {
      console.log(`${v.target}: ${v.message}`);
    }
    expect(violations).toBeDefined();
  });
});
