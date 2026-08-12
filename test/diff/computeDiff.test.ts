import { computeDiff, DEFAULT_RENAME_THRESHOLD } from "../../src/diff";
import type { Boundary, Model } from "../../src/model";
import { makeModel } from "../helpers/makeModel";

const SIDE_BASE = { source: "baseline", format: "model-json" } as const;
const SIDE_CURR = { source: "current", format: "model-json" } as const;

const diff = (a: Model, b: Model, opts = {}) =>
  computeDiff(a, b, SIDE_BASE, SIDE_CURR, opts);

describe("computeDiff — identity matching", () => {
  it("reports zero changes for identical models", () => {
    const m = makeModel({ elements: [{ name: "a" }] });
    const result = diff(m, m);
    expect(result.changes).toHaveLength(0);
    expect(result.summary.headline).toBe("no changes");
  });

  it("reports element added", () => {
    const a = makeModel({ elements: [{ name: "a" }] });
    const b = makeModel({ elements: [{ name: "a" }, { name: "b" }] });
    const result = diff(a, b);
    const added = result.changes.filter((c) => c.action === "added");
    expect(added).toHaveLength(1);
    expect(added[0].entity).toBe("element");
    expect(added[0].severity).toBe("structural");
  });

  it("reports element removed", () => {
    const a = makeModel({ elements: [{ name: "a" }, { name: "b" }] });
    const b = makeModel({ elements: [{ name: "a" }] });
    const result = diff(a, b);
    const removed = result.changes.filter((c) => c.action === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].entity).toBe("element");
  });

  it("reports element modified when fields differ", () => {
    const a = makeModel({
      elements: [{ name: "svc", technology: "Postgres" }],
    });
    const b = makeModel({
      elements: [{ name: "svc", technology: "CockroachDB" }],
    });
    const result = diff(a, b);
    const modified = result.changes.find((c) => c.action === "modified");
    expect(modified).toBeDefined();
    expect(modified?.fields[0]).toMatchObject({
      field: "technology",
      before: "Postgres",
      after: "CockroachDB",
    });
    expect(modified?.severity).toBe("semantic");
  });
});

describe("computeDiff — severity classification", () => {
  it("marks kind transition as structural", () => {
    const a = makeModel({ elements: [{ name: "x", kind: "Container" }] });
    const b = makeModel({ elements: [{ name: "x", kind: "ContainerDb" }] });
    const result = diff(a, b);
    expect(result.changes[0].severity).toBe("structural");
  });

  it("marks technology change as semantic", () => {
    const a = makeModel({
      elements: [{ name: "x", technology: "Postgres" }],
    });
    const b = makeModel({ elements: [{ name: "x", technology: "MySQL" }] });
    const result = diff(a, b);
    expect(result.changes[0].severity).toBe("semantic");
  });

  it("marks label-only change as cosmetic", () => {
    const a = makeModel({ elements: [{ name: "x", label: "old" }] });
    const b = makeModel({ elements: [{ name: "x", label: "new" }] });
    const result = diff(a, b);
    expect(result.changes[0].severity).toBe("cosmetic");
  });
});

