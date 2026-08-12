import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import path from "pathe";

import { load as loadPlantuml } from "../../src/formats/plantuml/load";
import { load as loadStructurizr } from "../../src/formats/structurizr/load";
import type { Element, Model, Relation } from "../../src/model";
import { allElements } from "../../src/model";

/**
 * F4 — same architecture в PUML и Structurizr должна produce equivalent
 * Model surface. Catches semantic divergence между loaders:
 *
 *  - PUML `System_Ext(x)` ↔ Structurizr `softwareSystem { location: External }`
 *    оба → `kind: System, external: true`
 *  - PUML `ContainerDb(x)` ↔ Structurizr container с tech PostgreSQL → `kind: ContainerDb`
 *  - PUML `Rel(a, b, "label", "REST", "tag")` ↔ Structurizr relationship
 *    `{ description: "label", technology: "REST", tags: "tag" }`
 *
 * Comparison фокусирован на semantic surface — структура графа, kinds,
 * external flags, tag sets. Container names МОГУТ отличаться (PUML alias vs
 * Structurizr DSL identifier), поэтому сравниваем по explicit mapping.
 */

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "aact-cross-"));
});

const writePuml = async (name: string, content: string): Promise<string> => {
  const file = path.join(tmpDir, `${name}.puml`);
  await writeFile(file, content, "utf8");
  return file;
};

const writeStructurizr = async (
  name: string,
  workspace: unknown,
): Promise<string> => {
  const file = path.join(tmpDir, `${name}.json`);
  await writeFile(file, JSON.stringify(workspace), "utf8");
  return file;
};

/** Канонизируем Container к sequence-проверяемой form (без `name` — он может различаться между форматами по convention). */
const canonContainer = (c: Element) => ({
  kind: c.kind,
  external: c.external,
  technology: c.technology,
  tags: [...c.tags].toSorted(),
});

const canonRelation = (r: Relation) => ({
  to: r.to,
  technology: r.technology,
  tags: [...r.tags].toSorted(),
});

/** Соответствие name → canonical container. */
const containersByCanonName = (
  model: Model,
): Map<string, ReturnType<typeof canonContainer>> => {
  const out = new Map<string, ReturnType<typeof canonContainer>>();
  for (const c of allElements(model)) {
    out.set(c.name, canonContainer(c));
  }
  return out;
};

/** Set of edges as `from→to|tech|tags` strings. */
const edgeSet = (model: Model): Set<string> => {
  const out = new Set<string>();
  for (const c of allElements(model)) {
    for (const r of c.relations) {
      const rel = canonRelation(r);
      out.add(
        `${c.name}→${rel.to}|${rel.technology ?? ""}|${rel.tags.join(",")}`,
      );
    }
  }
  return out;
};

