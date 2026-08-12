import { aclRule } from "../../src/rules/acl";
import { acyclicRule } from "../../src/rules/acyclic";
import { apiGatewayRule } from "../../src/rules/apiGateway";
import { cohesionRule } from "../../src/rules/cohesion";
import { commonReuseRule } from "../../src/rules/commonReuse";
import { crudRule } from "../../src/rules/crud";
import { dbPerServiceRule } from "../../src/rules/dbPerService";
import { ruleRegistry } from "../../src/rules/registry";
import { stableDependenciesRule } from "../../src/rules/stableDependencies";
import { makeModel } from "../helpers/makeModel";

// Registry is the canonical mapping the CLI iterates over for `check` и
// `--fix`. Rename / missing fix / wrong wiring silently breaks user config.

const RULES_WITH_FIX = new Set(["acl", "crud", "dbPerService"]);

const EXPECTED_BY_NAME = {
  acl: aclRule,
  acyclic: acyclicRule,
  apiGateway: apiGatewayRule,
  crud: crudRule,
  dbPerService: dbPerServiceRule,
  cohesion: cohesionRule,
  stableDependencies: stableDependenciesRule,
  commonReuse: commonReuseRule,
} as const;

describe("ruleRegistry", () => {
  it("contains exactly the eight published rules", () => {
    const actual = ruleRegistry.map((r) => r.name).toSorted();
    const expected = Object.keys(EXPECTED_BY_NAME).toSorted();
    expect(actual).toEqual(expected);
  });

  it("has unique names", () => {
    const names = ruleRegistry.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("exposes a `fix` only for rules that ship an auto-fix", () => {
    for (const rule of ruleRegistry) {
      const expectFix = RULES_WITH_FIX.has(rule.name);
      expect(typeof rule.fix === "function").toBe(expectFix);
    }
  });

  it("wires each entry to its underlying RuleDefinition by reference", () => {
    for (const rule of ruleRegistry) {
      expect(rule).toBe(
        EXPECTED_BY_NAME[rule.name as keyof typeof EXPECTED_BY_NAME],
      );
    }
  });

  it("every rule's check returns an array on an empty model", () => {
    // Smoke check: each registry entry can be invoked against a valid Model
    // shape without throwing. Per-rule semantics are covered in rule tests.
    const empty = makeModel({});
    for (const rule of ruleRegistry) {
      expect(rule.check(empty, {})).toEqual([]);
    }
  });
});