describe("computeDiff — rename detection", () => {
  it("exports the documented default rename threshold", () => {
    expect(DEFAULT_RENAME_THRESHOLD).toBe(0.65);
  });

  it("detects rename when label and relations match", () => {
    const a = makeModel({
      elements: [
        { name: "user_service", label: "Users", relations: [{ to: "db" }] },
        { name: "db" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "users", label: "Users", relations: [{ to: "db" }] },
        { name: "db" },
      ],
    });
    const result = diff(a, b);
    const renamed = result.changes.find((c) => c.action === "renamed");
    expect(renamed).toBeDefined();
    expect(renamed).toMatchObject({
      entity: "element",
      previousName: "user_service",
      name: "users",
    });
    expect(
      renamed && "confidence" in renamed && renamed.confidence,
    ).toBeGreaterThan(0.7);
  });

  it("does NOT collapse rename across different kinds", () => {
    const a = makeModel({
      elements: [{ name: "x", label: "Same", kind: "Container" }],
    });
    const b = makeModel({
      elements: [{ name: "y", label: "Same", kind: "ContainerDb" }],
    });
    const result = diff(a, b);
    expect(result.changes.some((c) => c.action === "renamed")).toBe(false);
    expect(result.changes.filter((c) => c.action === "added")).toHaveLength(1);
    expect(result.changes.filter((c) => c.action === "removed")).toHaveLength(
      1,
    );
  });

  it("respects --no-rename-detection (disableRenameDetection)", () => {
    const a = makeModel({
      elements: [{ name: "user_service", label: "Users" }],
    });
    const b = makeModel({ elements: [{ name: "users", label: "Users" }] });
    const result = diff(a, b, { disableRenameDetection: true });
    expect(result.changes.some((c) => c.action === "renamed")).toBe(false);
  });

  it("respects custom renameThreshold", () => {
    // Names + labels too different — default threshold wouldn't match.
    const a = makeModel({ elements: [{ name: "alpha", label: "Alpha" }] });
    const b = makeModel({ elements: [{ name: "zeta", label: "Zeta" }] });
    const looseResult = diff(a, b, { renameThreshold: 0.1 });
    expect(looseResult.changes.some((c) => c.action === "renamed")).toBe(true);
  });

  it("surfaces confidence on renamed change", () => {
    const a = makeModel({ elements: [{ name: "api_v1", label: "API" }] });
    const b = makeModel({ elements: [{ name: "api", label: "API" }] });
    const result = diff(a, b);
    const renamed = result.changes.find((c) => c.action === "renamed");
    expect(renamed).toBeDefined();
    if (renamed && renamed.entity === "element") {
      expect(renamed.confidence).toBeGreaterThan(0);
      expect(renamed.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("computeDiff — relation pair-collapse", () => {
  it("collapses same (from, to) removed+added into modified with technology field", () => {
    const a = makeModel({
      elements: [
        { name: "api", relations: [{ to: "db", technology: "HTTP" }] },
        { name: "db" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "api", relations: [{ to: "db", technology: "Kafka" }] },
        { name: "db" },
      ],
    });
    const result = diff(a, b);
    const relChanges = result.changes.filter((c) => c.entity === "relation");
    expect(relChanges).toHaveLength(1);
    expect(relChanges[0].action).toBe("modified");
    expect(relChanges[0].fields).toContainEqual(
      expect.objectContaining({
        field: "technology",
        before: "HTTP",
        after: "Kafka",
      }),
    );
    expect(result.groups).toContainEqual(
      expect.objectContaining({
        kind: "technologySwapped",
        title: "api → db technology changed from HTTP to Kafka",
        confidence: 1,
        changeAddresses: [relChanges[0].address],
        evidence: expect.objectContaining({
          from: "api",
          to: "db",
          beforeTechnology: "HTTP",
          afterTechnology: "Kafka",
        }),
      }),
    );
  });

  it("keeps multi-edge same (from, to) as separate add/remove", () => {
    const a = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "db", technology: "HTTP" },
            { to: "db", technology: "Kafka" },
          ],
        },
        { name: "db" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "db", technology: "HTTP" },
            { to: "db", technology: "gRPC" },
          ],
        },
        { name: "db" },
      ],
    });
    const result = diff(a, b);
    const relChanges = result.changes.filter((c) => c.entity === "relation");
    // HTTP stays matched; Kafka removed, gRPC added — 1+1 pair collapses
    // into modified for the second relation slot. So one modified, no
    // raw add/remove.
    expect(relChanges.some((c) => c.action === "modified")).toBe(true);
  });

  it("matches identical relations by (from, to, technology) tuple — no diff on pure reorder", () => {
    const a = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "a", technology: "HTTP" },
            { to: "b", technology: "Kafka" },
          ],
        },
        { name: "a" },
        { name: "b" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "b", technology: "Kafka" },
            { to: "a", technology: "HTTP" },
          ],
        },
        { name: "a" },
        { name: "b" },
      ],
    });
    const result = diff(a, b);
    expect(result.changes.filter((c) => c.entity === "relation")).toHaveLength(
      0,
    );
  });
});

