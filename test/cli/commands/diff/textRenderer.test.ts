import { PassThrough } from "node:stream";

import { renderDiffText } from "../../../../src/cli/commands/diff/textRenderer";
import { buildEnvelope } from "../../../../src/cli/output";
import type {
  Change,
  ChangeGroup,
  DiffData,
  DiffSummary,
} from "../../../../src/diff";

const SIDE = { source: "x", format: "plantuml" } as const;

const baseSummary = (changes: readonly Change[]): DiffSummary => ({
  headline: "test headline",
  bySeverity: {
    structural: changes.filter((c) => c.severity === "structural").length,
    semantic: changes.filter((c) => c.severity === "semantic").length,
    cosmetic: changes.filter((c) => c.severity === "cosmetic").length,
  },
  byAction: {
    added: 0,
    removed: 0,
    modified: 0,
    renamed: 0,
    moved: 0,
  },
  byEntity: { element: 0, boundary: 0, relation: 0, workspace: 0 },
});

const envelopeFor = (
  changes: readonly Change[],
  groups?: readonly ChangeGroup[],
): DiffData => ({
  summary: baseSummary(changes),
  changes,
  ...(groups ? { groups } : {}),
  baseline: SIDE,
  current: SIDE,
});

const captureSink = (): {
  sink: NodeJS.WritableStream;
  output: () => string;
} => {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return { sink: stream, output: () => Buffer.concat(chunks).toString("utf8") };
};

const render = (data: DiffData): string => {
  const { sink, output } = captureSink();
  renderDiffText(
    buildEnvelope({
      command: "diff",
      exitCode: data.changes.length === 0 ? 0 : 1,
      data,
      meta: { durationMs: 1, configPath: null, source: null },
    }),
    sink,
  );
  return output();
};

