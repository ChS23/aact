import { Container } from "../../src/model";
import { checkApiGateway } from "../../src/rules";

describe("checkApiGateway", () => {
  const externalSystem: Container = {
    name: "ext_system",
    label: "External System",
    type: "System_Ext",
    description: "",
    relations: [],
  };

  it("returns no violations when technology matches gateway pattern", () => {
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [
          {
            to: externalSystem,
            technology: "https://gateway.int.com:443/api/v1",
          },
        ],
      },
      externalSystem,
    ];

    expect(checkApiGateway(containers)).toHaveLength(0);
  });

  it("returns violation when technology does not match gateway pattern", () => {
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [
          { to: externalSystem, technology: "https://direct.api.com/v1" },
        ],
      },
      externalSystem,
    ];

    const violations = checkApiGateway(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].container).toBe("my_acl");
    expect(violations[0].message).toContain("ext_system");
  });

  it("returns no violations without external relations", () => {
    const db: Container = {
      name: "my_db",
      label: "My DB",
      type: "ContainerDb",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [{ to: db }],
      },
      db,
    ];

    expect(checkApiGateway(containers)).toHaveLength(0);
  });

  it("supports custom options", () => {
    const legacy: Container = {
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
        tags: ["adapter"],
        description: "",
        relations: [{ to: legacy, technology: "https://proxy.internal/api" }],
      },
      legacy,
    ];

    expect(
      checkApiGateway(containers, {
        aclTag: "adapter",
        externalType: "Legacy_System",
        gatewayPattern: /proxy/i,
      }),
    ).toHaveLength(0);

    expect(
      checkApiGateway(containers, {
        aclTag: "adapter",
        externalType: "Legacy_System",
        gatewayPattern: /gateway/i,
      }),
    ).toHaveLength(1);
  });

  it("checks each external relation independently", () => {
    const ext1: Container = {
      name: "ext1",
      label: "Ext 1",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const ext2: Container = {
      name: "ext2",
      label: "Ext 2",
      type: "System_Ext",
      description: "",
      relations: [],
    };
    const containers: Container[] = [
      {
        name: "my_acl",
        label: "My ACL",
        type: "Container",
        tags: ["acl"],
        description: "",
        relations: [
          { to: ext1, technology: "https://gateway.int.com/v1" },
          { to: ext2, technology: "https://direct.api.com/v1" },
        ],
      },
      ext1,
      ext2,
    ];

    const violations = checkApiGateway(containers);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("ext2");
  });
});
