import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import path from "pathe";

import { generate } from "../../../src/formats/plantuml/generate";
import { load } from "../../../src/formats/plantuml/load";
import type { Element, Model, Relation } from "../../../src/model";
import { allElements } from "../../../src/model";
import { makeModel } from "../../helpers/makeModel";

/**
 * F3 — load → generate → load = identity (для PUML format).
 *
 * Это THE confidence test для format API: если round-trip ломается —
 * generator теряет данные или loader восстанавливает не идентично.
 * v2 имел такие баги (descr в techn slot, sprite-as-tags fallback на real
 * sprites) — round-trip их сразу подсветил бы.
 */

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "aact-rt-"));
});

/**
 * Normalize Container в plain object с deterministic relations order.
 * Поля которые мы заведомо НЕ переносим через round-trip (см. known gaps
 * в load.test.ts) — исключаем: properties, sourceLocation, order на relation.
 */
const normalizeContainer = (c: Element) => ({
  name: c.name,
  label: c.label,
  kind: c.kind,
  external: c.external,
  description: c.description,
  technology: c.technology,
  tags: [...c.tags].toSorted(),
  sprite: c.sprite,
  link: c.link,
  relations: c.relations
    .map(normalizeRelation)
    .toSorted((a, b) =>
      `${a.to}|${a.description}`.localeCompare(`${b.to}|${b.description}`),
    ),
});

const normalizeRelation = (r: Relation) => ({
  to: r.to,
  description: r.description,
  technology: r.technology,
  tags: [...r.tags].toSorted(),
  sprite: r.sprite,
  link: r.link,
});

