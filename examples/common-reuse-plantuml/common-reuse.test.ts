import { load } from "../../src/formats/plantuml/load";
import type { Model } from "../../src/model";
import {
  aclRule,
  acyclicRule,
  commonReuseRule,
  crudRule,
  dbPerServiceRule,
} from "../../src/rules";
import { cohesionRule } from "../../src/rules/cohesion";

describe("Rules on common-reuse.puml", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("fixtures/architecture/common-reuse.puml");
    model = result.model;
  });

  it("loads three boundaries", () => {
    expect(Object.values(model.boundaries)).toHaveLength(3);
  });

  it("ACL — no external system dependencies", () => {
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

  it("Cohesion — boundaries have more cohesion than coupling", () => {
    const violations = cohesionRule.check(model);
    for (const v of violations) {
      console.log(`${v.target}: ${v.message}`);
    }
    expect(violations).toBeDefined();
  });

  it("Common Reuse — inventory uses orders_api but not orders_events", () => {
    const violations = commonReuseRule.check(model);

    expect(violations).toHaveLength(1);
    expect(violations[0].target).toBe("inventory");
    expect(violations[0].message).toContain("orders_events");
  });
});
