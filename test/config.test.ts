import * as v from "valibot";

import type { AactConfigInput } from "../src/config";
import { AactConfigSchema, defineConfig } from "../src/config";
import { defineRule } from "../src/rules";

describe("defineConfig", () => {
  it("returns the input verbatim — pure identity helper", () => {
    const input: AactConfigInput<readonly never[]> = {
      source: { type: "plantuml", path: "./architecture.puml" },
    };
    expect(defineConfig(input)).toBe(input);
  });

  it("preserves customRules tuple literal types for downstream inference", () => {
    const rule = defineRule({
      name: "myRule",
      description: "test",
      check: () => [],
    });
    const cfg = defineConfig({
      source: "./architecture.puml",
      customRules: [rule],
    });
    expect(cfg.customRules?.[0].name).toBe("myRule");
  });
});

// Schema-level acceptance / rejection tests. Each option-bearing entry
// is a `v.strictObject(...)` — replacing its option spec with `{}` (a
// common mutation) makes the schema reject the very keys the user is
// supposed to pass. Sweeping each known-good option through `v.parse`
// pins the spec; the negative cases pin the rejection contract.
//
// Survived Stryker mutations on src/config.ts targeted these exact
// branches: ObjectLiteral on rule entries / nested strictObjects,
// ArrayDeclaration on `picklist(["text","json","sarif"])`, and
// StringLiteral on the picklist members themselves.

const parses = (raw: unknown) =>
  v.safeParse(AactConfigSchema, raw, { abortEarly: false });

const baseSource = { source: "./architecture.puml" };

describe("AactConfigSchema — rule options accepted/rejected", () => {
  it("acl: accepts { tag: <string> } and rejects { tag: <non-string> }", () => {
    expect(
      parses({ ...baseSource, rules: { acl: { tag: "domain" } } }).success,
    ).toBe(true);
    expect(parses({ ...baseSource, rules: { acl: { tag: 42 } } }).success).toBe(
      false,
    );
    expect(
      parses({ ...baseSource, rules: { acl: { unknownKey: 1 } } }).success,
    ).toBe(false);
  });

  it("acl: accepts namePatterns (string[]) and rejects scalar", () => {
    expect(
      parses({ ...baseSource, rules: { acl: { namePatterns: ["*_acl"] } } })
        .success,
    ).toBe(true);
    expect(
      parses({ ...baseSource, rules: { acl: { namePatterns: "*_acl" } } })
        .success,
    ).toBe(false);
  });

  it("apiGateway: accepts aclTag (string) and gatewayPattern (RegExp)", () => {
    expect(
      parses({
        ...baseSource,
        rules: { apiGateway: { aclTag: "gw", gatewayPattern: /api-.+/ } },
      }).success,
    ).toBe(true);
    expect(
      parses({ ...baseSource, rules: { apiGateway: { aclTag: 7 } } }).success,
    ).toBe(false);
    expect(
      parses({
        ...baseSource,
        rules: { apiGateway: { gatewayPattern: "not-a-regex" } },
      }).success,
    ).toBe(false);
  });

  it("apiGateway: accepts aclNamePatterns (string[]) and rejects scalar", () => {
    expect(
      parses({
        ...baseSource,
        rules: { apiGateway: { aclNamePatterns: ["*_gateway"] } },
      }).success,
    ).toBe(true);
    expect(
      parses({
        ...baseSource,
        rules: { apiGateway: { aclNamePatterns: "*_gateway" } },
      }).success,
    ).toBe(false);
  });

  it("crud: accepts repoTags (string[]) and rejects scalar / wrong-element types", () => {
    expect(
      parses({
        ...baseSource,
        rules: { crud: { repoTags: ["repo", "dao"] } },
      }).success,
    ).toBe(true);
    expect(
      parses({ ...baseSource, rules: { crud: { repoTags: "repo" } } }).success,
    ).toBe(false);
    expect(
      parses({ ...baseSource, rules: { crud: { repoTags: [1, 2] } } }).success,
    ).toBe(false);
  });

  it("crud: accepts repoNamePatterns (string[]) and rejects scalar", () => {
    expect(
      parses({
        ...baseSource,
        rules: { crud: { repoNamePatterns: ["*_store"] } },
      }).success,
    ).toBe(true);
    expect(
      parses({
        ...baseSource,
        rules: { crud: { repoNamePatterns: "*_store" } },
      }).success,
    ).toBe(false);
  });

  it("dbPerService: accepts ownerTags (string[]) and rejects scalar", () => {
    expect(
      parses({
        ...baseSource,
        rules: { dbPerService: { ownerTags: ["owner"] } },
      }).success,
    ).toBe(true);
    expect(
      parses({
        ...baseSource,
        rules: { dbPerService: { ownerTags: "owner" } },
      }).success,
    ).toBe(false);
  });

  it("dbPerService: accepts ownerNamePatterns (string[]) and rejects scalar", () => {
    expect(
      parses({
        ...baseSource,
        rules: { dbPerService: { ownerNamePatterns: ["*_repo"] } },
      }).success,
    ).toBe(true);
    expect(
      parses({
        ...baseSource,
        rules: { dbPerService: { ownerNamePatterns: "*_repo" } },
      }).success,
    ).toBe(false);
  });

  it("option-less rules accept boolean and `{}` but reject unknown keys", () => {
    for (const name of [
      "acyclic",
      "cohesion",
      "stableDependencies",
      "commonReuse",
    ] as const) {
      expect(parses({ ...baseSource, rules: { [name]: true } }).success).toBe(
        true,
      );
      expect(parses({ ...baseSource, rules: { [name]: {} } }).success).toBe(
        true,
      );
      expect(
        parses({ ...baseSource, rules: { [name]: { unknown: 1 } } }).success,
      ).toBe(false);
    }
  });
});