const normalize = (model: Model) => ({
  elements: allElements(model)
    .map(normalizeContainer)
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  boundaries: Object.values(model.boundaries)
    .map((b) => ({
      name: b.name,
      label: b.label,
      kind: b.kind,
      tags: [...b.tags].toSorted(),
      elementNames: [...b.elementNames].toSorted(),
      boundaryNames: [...b.boundaryNames].toSorted(),
      link: b.link,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name)),
  rootBoundaryNames: [...model.rootBoundaryNames].toSorted(),
});

let rtCounter = 0;
const roundTrip = async (model: Model): Promise<Model> => {
  const generated = generate(model);
  const file = path.join(tmpDir, `rt-${++rtCounter}.puml`);
  await writeFile(file, generated.files[0].content, "utf8");
  const { model: reloaded } = await load(file);
  return reloaded;
};

describe("PlantUML round-trip integrity (F3)", () => {
  it("preserves a flat container model", async () => {
    const original = makeModel({
      elements: [
        { name: "orders_api", label: "Orders API", technology: "Java" },
        { name: "orders_db", label: "Orders DB", kind: "ContainerDb" },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("sanitises hyphenated names into valid PlantUML aliases", async () => {
    // Names from Structurizr / kubernetes (`orders-api`) are valid there
    // but illegal as a PlantUML alias — generate must normalise them, or
    // the output won't parse back.
    const original = makeModel({
      elements: [
        {
          name: "orders-api",
          kind: "Container",
          relations: [{ to: "orders-db" }],
        },
        { name: "orders-db", kind: "ContainerDb" },
      ],
    });
    const { content } = generate(original).files[0];
    expect(content).toContain("Container(orders_api,");
    expect(content).toContain("Rel(orders_api, orders_db,");
    expect(content).not.toMatch(/\(orders-/);
    // The bug: a hyphen alias threw on re-parse. Now it round-trips.
    const rebuilt = await roundTrip(original);
    expect(Object.keys(rebuilt.elements).toSorted()).toEqual([
      "orders_api",
      "orders_db",
    ]);
    expect(rebuilt.elements["orders_api"].relations.map((r) => r.to)).toEqual([
      "orders_db",
    ]);
  });

  it("preserves a container with all fields populated", async () => {
    const original = makeModel({
      elements: [
        {
          name: "svc",
          label: "Service",
          kind: "Container",
          technology: "Node 22",
          description: "Backend API",
          tags: ["public", "production"],
          sprite: "node-logo",
          link: "https://wiki.example.com/svc",
        },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves Person and System contexts (no techn slot)", async () => {
    const original = makeModel({
      elements: [
        { name: "user", label: "End User", kind: "Person" },
        { name: "core", label: "Core System", kind: "System" },
        {
          name: "ext_api",
          label: "External API",
          kind: "System",
          external: true,
        },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves all ElementKind variants (Db, Queue, Component)", async () => {
    const original = makeModel({
      elements: [
        { name: "api", label: "API", kind: "Container" },
        { name: "db", label: "DB", kind: "ContainerDb" },
        { name: "queue", label: "Queue", kind: "ContainerQueue" },
        { name: "comp", label: "Comp", kind: "Component" },
        { name: "comp_db", label: "Comp DB", kind: "ComponentDb" },
        { name: "comp_queue", label: "Comp Queue", kind: "ComponentQueue" },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves external flag across all kinds", async () => {
    const original = makeModel({
      elements: [
        { name: "ext_p", label: "Ext Person", kind: "Person", external: true },
        { name: "ext_s", label: "Ext Sys", kind: "System", external: true },
        {
          name: "ext_c",
          label: "Ext Container",
          kind: "Container",
          external: true,
        },
        {
          name: "ext_cdb",
          label: "Ext ContainerDb",
          kind: "ContainerDb",
          external: true,
        },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves relations with all field variants", async () => {
    const original = makeModel({
      elements: [
        {
          name: "a",
          relations: [
            { to: "b", description: "calls" },
            {
              to: "c",
              description: "publishes",
              technology: "Kafka",
              tags: ["async", "critical"],
            },
            { to: "d", link: "https://docs.example.com/d" },
          ],
        },
        { name: "b" },
        { name: "c" },
        { name: "d" },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves boundary nesting", async () => {
    const original = makeModel({
      elements: [
        { name: "api", label: "API" },
        { name: "worker", label: "Worker" },
        { name: "inner_svc", label: "Inner Svc" },
      ],
      boundaries: [
        {
          name: "outer",
          label: "Outer",
          boundaryNames: ["inner"],
          elementNames: ["api", "worker"],
        },
        {
          name: "inner",
          label: "Inner",
          elementNames: ["inner_svc"],
          tags: ["domain"],
        },
      ],
      rootBoundaryNames: ["outer"],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves cross-boundary relations", async () => {
    const original = makeModel({
      elements: [
        {
          name: "api",
          label: "API",
          relations: [{ to: "ext", description: "uses" }],
        },
        { name: "ext", label: "External", kind: "System", external: true },
      ],
      boundaries: [
        { name: "platform", label: "Platform", elementNames: ["api"] },
      ],
    });
    const rebuilt = await roundTrip(original);
    expect(normalize(rebuilt)).toEqual(normalize(original));
  });

  it("preserves boundary tags and link", async () => {
    const original = makeModel({
      elements: [{ name: "svc" }],
      boundaries: [
        {
          name: "ctx",
          label: "Context",
          elementNames: ["svc"],
          tags: ["domain", "core"],
          link: "https://wiki.example.com/ctx",
        },
      ],
    });
    const rebuilt = await roundTrip(original);
    const before = normalize(original);
    const after = normalize(rebuilt);
    expect(after.boundaries).toEqual(before.boundaries);
  });

  it("preserves real fixture (banking C4L2.puml) through round-trip", async () => {
    // Сильный e2e — берём настоящий fixture, который v2 users могли иметь.
    const { model: fixtureModel } = await load(
      "fixtures/architecture/C4L2.puml",
    );
    const rebuilt = await roundTrip(fixtureModel);

    // Container count + name set must match exactly.
    expect(Object.keys(rebuilt.elements).toSorted()).toEqual(
      Object.keys(fixtureModel.elements).toSorted(),
    );

    // Per container: kind/external/tags/relations должны быть identical
    // (description/technology могут отсутствовать в fixture).
    for (const name of Object.keys(fixtureModel.elements)) {
      const before = fixtureModel.elements[name];
      const after = rebuilt.elements[name];
      expect(after.kind).toBe(before.kind);
      expect(after.external).toBe(before.external);
      expect([...after.tags].toSorted()).toEqual([...before.tags].toSorted());
      expect(after.relations.length).toBe(before.relations.length);
    }
  });
});
