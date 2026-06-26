import consola from "consola";

import { getElement } from "../../../src/model";
import {
  buildElementBoundaryMap,
  findPublicApiCandidate,
  resolveRedirectTarget,
} from "../../../src/rules/lib/boundaryUtils";
import type {
  BoundarySpec,
  ElementSpec,
  RelationSpec,
} from "../../helpers/makeModel";
import { makeModel } from "../../helpers/makeModel";

interface Scenario {
  readonly elements: readonly ElementSpec[];
  readonly boundaries: readonly BoundarySpec[];
}

const build = ({ elements, boundaries }: Scenario) => {
  const model = makeModel({ elements, boundaries });
  return { model, map: buildElementBoundaryMap(model) };
};

const dbSpec = (name: string): ElementSpec => ({ name, kind: "ContainerDb" });

const svcSpec = (
  name: string,
  relations: readonly RelationSpec[] = [],
  tags: readonly string[] = [],
): ElementSpec => ({ name, relations, tags });

describe("buildElementBoundaryMap", () => {
  it("maps each container to its boundary", () => {
    const { model, map } = build({
      elements: [svcSpec("svc"), dbSpec("db")],
      boundaries: [{ name: "bc", elementNames: ["svc", "db"] }],
    });
    const bc = model.boundaries.bc;

    expect(map.get("svc")).toBe(bc);
    expect(map.get("db")).toBe(bc);
  });

  it("returns empty map for model with no boundaries", () => {
    const model = makeModel({});
    expect(buildElementBoundaryMap(model).size).toBe(0);
  });
});

describe("findPublicApiCandidate", () => {
  it("returns undefined when no candidates", () => {
    const { model, map } = build({
      elements: [dbSpec("orders_db"), svcSpec("orders_repo", [], ["repo"])],
      boundaries: [{ name: "bc", elementNames: ["orders_db", "orders_repo"] }],
    });

    expect(
      findPublicApiCandidate(model.boundaries.bc, ["repo"], model, map),
    ).toBeUndefined();
  });

  it("returns the single candidate", () => {
    const { model, map } = build({
      elements: [svcSpec("orders_api"), dbSpec("orders_db")],
      boundaries: [{ name: "bc", elementNames: ["orders_api", "orders_db"] }],
    });

    expect(
      findPublicApiCandidate(model.boundaries.bc, ["repo"], model, map)?.name,
    ).toBe("orders_api");
  });

  it("picks candidate with highest in-degree from outside boundary", () => {
    const { model, map } = build({
      elements: [
        svcSpec("orders_api"),
        svcSpec("orders_gateway"),
        dbSpec("orders_db"),
        svcSpec("ext_a", [{ to: "orders_gateway" }]),
        svcSpec("ext_b", [{ to: "orders_gateway" }]),
        svcSpec("ext_c", [{ to: "orders_api" }]),
      ],
      boundaries: [
        {
          name: "orders",
          elementNames: ["orders_api", "orders_gateway", "orders_db"],
        },
        { name: "ext", elementNames: ["ext_a", "ext_b", "ext_c"] },
      ],
    });

    expect(
      findPublicApiCandidate(model.boundaries.orders, ["repo"], model, map),
    ).toBe(getElement(model, "orders_gateway"));
  });

  it("excludes in-boundary relations from in-degree count (covers L40)", () => {
    // Stryker mutated `if (boundaryMap.get(container.name) === targetBoundary) continue`
    // to `false`. Without skipping same-boundary sources, internal traffic
    // inflates in-degree and the wrong public API gets picked.
    const { model, map } = build({
      elements: [
        svcSpec("a_api"),
        svcSpec("b_api"),
        dbSpec("orders_db"),
        svcSpec("i1", [{ to: "b_api" }]),
        svcSpec("i2", [{ to: "b_api" }]),
        svcSpec("ext_caller", [{ to: "a_api" }]),
      ],
      boundaries: [
        {
          name: "orders",
          elementNames: ["a_api", "b_api", "orders_db", "i1", "i2"],
        },
        { name: "ext", elementNames: ["ext_caller"] },
      ],
    });

    expect(
      findPublicApiCandidate(model.boundaries.orders, ["repo"], model, map),
    ).toBe(getElement(model, "a_api"));
  });

  it("picks highest-in-degree candidate via the sort comparator", () => {
    // Stryker mutated `inDegree.get(b.name) ?? 0` to `inDegree.get(b.name) && 0`,
    // which corrupts the comparator. Pin: a candidate with strictly more
    // external incoming edges wins.
    const { model, map } = build({
      elements: [
        svcSpec("winner_api"),
        svcSpec("loser_api"),
        dbSpec("orders_db"),
        svcSpec("ext1", [{ to: "winner_api" }]),
        svcSpec("ext2", [{ to: "winner_api" }]),
        svcSpec("ext3", [{ to: "winner_api" }]),
        svcSpec("ext4", [{ to: "loser_api" }]),
      ],
      boundaries: [
        {
          name: "orders",
          elementNames: ["winner_api", "loser_api", "orders_db"],
        },
        { name: "ext", elementNames: ["ext1", "ext2", "ext3", "ext4"] },
      ],
    });

    expect(
      findPublicApiCandidate(model.boundaries.orders, ["repo"], model, map),
    ).toBe(getElement(model, "winner_api"));
  });
});

