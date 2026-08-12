import { fc, test } from "@fast-check/vitest";
import consola from "consola";

import { plantumlSyntax } from "../../src/formats/plantuml/syntax";
import { structurizrDslSyntax } from "../../src/formats/structurizr/syntax";
import { aclRule } from "../../src/rules";
import { applyEdits } from "../../src/rules/lib/applyEdits";
import { loadPumlString } from "../helpers/loadPumlString";
import type { ElementSpec } from "../helpers/makeModel";
import { makeModel } from "../helpers/makeModel";

const nameArb = fc
  .string({ minLength: 2, maxLength: 8 })
  .filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

const extSystem: ElementSpec = {
  name: "ext_system",
  label: "External System",
  kind: "System",
  external: true,
};

describe("aclRule.check", () => {
  it("returns no violations when acl-tagged container depends on external", () => {
    const model = makeModel({
      elements: [
        { name: "my_acl", tags: ["acl"], relations: [{ to: "ext_system" }] },
        extSystem,
      ],
    });
    expect(aclRule.check(model)).toHaveLength(0);
  });

  it("returns violation when non-acl container depends on external", () => {
    const model = makeModel({
      elements: [
        { name: "my_service", relations: [{ to: "ext_system" }] },
        extSystem,
      ],
    });
    const v = aclRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].target).toBe("my_service");
    expect(v[0].message).toContain("ext_system");
  });

  it("returns no violations when no external dependencies", () => {
    const model = makeModel({
      elements: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
    });
    expect(aclRule.check(model)).toHaveLength(0);
  });

  it("includes all external systems in violation message", () => {
    const model = makeModel({
      elements: [
        { name: "svc", relations: [{ to: "ext1" }, { to: "ext2" }] },
        { name: "ext1", kind: "System", external: true },
        { name: "ext2", kind: "System", external: true },
      ],
    });
    const v = aclRule.check(model);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("ext1");
    expect(v[0].message).toContain("ext2");
    expect(v[0].message).toMatch(/systems/);
  });

  it("respects custom tag option", () => {
    const model = makeModel({
      elements: [
        {
          name: "anti_corruption",
          tags: ["custom-acl"],
          relations: [{ to: "ext" }],
        },
        { name: "ext", kind: "System", external: true },
      ],
    });
    expect(aclRule.check(model, { tag: "custom-acl" })).toHaveLength(0);
  });

  test.prop([nameArb])(
    "property: container with 'acl' tag never fires violation",
    () => {
      const model = makeModel({
        elements: [
          { name: "svc", tags: ["acl"], relations: [{ to: "e" }] },
          { name: "e", kind: "System", external: true },
        ],
      });
      expect(aclRule.check(model)).toHaveLength(0);
    },
  );
});

// PUML fixtures load through the real chevrotain parser so rule.fix
// emits edits with position-accurate `SourceLocation`s. `applyEdits()`
// slices the same source on those offsets — what we assert on is the
// post-fix PUML, exactly what `aact check --fix` writes to disk.
const STDLIB =
  "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml";

const pumlFix = async (
  puml: string,
  violationElement: string,
  options?: { tag?: string },
) => {
  const { model, source } = await loadPumlString(puml);
  const fixes = aclRule.fix!({
    model,
    violations: [
      { target: violationElement, targetKind: "element" as const, message: "" },
    ],
    syntax: plantumlSyntax,
    options,
  });
  const edits = fixes.flatMap((f) => f.edits);
  const { content } = applyEdits(source, edits);
  return { fixes, edits, content };
};