describe("Cross-format Model equivalence (F4)", () => {
  it("trivial: single container + relation", async () => {
    const pumlFile = await writePuml(
      "trivial",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(api, "API")',
        'Container(db, "DB")',
        'Rel(api, db, "SQL")',
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("trivial", {
      model: {
        softwareSystems: [
          {
            id: "sys",
            name: "Sys",
            containers: [
              {
                id: "api",
                name: "API",
                relationships: [{ destinationId: "db", description: "SQL" }],
              },
              { id: "db", name: "DB", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    expect(containersByCanonName(pumlModel)).toEqual(
      containersByCanonName(structModel),
    );
    expect(edgeSet(pumlModel)).toEqual(edgeSet(structModel));
  });

  it("ContainerDb: PUML macro ↔ Structurizr tech inference", async () => {
    const pumlFile = await writePuml(
      "db",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'ContainerDb(orders_db, "Orders DB")',
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("db", {
      model: {
        softwareSystems: [
          {
            id: "sys",
            name: "Sys",
            containers: [
              {
                id: "orders_db",
                name: "Orders DB",
                technology: "PostgreSQL",
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    const pumlDb = pumlModel.elements.orders_db;
    const structDb = structModel.elements.orders_db;
    expect(pumlDb.kind).toBe("ContainerDb");
    expect(structDb.kind).toBe("ContainerDb");
    expect(pumlDb.external).toBe(structDb.external);
  });

  it("External system: PUML System_Ext ↔ Structurizr location:External", async () => {
    const pumlFile = await writePuml(
      "ext",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System_Ext(payments, "Payment Provider")',
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("ext", {
      model: {
        softwareSystems: [
          {
            id: "payments",
            name: "Payment Provider",
            location: "External",
            containers: [],
          },
        ],
        people: [],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    const pumlExt = pumlModel.elements.payments;
    const structExt = structModel.elements.payments;
    expect(pumlExt.kind).toBe("System");
    expect(structExt.kind).toBe("System");
    expect(pumlExt.external).toBe(true);
    expect(structExt.external).toBe(true);
  });

  it("Person: PUML Person ↔ Structurizr person", async () => {
    const pumlFile = await writePuml(
      "person",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Person(user, "End User")',
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("person", {
      model: {
        softwareSystems: [],
        people: [{ id: "user", name: "End User", relationships: [] }],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    expect(pumlModel.elements.user.kind).toBe("Person");
    expect(structModel.elements.user.kind).toBe("Person");
  });

  it("Relations: technology and tags preserved both sides", async () => {
    const pumlFile = await writePuml(
      "rel-tagged",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "calls", "REST", $tags="critical+audit")',
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("rel-tagged", {
      model: {
        softwareSystems: [
          {
            id: "sys",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  {
                    destinationId: "b",
                    description: "calls",
                    technology: "REST",
                    tags: "critical, audit",
                  },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    const pumlRel = pumlModel.elements.a.relations[0];
    const structRel = structModel.elements.a.relations[0];
    expect(pumlRel.technology).toBe(structRel.technology);
    expect([...pumlRel.tags].toSorted()).toEqual(
      [...structRel.tags].toSorted(),
    );
  });

  it('Async marker: PUML $tags="async" ↔ Structurizr interactionStyle:Asynchronous', async () => {
    const pumlFile = await writePuml(
      "async",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(a, "A")',
        'Container(b, "B")',
        'Rel(a, b, "publishes", "Kafka", $tags="async")',
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("async", {
      model: {
        softwareSystems: [
          {
            id: "sys",
            name: "Sys",
            containers: [
              {
                id: "a",
                name: "A",
                relationships: [
                  {
                    destinationId: "b",
                    description: "publishes",
                    technology: "Kafka",
                    interactionStyle: "Asynchronous",
                  },
                ],
              },
              { id: "b", name: "B", relationships: [] },
            ],
          },
        ],
        people: [],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    expect(pumlModel.elements.a.relations[0].tags).toContain("async");
    expect(structModel.elements.a.relations[0].tags).toContain("async");
  });

  it("Boundary: PUML System_Boundary ↔ Structurizr internal SoftwareSystem", async () => {
    const pumlFile = await writePuml(
      "boundary",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System_Boundary(orders, "Orders") {',
        '  Container(api, "Orders API")',
        '  ContainerDb(db, "Orders DB")',
        "}",
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("boundary", {
      model: {
        softwareSystems: [
          {
            id: "orders",
            name: "Orders",
            containers: [
              { id: "api", name: "Orders API", relationships: [] },
              {
                id: "db",
                name: "Orders DB",
                technology: "PostgreSQL",
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    expect(Object.keys(pumlModel.boundaries)).toEqual(["orders"]);
    expect(Object.keys(structModel.boundaries)).toEqual(["orders"]);
    expect([...pumlModel.boundaries.orders.elementNames].toSorted()).toEqual(
      [...structModel.boundaries.orders.elementNames].toSorted(),
    );
  });

  it("Cross-boundary relation: equal edge set in both formats", async () => {
    const pumlFile = await writePuml(
      "cross",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'System_Boundary(orders, "Orders") {',
        '  Container(orders_api, "Orders API")',
        "}",
        'System_Ext(ext, "External Service")',
        'Rel(orders_api, ext, "calls")',
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("cross", {
      model: {
        softwareSystems: [
          {
            id: "orders",
            name: "Orders",
            containers: [
              {
                id: "orders_api",
                name: "Orders API",
                relationships: [{ destinationId: "ext", description: "calls" }],
              },
            ],
          },
          {
            id: "ext",
            name: "External Service",
            location: "External",
            containers: [],
          },
        ],
        people: [],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    expect(edgeSet(pumlModel)).toEqual(edgeSet(structModel));
  });

  it('Tags: PUML $tags="a+b" ↔ Structurizr CSV "a, b"', async () => {
    const pumlFile = await writePuml(
      "tags",
      [
        "@startuml",
        "!include https://raw.githubusercontent.com/plantuml-stdlib/C4-PlantUML/master/C4_Container.puml",
        'Container(svc, "Svc", $tags="public+gateway")',
        "@enduml",
      ].join("\n"),
    );
    const structFile = await writeStructurizr("tags", {
      model: {
        softwareSystems: [
          {
            id: "sys",
            name: "Sys",
            containers: [
              {
                id: "svc",
                name: "Svc",
                tags: "public, gateway",
                relationships: [],
              },
            ],
          },
        ],
        people: [],
      },
    });

    const pumlModel = (await loadPlantuml(pumlFile)).model;
    const structModel = (await loadStructurizr(structFile)).model;

    expect([...pumlModel.elements.svc.tags].toSorted()).toEqual(
      [...structModel.elements.svc.tags].toSorted(),
    );
  });
});
