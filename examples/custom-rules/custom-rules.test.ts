import { load } from "../../src/formats/plantuml/load";
import type { Model } from "../../src/model";
import { bcIsolationRule } from "./rules/bcIsolation";
import { requireOwnerTagRule } from "./rules/requireOwnerTag";

describe("custom-rules example", () => {
  let model: Model;

  beforeAll(async () => {
    const result = await load("examples/custom-rules/architecture.puml");
    model = result.model;
  });

  describe("bcIsolation", () => {
    it("flags direct cross-BC call that bypasses the public API", () => {
      const violations = bcIsolationRule.check(model);
      expect(violations).toHaveLength(1);
      expect(violations[0].target).toBe("orders_svc");
      expect(violations[0].message).toContain("orders");
      expect(violations[0].message).toContain("inventory");
      expect(violations[0].message).toContain("inventory_svc");
    });

    it("ignores cross-BC calls that go through a *_api container", () => {
      const violations = bcIsolationRule.check(model);
      expect(
        violations.every((v) => !v.message.includes("inventory_api")),
      ).toBe(true);
    });

    it("ignores cross-BC calls via a broker-tagged container", () => {
      const violations = bcIsolationRule.check(model);
      expect(violations.every((v) => v.target !== "inventory_svc")).toBe(true);
    });

    it("respects the apiSuffix option", () => {
      // With a different suffix, inventory_api stops counting as a BC entry
      // and orders_svc → inventory_api becomes a violation too.
      const violations = bcIsolationRule.check(model, {
        apiSuffix: "_gateway",
      });
      expect(violations.length).toBeGreaterThan(1);
    });
  });

  describe("requireOwnerTag", () => {
    it("flags containers without an owner:* tag", () => {
      const violations = requireOwnerTagRule.check(model);
      expect(violations).toHaveLength(1);
      expect(violations[0].target).toBe("inventory_svc");
      expect(violations[0].message).toContain("owner:");
    });

    it("ignores containers that already carry an owner tag", () => {
      const violations = requireOwnerTagRule.check(model);
      const flagged = violations.map((v) => v.target);
      expect(flagged).not.toContain("orders_svc");
      expect(flagged).not.toContain("orders_db");
      expect(flagged).not.toContain("inventory_api");
    });

    it("respects the prefix option", () => {
      // With `team:` prefix, every operational container is missing the tag.
      const violations = requireOwnerTagRule.check(model, { prefix: "team:" });
      expect(violations.length).toBeGreaterThan(1);
    });
  });

  it("both custom rules return well-formed Violation objects", () => {
    const all = [
      ...bcIsolationRule.check(model),
      ...requireOwnerTagRule.check(model),
    ];
    for (const v of all) {
      expect(typeof v.target).toBe("string");
      expect(typeof v.message).toBe("string");
    }
  });
});
