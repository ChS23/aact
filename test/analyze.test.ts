import { analyzeArchitecture } from "../src/analyze";
import { makeModel } from "./helpers/makeModel";

describe("analyzeArchitecture", () => {
  const model = makeModel({
    elements: [
      { name: "orders_db", label: "Orders DB", kind: "ContainerDb" },
      {
        name: "ext_payment",
        label: "External Payment",
        kind: "System",
        external: true,
      },
      {
        name: "svc_b",
        label: "Service B",
        relations: [{ to: "orders_db" }],
      },
      {
        name: "svc_a",
        label: "Service A",
        relations: [
          { to: "svc_b", technology: "http" },
          { to: "ext_payment", technology: "https" },
          { to: "svc_b", tags: ["async"] },
        ],
      },
    ],
    boundaries: [
      {
        name: "project",
        label: "Project",
        elementNames: ["svc_a", "svc_b", "orders_db", "ext_payment"],
      },
    ],
  });

  it("counts elements and breaks them down by kind", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.elementsCount).toBe(4);
    expect(report.elementsByKind).toEqual({
      Container: 2,
      ContainerDb: 1,
      System: 1,
    });
  });

  describe("relation style classification", () => {
    it("treats the `async` tag as the primary signal", () => {
      const { report } = analyzeArchitecture(model);
      // svc_a→svc_b (async tag)
      expect(report.relationsByStyle.async).toBe(1);
    });

    it("counts relations without a sync/async tag and without a configured technology list as unspecified", () => {
      const { report } = analyzeArchitecture(model);
      // svc_a→svc_b (http) and svc_a→ext_payment (https) — no opt-in
      // technology list, so they land in unspecified. svc_b→orders_db
      // has no technology at all → also unspecified.
      expect(report.relationsByStyle.unspecified).toBe(3);
      expect(report.relationsByStyle.sync).toBe(0);
    });

    it("uses syncTechnologies as a case-insensitive substring fallback", () => {
      const { report } = analyzeArchitecture(model, {
        syncTechnologies: ["http"],
      });
      // svc_a→svc_b (http, matches), svc_a→ext_payment (https, matches "http")
      // svc_a→svc_b with async tag still wins as async
      // svc_b→orders_db has no technology → still unspecified
      expect(report.relationsByStyle.sync).toBe(2);
      expect(report.relationsByStyle.async).toBe(1);
      expect(report.relationsByStyle.unspecified).toBe(1);
    });

    it("uses asyncTechnologies as a case-insensitive substring fallback", () => {
      const m = makeModel({
        elements: [
          {
            name: "svc",
            relations: [{ to: "broker", technology: "Apache Kafka" }],
          },
          { name: "broker" },
        ],
      });
      const { report } = analyzeArchitecture(m, {
        asyncTechnologies: ["kafka"],
      });
      expect(report.relationsByStyle.async).toBe(1);
    });

    it("classifies explicit `sync` tag as sync even with mismatched technology", () => {
      const m = makeModel({
        elements: [
          {
            name: "svc",
            relations: [{ to: "other", technology: "kafka", tags: ["sync"] }],
          },
          { name: "other" },
        ],
      });
      const { report } = analyzeArchitecture(m, {
        asyncTechnologies: ["kafka"],
      });
      expect(report.relationsByStyle.sync).toBe(1);
      expect(report.relationsByStyle.async).toBe(0);
    });
  });

  it("counts databases including ComponentDb", () => {
    const { report } = analyzeArchitecture(model);
    expect(report.databases.count).toBe(1);
    expect(report.databases.consumes).toBe(1);

    const m = makeModel({
      elements: [
        { name: "comp_db", kind: "ComponentDb" },
        { name: "consumer", relations: [{ to: "comp_db" }] },
      ],
    });
    const r2 = analyzeArchitecture(m).report;
    expect(r2.databases.count).toBe(1);
    expect(r2.databases.consumes).toBe(1);
  });

  describe("boundary metrics", () => {
    it("computes cohesion, coupling, ratio and sync/async coupling breakdown", () => {
      const { report } = analyzeArchitecture(model, {
        syncTechnologies: ["http"],
      });
      const b = report.boundaries[0];
      expect(b.name).toBe("project");
      expect(b.cohesion).toBeGreaterThan(0);
      expect(b.coupling).toBe(0); // everything inside one boundary
      expect(b.ratio).toBe(1);
    });

    it("breaks coupling down into sync / async / unspecified per boundary", () => {
      const m = makeModel({
        elements: [
          {
            name: "a",
            relations: [
              { to: "b", tags: ["async"] },
              { to: "c", technology: "http" },
              { to: "d" },
            ],
          },
          { name: "b" },
          { name: "c" },
          { name: "d" },
        ],
        boundaries: [
          { name: "left", elementNames: ["a"] },
          { name: "right", elementNames: ["b", "c", "d"] },
        ],
      });
      const { report } = analyzeArchitecture(m, {
        syncTechnologies: ["http"],
      });
      const left = report.boundaries.find((b) => b.name === "left")!;
      expect(left.coupling).toBe(3);
      expect(left.asyncCoupling).toBe(1);
      expect(left.syncCoupling).toBe(1);
      expect(left.unspecifiedCoupling).toBe(1);
    });

    it("ratio is null when both cohesion and coupling are zero", () => {
      const m = makeModel({
        elements: [{ name: "lonely" }],
        boundaries: [{ name: "empty", elementNames: ["lonely"] }],
      });
      const { report } = analyzeArchitecture(m);
      const b = report.boundaries[0];
      expect(b.cohesion).toBe(0);
      expect(b.coupling).toBe(0);
      expect(b.ratio).toBeNull();
    });
  });

  describe("nested boundaries", () => {
    const nestedModel = makeModel({
      elements: [
        { name: "svc1", relations: [{ to: "svc2" }, { to: "svc3" }] },
        { name: "svc2" },
        { name: "svc3" },
      ],
      boundaries: [
        {
          name: "parent",
          label: "Parent",
          boundaryNames: ["domainA", "domainB"],
        },
        { name: "domainA", label: "Domain A", elementNames: ["svc1", "svc2"] },
        { name: "domainB", label: "Domain B", elementNames: ["svc3"] },
      ],
      rootBoundaryNames: ["parent"],
    });

    it("counts cohesion within sub-boundary", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      expect(a.cohesion).toBe(1);
    });

    it("counts coupling to sibling sub-boundary", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      expect(a.coupling).toBe(1);
      expect(a.couplingRelations).toEqual([{ from: "svc1", to: "svc3" }]);
    });

    it("counts parent cohesion for cross-sibling relations", () => {
      const { report } = analyzeArchitecture(nestedModel);
      const p = report.boundaries.find((b) => b.name === "parent")!;
      expect(p.cohesion).toBe(1);
      expect(p.coupling).toBe(0);
    });

    it("attributes out-of-parent relation to parent.coupling, not child", () => {
      const m = makeModel({
        elements: [
          { name: "svc1", relations: [{ to: "ext" }] },
          { name: "ext", kind: "System", external: true },
        ],
        boundaries: [
          { name: "parent", label: "Parent", boundaryNames: ["domainA"] },
          { name: "domainA", label: "Domain A", elementNames: ["svc1"] },
        ],
        rootBoundaryNames: ["parent"],
      });
      const { report } = analyzeArchitecture(m);
      const a = report.boundaries.find((b) => b.name === "domainA")!;
      const p = report.boundaries.find((b) => b.name === "parent")!;
      expect(a.coupling).toBe(0);
      expect(p.coupling).toBe(1);
    });
  });

  describe("fan-in / fan-out hotspots", () => {
    const hotspotModel = makeModel({
      elements: [
        { name: "hub", relations: [{ to: "a" }, { to: "b" }, { to: "c" }] },
        { name: "a", relations: [{ to: "sink" }] },
        { name: "b", relations: [{ to: "sink" }] },
        { name: "c", relations: [{ to: "sink" }] },
        { name: "sink" },
      ],
    });

    it("ranks elements by incoming edges (afferent coupling)", () => {
      const { report } = analyzeArchitecture(hotspotModel);
      expect(report.fanIn[0]).toEqual({ name: "sink", count: 3 });
    });

    it("ranks elements by outgoing edges (efferent coupling)", () => {
      const { report } = analyzeArchitecture(hotspotModel);
      expect(report.fanOut[0]).toEqual({ name: "hub", count: 3 });
    });

    it("respects topN — default 5, truncates ranking", () => {
      // build a model with 7 elements each with 1 outgoing edge
      const m = makeModel({
        elements: [
          { name: "a", relations: [{ to: "z" }] },
          { name: "b", relations: [{ to: "z" }] },
          { name: "c", relations: [{ to: "z" }] },
          { name: "d", relations: [{ to: "z" }] },
          { name: "e", relations: [{ to: "z" }] },
          { name: "f", relations: [{ to: "z" }] },
          { name: "g", relations: [{ to: "z" }] },
          { name: "z" },
        ],
      });
      const def = analyzeArchitecture(m).report;
      expect(def.fanOut).toHaveLength(5);
      const tight = analyzeArchitecture(m, { topN: 2 }).report;
      expect(tight.fanOut).toHaveLength(2);
    });

    it("excludes by tag from fan-in/fan-out ranking but keeps edges counted for others", () => {
      const m = makeModel({
        elements: [
          {
            name: "logger",
            tags: ["infra"],
            relations: [{ to: "a" }, { to: "b" }],
          },
          { name: "a", relations: [{ to: "logger" }] },
          { name: "b", relations: [{ to: "logger" }] },
        ],
      });
      const { report } = analyzeArchitecture(m, {
        exclude: { tags: ["infra"] },
      });
      // logger is excluded from ranking but its existing edges to/from
      // other elements still count toward those elements' tallies
      expect(report.fanIn.map((it) => it.name)).not.toContain("logger");
      expect(report.fanOut.map((it) => it.name)).not.toContain("logger");
      expect(report.fanIn.find((it) => it.name === "a")?.count).toBe(1);
    });

    it("excludes by name pattern (glob)", () => {
      const m = makeModel({
        elements: [
          {
            name: "shared_lib",
            relations: [{ to: "a" }],
          },
          { name: "a" },
        ],
      });
      const { report } = analyzeArchitecture(m, {
        exclude: { namePatterns: ["shared_*"] },
      });
      expect(report.fanOut.map((it) => it.name)).not.toContain("shared_lib");
    });
  });

  describe("cycles", () => {
    it("detects a simple two-element cycle", () => {
      const m = makeModel({
        elements: [
          { name: "a", relations: [{ to: "b" }] },
          { name: "b", relations: [{ to: "a" }] },
        ],
      });
      const { report } = analyzeArchitecture(m);
      expect(report.cycles.count).toBe(1);
      expect(report.cycles.smallest).toEqual(
        expect.arrayContaining(["a", "b"]),
      );
    });

    it("ignores self-loops (validateModel surfaces those as ModelIssue)", () => {
      const m = makeModel({
        elements: [{ name: "self", relations: [{ to: "self" }] }],
      });
      const { report } = analyzeArchitecture(m);
      expect(report.cycles.count).toBe(0);
      expect(report.cycles.smallest).toBeNull();
    });

    it("picks the smallest cycle as `smallest` when multiple exist", () => {
      const m = makeModel({
        elements: [
          { name: "x", relations: [{ to: "y" }] },
          { name: "y", relations: [{ to: "x" }] },
          { name: "a", relations: [{ to: "b" }] },
          { name: "b", relations: [{ to: "c" }] },
          { name: "c", relations: [{ to: "a" }] },
        ],
      });
      const { report } = analyzeArchitecture(m);
      expect(report.cycles.count).toBe(2);
      expect(report.cycles.smallest).toHaveLength(2);
    });

    it("returns count=0 / smallest=null when no cycles", () => {
      const m = makeModel({
        elements: [{ name: "a", relations: [{ to: "b" }] }, { name: "b" }],
      });
      const { report } = analyzeArchitecture(m);
      expect(report.cycles.count).toBe(0);
      expect(report.cycles.smallest).toBeNull();
    });
  });
});
