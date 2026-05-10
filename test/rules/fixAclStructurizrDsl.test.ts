import { structurizrDslSyntax } from "../../src/loaders/structurizr";
import type { ArchitectureModel, Container } from "../../src/model";
import { applyEdits } from "../../src/rules/fix";
import { fixAcl } from "../../src/rules/fixAcl";
import { fixDbPerService } from "../../src/rules/fixDbPerService";

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

describe("fixAcl with structurizrDslSyntax", () => {
  it("adds container declaration with tags block", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      structurizrDslSyntax,
    );
    const addEdit = results[0].edits.find(
      (e) => e.type === "add" && e.content?.includes("my_service_acl"),
    );
    expect(addEdit!.content).toContain(
      'my_service_acl = container "My Service ACL"',
    );
    expect(addEdit!.content).toContain('tags "acl"');
  });

  it("replaces Rel(svc, ext) with Rel(acl, ext)", () => {
    const svc = makeContainer("my_service", "My Service", [{ to: extSystem }]);
    const model = makeModel([svc, extSystem]);

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      structurizrDslSyntax,
    );
    const replaceEdit = results[0].edits.find((e) => e.type === "replace");
    expect(replaceEdit!.search).toBe("my_service -> ext_system");
    expect(replaceEdit!.content).toContain("my_service_acl -> ext_system");
  });

  it("applies edits correctly to dsl fragment", () => {
    const svc = makeContainer("my_service", "My Service", [
      { to: extSystem, technology: "https://gateway.int.com:443/v1" },
    ]);
    const model = makeModel([svc, extSystem]);

    const dsl = [
      'my_service = container "My Service"',
      'ext_system = softwareSystem "External System"',
      'my_service -> ext_system "https://gateway.int.com:443/v1"',
    ].join("\n");

    const results = fixAcl(
      model,
      [{ container: "my_service", message: "" }],
      structurizrDslSyntax,
    );
    const patched = applyEdits(dsl, results[0].edits);

    expect(patched).toContain("my_service_acl = container");
    expect(patched).toContain("my_service -> my_service_acl");
    expect(patched).toContain("my_service_acl -> ext_system");
    expect(patched).not.toContain("my_service -> ext_system");
  });
});

describe("fixDbPerService with structurizrDslSyntax", () => {
  it("replaces relation pattern correctly", () => {
    const db: Container = {
      name: "orders_db",
      label: "Orders DB",
      type: "ContainerDb",
      description: "",
      relations: [],
    };
    const repo = makeContainer("orders_repo", "Orders Repo", [
      { to: db, technology: "PostgreSQL" },
    ]);
    const other = makeContainer("other_service", "Other Service", [{ to: db }]);
    const model = makeModel([repo, other, db]);

    const dsl = [
      'orders_repo = container "Orders Repo"',
      'other_service = container "Other Service"',
      'orders_db = container "Orders DB" "Storage" "PostgreSQL"',
      'orders_repo -> orders_db "PostgreSQL"',
      'other_service -> orders_db ""',
    ].join("\n");

    const results = fixDbPerService(
      model,
      [{ container: "orders_db", message: "" }],
      structurizrDslSyntax,
    );
    const patched = applyEdits(dsl, results[0].edits);

    expect(patched).toContain("other_service -> orders_repo");
    expect(patched).not.toContain("other_service -> orders_db");
  });
});