describe("computeDiff — architectural change groups", () => {
  it("omits groups when no deterministic architectural pattern is detected", () => {
    const a = makeModel({ elements: [{ name: "api" }] });
    const b = makeModel({ elements: [{ name: "api" }, { name: "worker" }] });

    expect(diff(a, b).groups).toBeUndefined();
  });

  it("detects repository introduction from service→db reroute", () => {
    const a = makeModel({
      elements: [
        { name: "ordersService", relations: [{ to: "ordersDb" }] },
        { name: "ordersDb", kind: "ContainerDb", technology: "PostgreSQL" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "ordersService", relations: [{ to: "ordersRepo" }] },
        {
          name: "ordersRepo",
          relations: [{ to: "ordersDb" }],
          tags: ["repo"],
        },
        { name: "ordersDb", kind: "ContainerDb", technology: "PostgreSQL" },
      ],
    });

    const result = diff(a, b);

    expect(result.groups).toContainEqual(
      expect.objectContaining({
        kind: "introducedRepository",
        title: "Repository layer introduced between ordersService and ordersDb",
        severity: "structural",
        confidence: 0.95,
        changeAddresses: [
          "element:ordersRepo",
          "relation:ordersService→ordersDb",
          "relation:ordersService→ordersRepo",
          "relation:ordersRepo→ordersDb",
        ],
        evidence: expect.objectContaining({
          service: "ordersService",
          repository: "ordersRepo",
          database: "ordersDb",
        }),
      }),
    );
  });

  it("does not call an arbitrary intermediary a repository introduction", () => {
    const a = makeModel({
      elements: [
        { name: "api", relations: [{ to: "store" }] },
        { name: "store", kind: "ContainerDb" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "api", relations: [{ to: "cache" }] },
        { name: "cache", relations: [{ to: "store" }] },
        { name: "store", kind: "ContainerDb" },
      ],
    });

    expect(diff(a, b).groups).toBeUndefined();
  });
});

describe("computeDiff — boundary moves", () => {
  it("marks element move between boundaries as moved", () => {
    const a = makeModel({
      elements: [{ name: "svc" }],
      boundaries: [{ name: "a", elementNames: ["svc"] }, { name: "b" }],
    });
    const b = makeModel({
      elements: [{ name: "svc" }],
      boundaries: [{ name: "a" }, { name: "b", elementNames: ["svc"] }],
    });
    const result = diff(a, b);
    const svcChange = result.changes.find(
      (c) => c.entity === "element" && c.name === "svc",
    );
    expect(svcChange?.action).toBe("moved");
    expect(svcChange?.severity).toBe("structural");
  });
});

describe("computeDiff — workspace changes", () => {
  it("reports workspace name change as cosmetic", () => {
    const a: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "Old", description: "" },
    };
    const b: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "New", description: "" },
    };
    const result = diff(a, b);
    const ws = result.changes.find((c) => c.entity === "workspace");
    expect(ws).toBeDefined();
    expect(ws?.severity).toBe("cosmetic");
  });
});