describe("aclRule.fix (plantuml syntax)", () => {
  const singleExternalPuml = [
    "@startuml",
    STDLIB,
    'Container(my_service, "My Service")',
    'System_Ext(ext_system, "External System")',
    'Rel(my_service, ext_system, "")',
    "@enduml",
  ].join("\n");

  it("returns empty for empty violations", async () => {
    const { model } = await loadPumlString(singleExternalPuml);
    expect(
      aclRule.fix!({
        model,
        violations: [],
        syntax: plantumlSyntax,
        options: undefined,
      }),
    ).toEqual([]);
  });

  it("rewrites the source so `my_service` reaches `ext_system` only through `my_service_acl`", async () => {
    const { fixes, content } = await pumlFix(singleExternalPuml, "my_service");

    expect(fixes).toHaveLength(1);
    expect(fixes[0].ruleId).toBe("acl");
    expect(content).toContain("Container(my_service_acl,");
    expect(content).toContain('$tags="acl"');
    expect(content).toContain("Rel(my_service, my_service_acl");
    expect(content).toContain("Rel(my_service_acl, ext_system");
    expect(content).not.toContain('Rel(my_service, ext_system, "")');
  });

  it("uses the custom tag from options when rewriting", async () => {
    const { content } = await pumlFix(singleExternalPuml, "my_service", {
      tag: "gateway",
    });
    expect(content).toContain('$tags="gateway"');
  });

  it("redirects every external relation, not just the first one", async () => {
    const twoExternals = [
      "@startuml",
      STDLIB,
      'Container(my_service, "My Service")',
      'System_Ext(ext_system, "External System")',
      'System_Ext(ext_payments, "Payments")',
      'Rel(my_service, ext_system, "")',
      'Rel(my_service, ext_payments, "")',
      "@enduml",
    ].join("\n");

    const { content } = await pumlFix(twoExternals, "my_service");
    expect(content).toContain("Rel(my_service_acl, ext_system");
    expect(content).toContain("Rel(my_service_acl, ext_payments");
    // Only one rewire-relation from my_service to the ACL should land
    // (insert-after the service container), not one per external.
    const aclEntryEdges = content
      .split("\n")
      .filter((l) => l.includes("Rel(my_service, my_service_acl"));
    expect(aclEntryEdges).toHaveLength(1);
  });

  it("skips with warning when an ACL container with the canonical name already exists", async () => {
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});
    const collision = [
      "@startuml",
      STDLIB,
      'Container(my_service, "My Service")',
      'Container(my_service_acl, "Existing ACL")',
      'System_Ext(ext_system, "External System")',
      'Rel(my_service, ext_system, "")',
      "@enduml",
    ].join("\n");
    const { fixes } = await pumlFix(collision, "my_service");
    expect(fixes).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix acl");
    expect(msg).toContain("skipping my_service");
    expect(msg).toContain("my_service_acl");
  });

  it("targets the violation's element by name when multiple services exist", async () => {
    // Stryker mutated `c.name === violation.target` to `true` — that
    // mutation would wrap the wrong container. Pin: when `beta` is the
    // violation, only `beta`'s relations get rerouted.
    const twoServices = [
      "@startuml",
      STDLIB,
      'Container(alpha, "Alpha")',
      'Container(beta, "Beta")',
      'System_Ext(ext_system, "External System")',
      'Rel(alpha, ext_system, "")',
      'Rel(beta, ext_system, "")',
      "@enduml",
    ].join("\n");

    const { fixes, content } = await pumlFix(twoServices, "beta");
    expect(fixes).toHaveLength(1);
    expect(fixes[0].description).toContain("beta");
    expect(fixes[0].description).not.toContain("alpha");
    expect(content).toContain("Container(beta_acl,");
    expect(content).not.toContain("Container(alpha_acl,");
    expect(content).toContain("Rel(beta_acl, ext_system");
    // alpha's edge stays untouched
    expect(content).toContain('Rel(alpha, ext_system, "")');
  });

  it("silently skips a violation that names a non-existent element", async () => {
    const { model } = await loadPumlString(singleExternalPuml);
    const result = aclRule.fix!({
      model,
      violations: [
        { target: "ghost", targetKind: "element" as const, message: "" },
      ],
      syntax: plantumlSyntax,
      options: undefined,
    });
    expect(result).toHaveLength(0);
  });

  it("returns no fix when the violation's element has no external relations", async () => {
    const noExternal = [
      "@startuml",
      STDLIB,
      'Container(my_service, "My Service")',
      'ContainerDb(orders_db, "DB")',
      'Rel(my_service, orders_db, "")',
      "@enduml",
    ].join("\n");
    const { fixes } = await pumlFix(noExternal, "my_service");
    expect(fixes).toHaveLength(0);
  });

  it("uses camelCase suffix when the existing names are camelCase", async () => {
    const camel = [
      "@startuml",
      STDLIB,
      'Container(myService, "My Service")',
      'System_Ext(extPayments, "External Payments")',
      'Rel(myService, extPayments, "")',
      "@enduml",
    ].join("\n");
    const { content } = await pumlFix(camel, "myService");
    expect(content).toContain("Container(myServiceAcl,");
  });

  // kebab-case identifiers (`my-service`) are not accepted by C4-PUML
  // stdlib macros — the parser treats `-` as expression operator. The
  // naming-convention detector itself supports kebab (see namingUtils
  // tests + structurizr-side fixtures); we don't pin it here because
  // there's no PUML source that would actually round-trip such names.

  it("never throws, always returns FixResult[] for an arbitrary identifier", async () => {
    const puml = [
      "@startuml",
      STDLIB,
      'Container(svc, "S")',
      'System_Ext(ext, "E")',
      'Rel(svc, ext, "")',
      "@enduml",
    ].join("\n");
    const { model } = await loadPumlString(puml);
    const violations = aclRule.check(model);
    const result = aclRule.fix!({
      model,
      violations,
      syntax: plantumlSyntax,
      options: undefined,
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("inserts the ACL block at the position immediately after the offending Container line", async () => {
    // Anchor semantics: `insert-after element.sourceLocation` must
    // land between the original Container line and whatever comes
    // next. Pin: no whitespace surprises, the new declarations land
    // on their own lines right after `my_service`.
    const puml = [
      "@startuml",
      STDLIB,
      'Container(my_service, "My Service")',
      'System_Ext(ext_system, "External System")',
      'Rel(my_service, ext_system, "")',
      "@enduml",
    ].join("\n");
    const { content } = await pumlFix(puml, "my_service");
    const lines = content.split("\n");
    const idx = lines.findIndex((l) => l.startsWith("Container(my_service,"));
    expect(idx).toBeGreaterThan(-1);
    expect(lines[idx + 1]).toMatch(/^Container\(my_service_acl,/);
    expect(lines[idx + 2]).toMatch(/^Rel\(my_service, my_service_acl/);
  });

  it("is deterministic — same input twice produces identical edits", async () => {
    const { model } = await loadPumlString(singleExternalPuml);
    const violations = aclRule.check(model);
    const first = aclRule.fix!({
      model,
      violations,
      syntax: plantumlSyntax,
      options: undefined,
    });
    const second = aclRule.fix!({
      model,
      violations,
      syntax: plantumlSyntax,
      options: undefined,
    });
    expect(first).toEqual(second);
  });
});

describe("aclRule.fix (structurizr syntax)", () => {
  // Smaller surface — Structurizr DSL `fix` exists for users who set
  // `source.writePath` to their `workspace.dsl`. We verify that the
  // FormatSyntax helper produces DSL-shaped content (the actual position
  // splicing is identical to PUML — covered above).
  it("emits FormatSyntax-shaped content for structurizr DSL", () => {
    // Range-based fix path is covered end-to-end via PUML above; here
    // we just pin the structurizrDslSyntax shape, since rules pass
    // through this helper to build the `content` string regardless of
    // which loader populated the SourceLocation ranges.
    const decl = structurizrDslSyntax.containerDecl({
      name: "my_service_acl",
      label: "My Service ACL",
      kind: "Container",
      external: false,
      description: "",
      tags: ["acl"],
      relations: [],
    });
    expect(decl).toContain('my_service_acl = container "My Service ACL"');
    expect(decl).toContain('tags "acl"');

    const rel = structurizrDslSyntax.relationDecl(
      "my_service_acl",
      "ext_system",
    );
    expect(rel).toBe("my_service_acl -> ext_system");
  });
});