describe("AactConfigSchema — analyze / generate / output", () => {
  it("analyze: accepts every documented sub-field with its declared type", () => {
    expect(
      parses({
        ...baseSource,
        analyze: {
          syncTechnologies: ["rest", "http"],
          asyncTechnologies: ["kafka"],
          exclude: { tags: ["legacy"], namePatterns: ["*_repo"] },
          topN: 10,
        },
      }).success,
    ).toBe(true);
  });

  it("analyze: rejects scalars where arrays are expected", () => {
    expect(
      parses({
        ...baseSource,
        analyze: { syncTechnologies: "rest" },
      }).success,
    ).toBe(false);
    expect(
      parses({
        ...baseSource,
        analyze: { asyncTechnologies: "kafka" },
      }).success,
    ).toBe(false);
  });

  it("analyze.exclude: nested arrays validate, scalars rejected", () => {
    expect(
      parses({
        ...baseSource,
        analyze: { exclude: { tags: "legacy" } },
      }).success,
    ).toBe(false);
    expect(
      parses({
        ...baseSource,
        analyze: { exclude: { namePatterns: 123 } },
      }).success,
    ).toBe(false);
  });

  it("analyze.topN: number accepted, string rejected", () => {
    expect(parses({ ...baseSource, analyze: { topN: 5 } }).success).toBe(true);
    expect(parses({ ...baseSource, analyze: { topN: "5" } }).success).toBe(
      false,
    );
  });

  it("generate.kubernetes.path + generate.boundaryLabel accept strings", () => {
    expect(
      parses({
        ...baseSource,
        generate: { kubernetes: { path: "./k8s" }, boundaryLabel: "team" },
      }).success,
    ).toBe(true);
    expect(
      parses({
        ...baseSource,
        generate: { kubernetes: { path: 5 } },
      }).success,
    ).toBe(false);
    expect(
      parses({
        ...baseSource,
        generate: { boundaryLabel: 5 },
      }).success,
    ).toBe(false);
  });

  // Picklist mutation hot zone — both the `["text","json","sarif"]`
  // array literal and each of the three string members can be
  // mutated. Each must be accepted; anything outside the set must
  // be rejected.
  it.each(["text", "json", "sarif"])("output.mode: accepts %s", (mode) => {
    expect(parses({ ...baseSource, output: { mode } }).success).toBe(true);
  });

  it("output.mode: rejects anything outside the picklist", () => {
    for (const bad of ["csv", "yaml", "", "Text"]) {
      expect(parses({ ...baseSource, output: { mode: bad } }).success).toBe(
        false,
      );
    }
  });
});
