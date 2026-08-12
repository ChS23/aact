import { resolveAnnotationKeys } from "../../../src/formats/kubernetes/annotations";
import { buildRelationsFor } from "../../../src/formats/kubernetes/relations";
import type { ServiceMap } from "../../../src/formats/kubernetes/serviceMap";
import type { ParsedManifest } from "../../../src/formats/kubernetes/types";

const makeManifest = (
  name: string,
  env: ReadonlyArray<{ name: string; value: string }> = [],
  annotations: Record<string, string> = {},
): ParsedManifest => ({
  filePath: "x.yaml",
  docIndex: 0,
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name, labels: {}, annotations },
  spec: { template: { spec: { containers: [{ image: "nginx", env }] } } },
  raw: {},
});

const makeServiceMap = (
  entries: Record<string, readonly string[]>,
): ServiceMap => ({
  byName: new Map(Object.entries(entries)),
});

const keys = resolveAnnotationKeys();

describe("buildRelationsFor — env-var heuristic", () => {
  it("resolves *_HOST env var via Service map", () => {
    const m = makeManifest("api", [
      { name: "ORDERS_HOST", value: "orders-svc" },
    ]);
    const svc = makeServiceMap({ "orders-svc": ["orders"] });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to)).toEqual(["orders"]);
  });

  it("resolves *_URL env with full URL value", () => {
    const m = makeManifest("api", [
      { name: "ORDERS_URL", value: "http://orders-svc:8080/v1" },
    ]);
    const svc = makeServiceMap({ "orders-svc": ["orders"] });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to)).toEqual(["orders"]);
  });

  it("resolves DSN-style _DATABASE_URL with auth", () => {
    const m = makeManifest("api", [
      {
        name: "PG_DATABASE_URL",
        value: "postgresql://user:secret@orders-db:5432/orders",
      },
    ]);
    const svc = makeServiceMap({ "orders-db": ["db"] });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to)).toEqual(["db"]);
  });

  it("resolves cluster DNS (service.namespace.svc.cluster.local)", () => {
    const m = makeManifest("api", [
      { name: "ORDERS_ENDPOINT", value: "orders-svc.shop.svc.cluster.local" },
    ]);
    const svc = makeServiceMap({ "orders-svc": ["orders"] });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to)).toEqual(["orders"]);
  });

  it("ignores env vars without service-style suffix", () => {
    const m = makeManifest("api", [
      { name: "LOG_LEVEL", value: "info" },
      { name: "ORDERS_HOST", value: "orders-svc" },
    ]);
    const svc = makeServiceMap({ "orders-svc": ["orders"] });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels).toHaveLength(1);
  });

  it("does not resolve env values not in service map", () => {
    const m = makeManifest("api", [
      { name: "EXTERNAL_HOST", value: "stripe.com" },
    ]);
    const svc = makeServiceMap({});
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels).toEqual([]);
  });

  it("dedupes relations to same target via multiple env vars", () => {
    const m = makeManifest("api", [
      { name: "ORDERS_HOST", value: "orders-svc" },
      { name: "ORDERS_URL", value: "http://orders-svc:8080" },
    ]);
    const svc = makeServiceMap({ "orders-svc": ["orders"] });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels).toHaveLength(1);
  });

  it("filters out self-relations", () => {
    const m = makeManifest("api", [
      { name: "API_HOST", value: "api-svc" },
      { name: "ORDERS_HOST", value: "orders-svc" },
    ]);
    const svc = makeServiceMap({
      "api-svc": ["api"], // self
      "orders-svc": ["orders"],
    });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to)).toEqual(["orders"]);
  });

  it("returns empty when no env vars", () => {
    const m = makeManifest("api");
    const svc = makeServiceMap({});
    expect(buildRelationsFor(m, "api", svc, keys)).toEqual([]);
  });

  it("handles empty env value gracefully (extractServiceCandidates early-return)", () => {
    const m = makeManifest("api", [{ name: "ORDERS_HOST", value: "" }]);
    const svc = makeServiceMap({});
    expect(buildRelationsFor(m, "api", svc, keys)).toEqual([]);
  });

  it("ignores env value that strips to empty host (path-only)", () => {
    const m = makeManifest("api", [
      { name: "ORDERS_URL", value: "/just/path" },
    ]);
    const svc = makeServiceMap({});
    expect(buildRelationsFor(m, "api", svc, keys)).toEqual([]);
  });

  it("skips containers without env arrays (defensive)", () => {
    const manifest: import("../../../src/formats/kubernetes/types").ParsedManifest =
      {
        filePath: "x.yaml",
        docIndex: 0,
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "api", labels: {}, annotations: {} },
        spec: {
          template: {
            spec: {
              containers: [
                null, // malformed entry
                "string-not-object", // type-wrong entry
                { image: "nginx" }, // no env
                { image: "nginx", env: "should-be-array" }, // env wrong type
                {
                  image: "nginx",
                  env: [
                    null,
                    "string",
                    { name: 42, value: "x" }, // name wrong type
                    { name: "ORDERS_HOST", value: 42 }, // value wrong type
                    { name: "OK_HOST", value: "orders-svc" }, // valid
                  ],
                },
              ],
            },
          },
        },
        raw: {},
      };
    const svc = makeServiceMap({ "orders-svc": ["orders"] });
    expect(
      buildRelationsFor(manifest, "api", svc, keys).map((r) => r.to),
    ).toEqual(["orders"]);
  });
});

describe("buildRelationsFor — aact.depends-on annotation", () => {
  it("uses explicit CSV list authoritatively (ignores env-vars)", () => {
    const m = makeManifest(
      "api",
      [{ name: "ORDERS_HOST", value: "orders-svc" }],
      { "aact.depends-on": "orders-db,cache" },
    );
    const svc = makeServiceMap({ "orders-svc": ["orders"] });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to).toSorted()).toEqual(["cache", "orders-db"]);
  });

  it("trims and filters empty entries in CSV", () => {
    const m = makeManifest("api", [], {
      "aact.depends-on": "  orders-db  ,, cache ",
    });
    const svc = makeServiceMap({});
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to).toSorted()).toEqual(["cache", "orders-db"]);
  });

  it("filters self-relations from explicit list", () => {
    const m = makeManifest("api", [], { "aact.depends-on": "api,orders-db" });
    const svc = makeServiceMap({});
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to)).toEqual(["orders-db"]);
  });

  it("empty annotation falls back to env-var heuristic", () => {
    const m = makeManifest(
      "api",
      [{ name: "ORDERS_HOST", value: "orders-svc" }],
      { "aact.depends-on": "" },
    );
    const svc = makeServiceMap({ "orders-svc": ["orders"] });
    const rels = buildRelationsFor(m, "api", svc, keys);
    expect(rels.map((r) => r.to)).toEqual(["orders"]);
  });
});
