import { analyzeArchitecture } from "../src/analyzer";
import type { ArchitectureModel, Container } from "../src/model";

describe("analyzeArchitecture", () => {
  const db: Container = {
    name: "orders_db",
    label: "Orders DB",
    type: "ContainerDb",
    description: "",
    relations: [],
  };

  const extSystem: Container = {
    name: "ext_payment",
    label: "External Payment",
    type: "System_Ext",
    description: "",
    relations: [],
  };

  const svcB: Container = {
    name: "svc_b",
    label: "Service B",
    type: "Container",
    description: "",
    relations: [{ to: db }],
  };

  const svcA: Container = {
    name: "svc_a",
    label: "Service A",
    type: "Container",
    description: "",
    relations: [
      { to: svcB, technology: "http" },
      { to: extSystem, technology: "https://api.ext.com" },
      { to: svcB, tags: ["async"] },
    ],
  };

  const model: ArchitectureModel = {
    boundaries: [
      {
        name: "project",
        label: "Project",
        containers: [svcA, svcB, db, extSystem],
        boundaries: [],
      },
    ],
    allContainers: [svcA, svcB, db, extSystem],
  };

  it("counts elements", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.elementsCount).toBe(4);
  });

  it("counts sync API calls", () => {
    const { report } = analyzeArchitecture(model);
    // svcA→svcB (http) and svcA→extSystem (System_Ext, non-async)
    expect(report.syncApiCalls).toBe(2);
  });

  it("counts async API calls", () => {
    const { report } = analyzeArchitecture(model);
    // svcA→svcB (async tag)
    expect(report.asyncApiCalls).toBe(1);
  });

  it("counts databases", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.databases.count).toBe(1);
    expect(report.databases.consumes).toBe(1);
  });

  it("computes boundary metrics", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.boundaries).toHaveLength(1);
    const b = report.boundaries[0];
    expect(b.name).toBe("project");
    expect(b.cohesion).toBeGreaterThan(0);
  });

  describe("nested boundaries", () => {
    // parent → [domainA (svc1→svc2), domainB (svc3)]
    // svc1→svc2: cohesion for domainA, cohesion for parent
    // svc1→svc3: coupling for domainA (sibling), cohesion for parent
    const svc2: Container = {
      name: "svc2",
      label: "Svc2",
      type: "Container",
      description: "",
      relations: [],
    };
    const svc3: Container = {
      name: "svc3",
      label: "Svc3",
      type: "Container",
      description: "",
      relations: [],
    };
    const svc1: Container = {
      name: "svc1",
      label: "Svc1",
      type: "Container",
      description: "",
      relations: [{ to: svc2 }, { to: svc3 }],
    };

    const domainA = {
      name: "domainA",
      label: "Domain A",
      containers: [svc1, svc2],
      boundaries: [],
    };
    const domainB = {
      name: "domainB",
      label: "Domain B",
      containers: [svc3],
      boundaries: [],
    };
    const parent = {
      name: "parent",
      label: "Parent",
      containers: [],
      boundaries: [domainA, domainB],
    };

    const nestedModel: ArchitectureModel = {
      boundaries: [parent, domainA, domainB],
      allContainers: [svc1, svc2, svc3],
    };

    it("counts cohesion within sub-boundary", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      // svc1→svc2 is internal to domainA
      expect(a.cohesion).toBe(1);
    });

    it("counts coupling to sibling sub-boundary", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      // svc1→svc3 crosses to sibling domainB
      expect(a.coupling).toBe(1);
      expect(a.couplingRelations).toEqual([{ from: "svc1", to: "svc3" }]);
    });

    it("counts parent cohesion for cross-sibling relations", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const p = report.boundaries.find((b) => b.name === "parent")!;
      // svc1→svc3 crosses sibling boundary → parent.cohesion++
      // svc1→svc2 is internal to domainA → only domainA.cohesion, not parent's
      expect(p.cohesion).toBe(1);
      expect(p.coupling).toBe(0);
    });

    it("attributes out-of-parent relation to parent.coupling, not child", () => {
      // svc1 also connects to an external system outside any boundary
      const ext: Container = {
        name: "ext",
        label: "Ext",
        type: "System_Ext",
        description: "",
        relations: [],
      };
      const svc1ext: Container = {
        name: "svc1",
        label: "Svc1",
        type: "Container",
        description: "",
        relations: [{ to: ext }],
      };
      const domainAext = {
        name: "domainA",
        label: "Domain A",
        containers: [svc1ext],
        boundaries: [],
      };
      const parentExt = {
        name: "parent",
        label: "Parent",
        containers: [],
        boundaries: [domainAext],
      };
      const m: ArchitectureModel = {
        boundaries: [parentExt, domainAext],
        allContainers: [svc1ext, ext],
      };
      const { report } = analyzeArchitecture(m);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      const p = report.boundaries.find((b) => b.name === "parent")!;
      // svc1→ext goes outside parent scope → parent.coupling, not domainA.coupling
      expect(a.coupling).toBe(0);
      expect(p.coupling).toBe(1);
    });
  });
});