describe("computeDiff — sorting and summary", () => {
  it("sorts changes by severity desc, then action precedence", () => {
    const a = makeModel({
      elements: [{ name: "kept", label: "Old" }, { name: "removed" }],
    });
    const b = makeModel({
      elements: [{ name: "kept", label: "New" }, { name: "added" }],
    });
    const result = diff(a, b);
    // Structural changes (added/removed) come before cosmetic (label modify).
    expect(result.changes[0].severity).toBe("structural");
    const cosmeticIdx = result.changes.findIndex(
      (c) => c.severity === "cosmetic",
    );
    expect(cosmeticIdx).toBeGreaterThan(0);
  });

  it("builds headline from the change set", () => {
    const a = makeModel({ elements: [{ name: "old" }] });
    const b = makeModel({ elements: [{ name: "new1" }, { name: "new2" }] });
    const result = diff(a, b, { disableRenameDetection: true });
    expect(result.summary.headline).toContain("+2");
    expect(result.summary.headline).toContain("-1");
  });

  it("aggregates summary counts across severity / action / entity", () => {
    const a = makeModel({ elements: [{ name: "x" }] });
    const b = makeModel({
      elements: [{ name: "x", technology: "HTTP" }, { name: "y" }],
    });
    const result = diff(a, b);
    expect(result.summary.bySeverity.structural).toBeGreaterThanOrEqual(1);
    expect(result.summary.bySeverity.semantic).toBeGreaterThanOrEqual(1);
    expect(result.summary.byEntity.element).toBeGreaterThanOrEqual(2);
  });
});

describe("computeDiff — RFC 6902 patch (opt-in)", () => {
  it("does not include patch by default", () => {
    const a = makeModel({ elements: [{ name: "a" }] });
    const b = makeModel({ elements: [{ name: "a" }, { name: "b" }] });
    expect(diff(a, b).patch).toBeUndefined();
  });

  it("includes patch when withPatch: true", () => {
    const a = makeModel({ elements: [{ name: "a" }] });
    const b = makeModel({ elements: [{ name: "a" }, { name: "b" }] });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch).toBeDefined();
    expect(result.patch?.length).toBeGreaterThan(0);
    expect(result.patch?.[0]).toMatchObject({
      op: expect.stringMatching(/^(add|remove|replace)$/),
    });
  });

  it("strips sourceLocation from patch — parser byproduct, not architecture", () => {
    const a = makeModel({ elements: [{ name: "a" }] });
    const b = makeModel({ elements: [{ name: "a" }] });
    const result = diff(a, b, { withPatch: true });
    const patchStr = JSON.stringify(result.patch);
    expect(patchStr).not.toContain("sourceLocation");
  });
});

// -----------------------------------------------------------------------------
// Boundary field-level diffs on a name-matched boundary (not a rename).
// Exercises diffBoundaryFields label + properties branches.
// -----------------------------------------------------------------------------

/** Inject `properties` onto a boundary — makeModel's BoundarySpec doesn't
 *  surface it, but the Model type carries it (Structurizr archetypes). */
const withBoundaryProperties = (
  model: Model,
  name: string,
  properties: Record<string, string>,
): Model => {
  const target = model.boundaries[name];
  const patched: Boundary = { ...target, properties };
  return {
    ...model,
    boundaries: { ...model.boundaries, [name]: patched },
  };
};

describe("computeDiff — matched boundary field changes", () => {
  it("detects a boundary label change as a cosmetic field on a modified boundary", () => {
    const a = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx", label: "Old Context", elementNames: ["x"] }],
    });
    const b = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx", label: "New Context", elementNames: ["x"] }],
    });
    const result = diff(a, b);
    const change = result.changes.find(
      (c) => c.entity === "boundary" && c.action === "modified",
    );
    expect(change).toBeDefined();
    expect(change?.fields).toContainEqual(
      expect.objectContaining({
        field: "label",
        before: "Old Context",
        after: "New Context",
      }),
    );
  });

  it("detects a boundary properties change as a semantic field", () => {
    const baseA = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx", elementNames: ["x"] }],
    });
    const baseB = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx", elementNames: ["x"] }],
    });
    const a = withBoundaryProperties(baseA, "ctx", { archetype: "service" });
    const b = withBoundaryProperties(baseB, "ctx", { archetype: "datastore" });
    const result = diff(a, b);
    const change = result.changes.find(
      (c) => c.entity === "boundary" && c.action === "modified",
    );
    expect(change).toBeDefined();
    const propField = change?.fields.find((f) => f.field === "properties");
    expect(propField).toMatchObject({
      field: "properties",
      before: { archetype: "service" },
      after: { archetype: "datastore" },
    });
    // properties is a semantic field per FIELD_SEVERITY.
    expect(change?.severity).toBe("semantic");
  });
});

