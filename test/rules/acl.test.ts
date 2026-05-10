import { Container } from "../../src/model";
import { checkAcl } from "../../src/rules";

describe("checkAcl", () => {
  const externalSystem: Container = {
    name: "ext_system",
    label: "External System",
    type: "System_Ext",
    description: "",
    relations: [],
  };

  it("returns no violations when acl-tagged container depends on external", () => {
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [{ to: externalSystem }],
      },
      externalSystem,
    ];

    expect(checkAcl(containers)).toHaveLength(0);
  });

  it("returns violation when non-acl container depends on external", () => {
    const containers: Container[] = [
      {
        name: "my_service",
        label: "My Service",
        type: "Container",
        description: "",
        relations: [{ to: externalSystem }],
      },
      externalSystem,
    ];

    const violations = checkAcl(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("my_service");
  });

  it("returns no violations when no external dependencies", () => {
    const db: Container = {
      name: "my_db",
      label: "My DB",
      type: "ContainerDb",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "my_service",
        label: "My Service",
        type: "Container",
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    expect(checkAcl(containers)).toHaveLength(0);
  });

  it("returns no violations for empty list", () => {
    expect(checkAcl([])).toHaveLength(0);
  });

  it("violation message lists all external dependencies", () => {
    const ext2: Container = {
      name: "ext_payments",
      label: "External Payments",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const svc: Container = {
      name: "my_service",
      label: "My Service",
      type: "Container",
      description: "",
      relations: [{ to: externalSystem }, { to: ext2 }],
    };

    const violations = checkAcl([svc, externalSystem, ext2]);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("ext_system");
    expect(violations[0].message).toContain("ext_payments");
  });

  it("supports custom tag and externalType options", () => {
    const customExt: Container = {
      name: "legacy",
      label: "Legacy",
      type: "Legacy_System",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "adapter",
        label: "Adapter",
        type: "Container",
        tags: ["gateway"],
        description: "",
        relations: [{ to: customExt }],
      },
      customExt,
    ];

    expect(
      checkAcl(containers, { tag: "gateway", externalType: "Legacy_System" }),
    ).toHaveLength(0);

    expect(
      checkAcl(containers, { externalType: "Legacy_System" }),
    ).toHaveLength(1);
  });
});