describe("resolveRedirectTarget", () => {
  it("returns owner for same-boundary access", () => {
    const { model, map } = build({
      elements: [
        dbSpec("orders_db"),
        svcSpec("orders_repo", [{ to: "orders_db" }], ["repo"]),
        svcSpec("orders_api", [{ to: "orders_db" }]),
      ],
      boundaries: [
        {
          name: "bc",
          elementNames: ["orders_db", "orders_repo", "orders_api"],
        },
      ],
    });
    const api = getElement(model, "orders_api")!;
    const db = getElement(model, "orders_db")!;
    const repo = getElement(model, "orders_repo")!;

    expect(
      resolveRedirectTarget(api, db, repo, ["repo"], model, map, "test"),
    ).toBe(repo);
  });

  it("returns public API for cross-boundary access", () => {
    const { model, map } = build({
      elements: [
        dbSpec("orders_db"),
        svcSpec("orders_repo", [{ to: "orders_db" }], ["repo"]),
        svcSpec("orders_api"),
        svcSpec("fulfillment_api", [{ to: "orders_db" }]),
      ],
      boundaries: [
        {
          name: "orders",
          elementNames: ["orders_db", "orders_repo", "orders_api"],
        },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    });
    const accessor = getElement(model, "fulfillment_api")!;
    const db = getElement(model, "orders_db")!;
    const repo = getElement(model, "orders_repo")!;
    const publicApi = getElement(model, "orders_api")!;

    expect(
      resolveRedirectTarget(accessor, db, repo, ["repo"], model, map, "test"),
    ).toBe(publicApi);
  });

  it("warns by name+rule when cross-boundary has no public API", () => {
    const { model, map } = build({
      elements: [
        dbSpec("orders_db"),
        svcSpec("orders_repo", [{ to: "orders_db" }], ["repo"]),
        svcSpec("fulfillment_api", [{ to: "orders_db" }]),
      ],
      boundaries: [
        { name: "orders", elementNames: ["orders_db", "orders_repo"] },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    });
    const accessor = getElement(model, "fulfillment_api")!;
    const db = getElement(model, "orders_db")!;
    const repo = getElement(model, "orders_repo")!;
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});

    resolveRedirectTarget(
      accessor,
      db,
      repo,
      ["repo"],
      model,
      map,
      "dbPerService",
    );

    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix dbPerService");
    expect(msg).toContain("orders");
    expect(msg).toContain("no public API");
    expect(msg).toContain("fulfillment_api");
    expect(msg).toContain("orders_db");
  });

  it("warns when only candidate IS the owner — distinct from no-API case", () => {
    const { model, map } = build({
      elements: [
        dbSpec("orders_db"),
        svcSpec("orders_only_svc", [{ to: "orders_db" }]),
        svcSpec("fulfillment_api", [{ to: "orders_db" }]),
      ],
      boundaries: [
        { name: "orders", elementNames: ["orders_db", "orders_only_svc"] },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    });
    const accessor = getElement(model, "fulfillment_api")!;
    const db = getElement(model, "orders_db")!;
    const owner = getElement(model, "orders_only_svc")!;
    const warn = vi.spyOn(consola, "warn").mockImplementation(() => {});

    resolveRedirectTarget(accessor, db, owner, ["repo"], model, map, "crud");

    expect(warn).toHaveBeenCalledOnce();
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("fix crud");
    expect(msg).toContain("only public API candidate");
    expect(msg).toContain("repo owner");
    expect(msg).toContain("fulfillment_api");
  });

  it("ties are broken by toSorted order when in-degrees are equal", () => {
    // Both candidates have the same in-degree (0). Stryker mutated the
    // sort `(inDegree(b) ?? 0) - (inDegree(a) ?? 0)` — if the comparator
    // breaks, an arbitrary candidate is picked. Assert that we still
    // return SOMETHING in that case (no throw) and it's one of the two
    // candidates — guarding the function from regressions where the
    // comparator returns NaN.
    const { model, map } = build({
      elements: [svcSpec("a_api"), svcSpec("b_api"), dbSpec("orders_db")],
      boundaries: [
        { name: "bc", elementNames: ["a_api", "b_api", "orders_db"] },
      ],
    });

    const result = findPublicApiCandidate(
      model.boundaries.bc,
      ["repo"],
      model,
      map,
    );
    expect([getElement(model, "a_api"), getElement(model, "b_api")]).toContain(
      result,
    );
  });

  it("returns undefined when cross-boundary has no public API", () => {
    const { model, map } = build({
      elements: [
        dbSpec("orders_db"),
        svcSpec("orders_repo", [{ to: "orders_db" }], ["repo"]),
        svcSpec("fulfillment_api", [{ to: "orders_db" }]),
      ],
      boundaries: [
        { name: "orders", elementNames: ["orders_db", "orders_repo"] },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    });
    const accessor = getElement(model, "fulfillment_api")!;
    const db = getElement(model, "orders_db")!;
    const repo = getElement(model, "orders_repo")!;
    vi.spyOn(consola, "warn").mockImplementation(() => {});

    expect(
      resolveRedirectTarget(accessor, db, repo, ["repo"], model, map, "test"),
    ).toBeUndefined();
  });

  it("returns undefined when public API candidate is the owner itself", () => {
    const { model, map } = build({
      elements: [
        dbSpec("orders_db"),
        svcSpec("orders_relay", [{ to: "orders_db" }], ["relay"]),
        svcSpec("fulfillment_api", [{ to: "orders_db" }]),
      ],
      boundaries: [
        { name: "orders", elementNames: ["orders_db", "orders_relay"] },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    });
    const accessor = getElement(model, "fulfillment_api")!;
    const db = getElement(model, "orders_db")!;
    const repo = getElement(model, "orders_relay")!;
    vi.spyOn(consola, "warn").mockImplementation(() => {});

    expect(
      resolveRedirectTarget(
        accessor,
        db,
        repo,
        ["repo", "relay"],
        model,
        map,
        "test",
      ),
    ).toBeUndefined();
  });

  it("returns undefined when the only non-db candidate IS the owner (fallback owner path)", () => {
    // fixDbPerService can fall back to a non-tagged first accessor as owner.
    // If that accessor is also the sole non-db container in the boundary,
    // findPublicApiCandidate returns it (it isn't filtered out by ownerTags),
    // and resolveRedirectTarget must catch the `publicApi === owner` branch
    // and bail with a warning instead of redirecting to itself.
    const { model, map } = build({
      elements: [
        dbSpec("orders_db"),
        svcSpec("orders_only_svc", [{ to: "orders_db" }]),
        svcSpec("fulfillment_api", [{ to: "orders_db" }]),
      ],
      boundaries: [
        { name: "orders", elementNames: ["orders_db", "orders_only_svc"] },
        { name: "fulfillment", elementNames: ["fulfillment_api"] },
      ],
    });
    const accessor = getElement(model, "fulfillment_api")!;
    const db = getElement(model, "orders_db")!;
    const owner = getElement(model, "orders_only_svc")!;
    vi.spyOn(consola, "warn").mockImplementation(() => {});

    expect(
      resolveRedirectTarget(accessor, db, owner, ["repo"], model, map, "test"),
    ).toBeUndefined();
  });
});