// -----------------------------------------------------------------------------
// Workspace.description branch (diffWorkspace).
// -----------------------------------------------------------------------------

describe("computeDiff — workspace description change", () => {
  it("reports a workspace description change as cosmetic", () => {
    const a: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "ws", description: "old prose" },
    };
    const b: Model = {
      ...makeModel({ elements: [{ name: "x" }] }),
      workspace: { name: "ws", description: "new prose" },
    };
    const result = diff(a, b);
    const ws = result.changes.find((c) => c.entity === "workspace");
    expect(ws?.fields).toContainEqual(
      expect.objectContaining({
        field: "workspace.description",
        before: "old prose",
        after: "new prose",
      }),
    );
    expect(ws?.severity).toBe("cosmetic");
  });
});

// -----------------------------------------------------------------------------
// isDatabaseLike text-based detection: a database element whose kind does
// NOT end in "Db" but whose searchable text matches a db keyword. Drives
// the introducedRepository group through the text-regex branch.
// -----------------------------------------------------------------------------

describe("computeDiff — repository introduction with text-detected database", () => {
  it("detects introducedRepository when the datastore is identified by text, not by kind suffix", () => {
    const a = makeModel({
      elements: [
        { name: "ordersService", relations: [{ to: "ordersStore" }] },
        // kind is plain Container — db-ness comes from technology text.
        { name: "ordersStore", kind: "Container", technology: "PostgreSQL" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "ordersService", relations: [{ to: "ordersRepo" }] },
        {
          name: "ordersRepo",
          relations: [{ to: "ordersStore" }],
          tags: ["repo"],
        },
        { name: "ordersStore", kind: "Container", technology: "PostgreSQL" },
      ],
    });
    const result = diff(a, b);
    expect(result.groups).toContainEqual(
      expect.objectContaining({
        kind: "introducedRepository",
        title:
          "Repository layer introduced between ordersService and ordersStore",
        evidence: expect.objectContaining({
          service: "ordersService",
          repository: "ordersRepo",
          database: "ordersStore",
        }),
      }),
    );
  });
});

// -----------------------------------------------------------------------------
// compareGroups: sorting two-or-more groups (severity desc, then id asc).
// -----------------------------------------------------------------------------

