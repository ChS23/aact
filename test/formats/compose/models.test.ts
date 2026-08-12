import {
  buildAiModelElement,
  buildAiModelRelation,
} from "../../../src/formats/compose/models";
import type { ResolvedOptions } from "../../../src/formats/compose/types";

const resolved = (
  override: Partial<{
    defaultTags: readonly string[];
    relationDescription: string;
  }> = {},
): ResolvedOptions =>
  Object.freeze({
    applyNaming: (raw: string) => raw,
    labels: Object.freeze({
      element: "aact.element",
      kind: "aact.kind",
      label: "aact.label",
      description: "aact.description",
      technology: "aact.technology",
      tags: "aact.tags",
      external: "aact.external",
      link: "aact.link",
      skip: "aact.skip",
    }),
    imageHeuristic: Object.freeze([]),
    skip: Object.freeze([]),
    overrides: Object.freeze([]),
    profiles: Object.freeze([]),
    providers: Object.freeze({ defaultTags: Object.freeze(["provider"]) }),
    models: Object.freeze({
      defaultTags: Object.freeze([
        ...(override.defaultTags ?? ["ai", "model"]),
      ]),
      relationDescription: override.relationDescription ?? "uses AI model",
    }),
  });

describe("buildAiModelElement", () => {
  it("builds external System Element with technology 'AI model'", () => {
    const el = buildAiModelElement(
      {
        name: "llama3",
        label: "Llama 3",
        parsed: { model: "ai/llama3.2" },
      },
      resolved(),
    );
    expect(el.kind).toBe("System");
    expect(el.external).toBe(true);
    expect(el.technology).toBe("AI model");
    expect(el.description).toBe("ai/llama3.2");
    expect([...el.tags]).toEqual(["ai", "model"]);
    expect(el.relations).toEqual([]);
  });

  it("attaches sourceLocation when provided", () => {
    const loc = {
      file: "compose.yml",
      start: { line: 2, col: 3, offset: 12 },
      end: { line: 2, col: 8, offset: 17 },
    } as const;
    const el = buildAiModelElement(
      {
        name: "llama3",
        label: "Llama 3",
        parsed: { model: "ai/llama3.2" },
        sourceLocation: loc,
      },
      resolved(),
    );
    expect(el.sourceLocation).toEqual(loc);
  });

  it("omits sourceLocation when undefined", () => {
    const el = buildAiModelElement(
      {
        name: "llama3",
        label: "Llama 3",
        parsed: { model: "ai/llama3.2" },
      },
      resolved(),
    );
    expect("sourceLocation" in el).toBe(false);
  });

  it("uses custom defaultTags when configured", () => {
    const el = buildAiModelElement(
      {
        name: "llama3",
        label: "Llama 3",
        parsed: { model: "ai/llama3.2" },
      },
      resolved({ defaultTags: ["llm", "external"] }),
    );
    expect([...el.tags]).toEqual(["llm", "external"]);
  });

  it("freezes returned element", () => {
    const el = buildAiModelElement(
      {
        name: "x",
        label: "X",
        parsed: { model: "ai/x" },
      },
      resolved(),
    );
    expect(Object.isFrozen(el)).toBe(true);
  });
});

describe("buildAiModelRelation", () => {
  it("uses default description 'uses AI model'", () => {
    const rel = buildAiModelRelation("llama3", resolved());
    expect(rel.to).toBe("llama3");
    expect(rel.description).toBe("uses AI model");
    expect(rel.tags).toEqual([]);
  });

  it("uses custom relation description from options", () => {
    const rel = buildAiModelRelation(
      "llama3",
      resolved({ relationDescription: "calls model" }),
    );
    expect(rel.description).toBe("calls model");
  });

  it("attaches sourceLocation when supplied", () => {
    const loc = {
      file: "compose.yml",
      start: { line: 7, col: 5, offset: 80 },
      end: { line: 7, col: 12, offset: 87 },
    } as const;
    const rel = buildAiModelRelation("llama3", resolved(), loc);
    expect(rel.sourceLocation).toEqual(loc);
  });

  it("omits sourceLocation when undefined", () => {
    const rel = buildAiModelRelation("llama3", resolved());
    expect("sourceLocation" in rel).toBe(false);
  });

  it("freezes returned relation", () => {
    const rel = buildAiModelRelation("llama3", resolved());
    expect(Object.isFrozen(rel)).toBe(true);
  });
});
