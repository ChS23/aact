import { plantumlSyntax } from "../../src/loaders/plantuml/syntax";
import type { ArchitectureModel, Container } from "../../src/model";
import { applyEdits } from "../../src/rules/fix";
import { fixAcl } from "../../src/rules/fixAcl";

const extSystem: Container = {
  name: "ext_system",
  label: "External System",
  type: "System_Ext",
  description: "",
  relations: [],
};

const makeContainer = (
  name: string,
  label: string,
  relations: Container["relations"] = [],
): Container => ({
  name,
  label,
  type: "Container",
  description: "",
  relations,
});

const makeModel = (containers: Container[]): ArchitectureModel => ({
  boundaries: [{ name: "root", label: "Root", containers, boundaries: [] }],
  allContainers: containers,
});

describe("fixAcl", () => {
  it("returns empty for empty violations", () => {
    const model = makeModel([]);
    expect(fixAcl(model, [], plantumlSyntax)).toEqual([]);
  });

  it("generates FixResult with ACL container", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [
        {
          container: "my_service",
          message: "depends on external systems: ext_system",
        },
      ],
      plantumlSyntax,
    );
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe("acl");
  });

  it("adds Container(acl) after Container(svc)", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("my_service_acl"),
    );
    expect(addEdit).toBeDefined();
    expect(addEdit!.search).toContain("(my_service,");
    expect(addEdit!.content).toContain('$tags="acl"');
  });

  it("adds single Rel(svc, acl) after the ACL container", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const addRelEdit = results[0].edits.find(
      (e) =>
        e.type === "add" &&
        e.content?.includes("Rel(my_service, my_service_acl"),
    );
    expect(addRelEdit).toBeDefined();
    expect(addRelEdit!.search).toContain("(my_service_acl,");
  });

  it("replaces Rel(svc, ext) with Rel(acl, ext)", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const replaceEdit = results[0].edits.find((e) => e.type === "replace");
    expect(replaceEdit).toBeDefined();
    expect(replaceEdit!.search).toContain("Rel(my_service, ext_system");
    expect(replaceEdit!.content).toContain("Rel(my_service_acl, ext_system");
  });

  it("uses custom tag from options", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
      { tag: "gateway" },
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain('$tags="gateway"');
  });

  it("generates one replace per external dependency, one add for Rel(svc,acl)", () => {
    const ext2: Container = {
      name: "ext_payments",
      label: "External Payments",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc = makeContainer("my_service", "My Service", [
      { to: extSystem },
      { to: ext2 },
    ]);
    const model = makeModel([svc, extSystem, ext2]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const replaceEdits = results[0].edits.filter((e) => e.type === "replace");
    const addRelEdits = results[0].edits.filter(
      (e) => e.type === "add" && e.content?.includes("Rel("),
    );
    expect(replaceEdits).toHaveLength(2);
    expect(addRelEdits).toHaveLength(1); // single Rel(svc, acl), no duplicates
  });

  it("applies edits correctly to puml fragment", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const puml = [
      'Container(my_service, "My Service")',
      'System_Ext(ext_system, "External System")',
      'Rel(my_service, ext_system, "")',
    ].join("\n");

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    const patched = applyEdits(puml, results[0].edits);
    expect(patched).toContain("Container(my_service_acl,");
    expect(patched).toContain("Rel(my_service, my_service_acl");
    expect(patched).toContain("Rel(my_service_acl, ext_system");
    expect(patched).not.toContain("Rel(my_service, ext_system");
  });

  it("skips with warning when acl container already exists", () => {
    const aclContainer = makeContainer("my_service_acl", "My Service ACL");
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, aclContainer, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    expect(results).toHaveLength(0);
  });

  it("description contains service name", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      plantumlSyntax,
    );
    expect(results[0].description).toContain("my_service");
  });

  it("auto-detects camelCase and names ACL with Acl suffix", () => {
    const ext: Container = {
      name: "extPayments",
      label: "External Payments",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc = makeContainer("myService", "My Service", [{ to: ext }]);
    const model = makeModel([svc, ext]);

    const results = fixAcl(
      model,
      [{ container: "myService", message: "" }],
      plantumlSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("myServiceAcl");
  });

  it("auto-detects kebab-case and names ACL with -acl suffix", () => {
    const ext: Container = {
      name: "ext-payments",
      label: "External Payments",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc = makeContainer("my-service", "My Service", [{ to: ext }]);
    const model = makeModel([svc, ext]);

    const results = fixAcl(
      model,
      [{ container: "my-service", message: "" }],
      plantumlSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("my-service-acl");
  });

  it("ACL name follows {svc_name}_acl convention", () => {
    const svc = makeContainer("order_processor", "Order Processor", [
      { to: extSystem },
    ]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "order_processor", message: "" }],
      plantumlSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("Container("),
    );
    expect(addEdit!.content).toContain("order_processor_acl");
  });
});