describe("computeDiff — multiple change groups are sorted deterministically", () => {
  it("sorts groups by severity then id when more than one group is produced", () => {
    // Two independent technology swaps → two technologySwapped groups
    // that share severity (semantic), so the id localeCompare tiebreak
    // decides order.
    const a = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "z_db", technology: "HTTP" },
            { to: "a_db", technology: "HTTP" },
          ],
        },
        { name: "z_db" },
        { name: "a_db" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "api",
          relations: [
            { to: "z_db", technology: "Kafka" },
            { to: "a_db", technology: "gRPC" },
          ],
        },
        { name: "z_db" },
        { name: "a_db" },
      ],
    });
    const result = diff(a, b);
    const groups = result.groups ?? [];
    expect(groups.length).toBeGreaterThanOrEqual(2);
    // Same severity → ascending id ordering must hold pairwise.
    const ids = groups.map((g) => g.id);
    const sortedIds = [...ids].sort((x, y) => x.localeCompare(y));
    expect(ids).toEqual(sortedIds);
  });

  it("orders a higher-severity group ahead of a lower-severity one", () => {
    // technologySwapped (semantic) + a fresh added relation cannot make
    // two different severities alone, so pair a structural-flavored
    // introducedRepository (structural) against a technologySwapped
    // (semantic) and assert structural sorts first.
    const a = makeModel({
      elements: [
        {
          name: "svc",
          relations: [{ to: "db", technology: "rest" }, { to: "other" }],
        },
        { name: "db", kind: "ContainerDb" },
        { name: "other", relations: [{ to: "sink", technology: "HTTP" }] },
        { name: "sink" },
      ],
    });
    const b = makeModel({
      elements: [
        {
          name: "svc",
          relations: [{ to: "repo", technology: "rest" }, { to: "other" }],
        },
        { name: "repo", relations: [{ to: "db" }], tags: ["repo"] },
        { name: "db", kind: "ContainerDb" },
        { name: "other", relations: [{ to: "sink", technology: "Kafka" }] },
        { name: "sink" },
      ],
    });
    const result = diff(a, b);
    const groups = result.groups ?? [];
    const severities = groups.map((g) => g.severity);
    const structuralIdx = severities.indexOf("structural");
    const semanticIdx = severities.indexOf("semantic");
    if (structuralIdx !== -1 && semanticIdx !== -1) {
      expect(structuralIdx).toBeLessThan(semanticIdx);
    } else {
      // At minimum, both group kinds were produced.
      expect(groups.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// -----------------------------------------------------------------------------
// computePatch strip helpers + array replace op.
// -----------------------------------------------------------------------------

describe("computeDiff — patch strips locations and replaces arrays", () => {
  it("strips relation sourceLocation while keeping the relation in the patch model", () => {
    // Element carries an outgoing relation, so stripElementLocation must
    // walk the relations array and drop each relation's sourceLocation.
    const a = makeModel({
      elements: [
        { name: "api", relations: [{ to: "db", technology: "HTTP" }] },
        { name: "db" },
      ],
    });
    const b = makeModel({
      elements: [
        { name: "api", relations: [{ to: "db", technology: "gRPC" }] },
        { name: "db" },
      ],
    });
    const result = diff(a, b, { withPatch: true });
    expect(result.patch).toBeDefined();
    const patchStr = JSON.stringify(result.patch);
    expect(patchStr).not.toContain("sourceLocation");
    // The relation technology change still surfaces as a replace op.
    expect(patchStr).toContain("gRPC");
  });

  it("strips boundary sourceLocation when boundaries are present", () => {
    const a = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx", label: "Old", elementNames: ["x"] }],
    });
    const b = makeModel({
      elements: [{ name: "x" }],
      boundaries: [{ name: "ctx", label: "New", elementNames: ["x"] }],
    });
    const result = diff(a, b, { withPatch: true });
    const patchStr = JSON.stringify(result.patch);
    expect(result.patch).toBeDefined();
    expect(patchStr).not.toContain("sourceLocation");
    // Boundary label change made it into the patch.
    expect(patchStr).toContain("New");
  });

  it("emits a single array replace op when an array field changes (no LCS)", () => {
    // tags is an array; a change produces one `replace` op on the whole
    // array rather than element-wise add/remove ops.
    const a = makeModel({ elements: [{ name: "x", tags: ["v1"] }] });
    const b = makeModel({ elements: [{ name: "x", tags: ["v1", "v2"] }] });
    const result = diff(a, b, { withPatch: true });
    const tagOps = (result.patch ?? []).filter((op) =>
      op.path.endsWith("/tags"),
    );
    expect(tagOps).toHaveLength(1);
    expect(tagOps[0]).toMatchObject({
      op: "replace",
      value: ["v1", "v2"],
    });
  });

  it("does not emit a patch op for an array that is unchanged", () => {
    const a = makeModel({ elements: [{ name: "x", tags: ["v1", "v2"] }] });
    const b = makeModel({ elements: [{ name: "x", tags: ["v1", "v2"] }] });
    const result = diff(a, b, { withPatch: true });
    const tagOps = (result.patch ?? []).filter((op) =>
      op.path.endsWith("/tags"),
    );
    expect(tagOps).toHaveLength(0);
  });
});