describe("renderDiffText", () => {
  it("prints `No structural changes.` when changes is empty", () => {
    const text = render(envelopeFor([]));
    expect(text).toContain("No structural changes");
  });

  it("renders element added line with kind label", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "added",
          severity: "structural",
          address: "element:api",
          name: "api",
          kind: "Container",
          fields: [],
        },
      ]),
    );
    expect(text).toContain("api");
    expect(text).toContain("Container");
    expect(text).toContain("Element");
  });

  it("renders element removed line", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "removed",
          severity: "structural",
          address: "element:gone",
          name: "gone",
          kind: "Container",
          fields: [],
        },
      ]),
    );
    expect(text).toContain("gone");
  });

  it("renders element renamed with previousName → name and confidence", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "renamed",
          severity: "structural",
          address: "element:api",
          name: "api",
          previousName: "old_api",
          confidence: 0.82,
          kind: "Container",
          fields: [],
        },
      ]),
    );
    expect(text).toContain("old_api");
    expect(text).toContain("api");
    expect(text).toContain("0.82");
  });

  it("renders element moved with boundary before → after", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "moved",
          severity: "structural",
          address: "element:svc",
          name: "svc",
          kind: "Container",
          fields: [{ field: "boundary", before: "old_b", after: "new_b" }],
        },
      ]),
    );
    expect(text).toContain("svc");
    expect(text).toContain("old_b");
    expect(text).toContain("new_b");
  });

  it("renders element modified with field summary", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "modified",
          severity: "semantic",
          address: "element:api",
          name: "api",
          kind: "Container",
          fields: [{ field: "technology", before: "HTTP", after: "Kafka" }],
        },
      ]),
    );
    expect(text).toContain("technology");
    expect(text).toContain("HTTP");
    expect(text).toContain("Kafka");
  });

  it("renders boundary added/renamed/modified lines", () => {
    const text = render(
      envelopeFor([
        {
          entity: "boundary",
          action: "added",
          severity: "structural",
          address: "boundary:platform",
          name: "platform",
          kind: "System",
          fields: [],
        },
        {
          entity: "boundary",
          action: "renamed",
          severity: "structural",
          address: "boundary:checkout",
          name: "checkout",
          previousName: "co",
          confidence: 0.9,
          kind: "System",
          fields: [],
        },
        {
          entity: "boundary",
          action: "modified",
          severity: "structural",
          address: "boundary:checkout",
          name: "checkout",
          kind: "System",
          fields: [
            {
              field: "elementNames",
              before: ["a"],
              after: ["a", "b"],
              added: ["b"],
            },
          ],
        },
      ]),
    );
    expect(text).toContain("platform");
    expect(text).toContain("co");
    expect(text).toContain("checkout");
    expect(text).toContain("elementNames");
  });

  it("renders relation added/removed with technology in parens", () => {
    const text = render(
      envelopeFor([
        {
          entity: "relation",
          action: "added",
          severity: "structural",
          address: "relation:api→broker(Kafka)",
          from: "api",
          to: "broker",
          technology: "Kafka",
          fields: [],
        },
        {
          entity: "relation",
          action: "removed",
          severity: "structural",
          address: "relation:web→legacy",
          from: "web",
          to: "legacy",
          fields: [],
        },
      ]),
    );
    expect(text).toContain("api → broker");
    expect(text).toContain("Kafka");
    expect(text).toContain("web → legacy");
  });

  it("renders relation renamed/moved via the future-proofing branch", () => {
    // Relations don't currently emit renamed/moved, but the renderer
    // keeps a branch for forward-compat. Drive it directly so the
    // path stays covered if the differ ever starts producing them.
    const text = render(
      envelopeFor([
        {
          entity: "relation",
          action: "renamed",
          severity: "structural",
          address: "relation:api→db",
          from: "api",
          to: "db",
          fields: [{ field: "technology", before: "HTTP", after: "gRPC" }],
        },
        {
          entity: "relation",
          action: "moved",
          severity: "structural",
          address: "relation:web→api",
          from: "web",
          to: "api",
          fields: [],
        },
      ]),
    );
    expect(text).toContain("api → db");
    expect(text).toContain("web → api");
    expect(text).toContain("HTTP");
    expect(text).toContain("gRPC");
  });

  it("falls back to JSON.stringify for exotic field values (symbol)", () => {
    // A symbol isn't undefined/null/array/object/string/number/boolean,
    // so it hits the final JSON.stringify fallback in formatFieldValue.
    // JSON.stringify(symbol) yields `undefined` — no throw — which is
    // exactly the branch we want to exercise.
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "modified",
          severity: "semantic",
          address: "element:x",
          name: "x",
          kind: "Container",
          fields: [
            {
              field: "order",
              before: Symbol("a"),
              after: 2,
            },
          ],
        },
      ]),
    );
    expect(text).toContain("order");
  });

  it("renders relation modified with field summary", () => {
    const text = render(
      envelopeFor([
        {
          entity: "relation",
          action: "modified",
          severity: "semantic",
          address: "relation:api→db",
          from: "api",
          to: "db",
          technology: "CockroachDB",
          fields: [
            { field: "technology", before: "Postgres", after: "CockroachDB" },
          ],
        },
      ]),
    );
    expect(text).toContain("api → db");
    expect(text).toContain("Postgres");
    expect(text).toContain("CockroachDB");
  });

  it("renders architectural change groups before primitive changes", () => {
    const text = render(
      envelopeFor(
        [
          {
            entity: "relation",
            action: "modified",
            severity: "semantic",
            address: "relation:api→db",
            from: "api",
            to: "db",
            fields: [{ field: "technology", before: "HTTP", after: "Kafka" }],
          },
        ],
        [
          {
            id: "group:technologySwapped:api:db:HTTP:Kafka",
            kind: "technologySwapped",
            title: "api → db technology changed from HTTP to Kafka",
            severity: "semantic",
            confidence: 1,
            changeAddresses: ["relation:api→db"],
          },
        ],
      ),
    );

    expect(text).toContain("Group");
    expect(text).toContain("api → db technology changed from HTTP to Kafka");
    expect(text).toContain("confidence 1.00");
  });

  it("renders workspace modified line when severity is non-cosmetic", () => {
    // Use semantic so it isn't folded into the cosmetic-collapse line.
    // (Real workspace.name changes happen to be cosmetic, but the
    // renderer still needs to handle workspace entities — agents or
    // future field kinds may produce non-cosmetic workspace changes.)
    const text = render(
      envelopeFor([
        {
          entity: "workspace",
          action: "modified",
          severity: "semantic",
          address: "workspace",
          fields: [{ field: "workspace.name", before: "Old", after: "New" }],
        },
      ]),
    );
    expect(text).toContain("Workspace");
    expect(text).toContain("Old");
    expect(text).toContain("New");
  });

  it("collapses cosmetic-only changes into a single `+N cosmetic` line", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "modified",
          severity: "cosmetic",
          address: "element:a",
          name: "a",
          kind: "Container",
          fields: [{ field: "label", before: "Old", after: "New" }],
        },
        {
          entity: "element",
          action: "modified",
          severity: "cosmetic",
          address: "element:b",
          name: "b",
          kind: "Container",
          fields: [{ field: "label", before: "Old", after: "New" }],
        },
      ]),
    );
    expect(text).toContain("2 cosmetic");
    // Cosmetic detail lines themselves should NOT show
    expect(text).not.toMatch(/Element\s+a\s+label/);
  });

  it("renders `1 cosmetic change` singular when count is 1", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "modified",
          severity: "cosmetic",
          address: "element:a",
          name: "a",
          kind: "Container",
          fields: [{ field: "label", before: "Old", after: "New" }],
        },
      ]),
    );
    expect(text).toContain("1 cosmetic change ");
  });

  it("formats number and boolean field values via String() coercion", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "modified",
          severity: "semantic",
          address: "element:x",
          name: "x",
          kind: "Container",
          fields: [
            { field: "external", before: false, after: true },
            { field: "order", before: 1, after: 2 },
          ],
        },
      ]),
    );
    expect(text).toContain("false");
    expect(text).toContain("true");
    expect(text).toContain("1");
    expect(text).toContain("2");
  });

  it("formats undefined field value as em-dash", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "modified",
          severity: "semantic",
          address: "element:x",
          name: "x",
          kind: "Container",
          fields: [{ field: "technology", before: undefined, after: "HTTP" }],
        },
      ]),
    );
    expect(text).toContain("—");
  });

  it("renders set delta with only removed entries (no added)", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "modified",
          severity: "semantic",
          address: "element:x",
          name: "x",
          kind: "Container",
          fields: [
            {
              field: "tags",
              before: ["a", "b"],
              after: ["a"],
              removed: ["b"],
            },
          ],
        },
      ]),
    );
    expect(text).toContain("tags -[b]");
  });

  it("renders field with added/removed set delta differently from before/after", () => {
    const text = render(
      envelopeFor([
        {
          entity: "element",
          action: "modified",
          severity: "semantic",
          address: "element:api",
          name: "api",
          kind: "Container",
          fields: [
            {
              field: "tags",
              before: ["a"],
              after: ["a", "b"],
              added: ["b"],
            },
          ],
        },
      ]),
    );
    expect(text).toContain("tags +[b]");
  });
});
