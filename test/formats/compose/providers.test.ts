import { buildProviderElement } from "../../../src/formats/compose/providers";
import type {
  ComposeProvider,
  ResolvedOptions,
} from "../../../src/formats/compose/types";

const baseResolved = (
  defaultTags: readonly string[] = ["provider"],
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
    providers: Object.freeze({
      defaultTags: Object.freeze([...defaultTags]),
    }),
    models: Object.freeze({
      defaultTags: Object.freeze(["ai", "model"]),
      relationDescription: "uses AI model",
    }),
  });

const provider: ComposeProvider = { type: "model" };

describe("buildProviderElement", () => {
  it("produces external System element", () => {
    const el = buildProviderElement(
      {
        name: "openai",
        label: "OpenAI",
        description: "",
        provider,
        extraTags: [],
      },
      baseResolved(),
    );
    expect(el.kind).toBe("System");
    expect(el.external).toBe(true);
    expect(el.name).toBe("openai");
    expect(el.label).toBe("OpenAI");
    expect(el.technology).toBe("model");
  });

  it("synthesizes description from provider.type when none supplied", () => {
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "",
        provider: { type: "ollama" },
        extraTags: [],
      },
      baseResolved(),
    );
    expect(el.description).toBe("via Compose provider (ollama)");
  });

  it("preserves explicit description", () => {
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "Hosted LLM",
        provider,
        extraTags: [],
      },
      baseResolved(),
    );
    expect(el.description).toBe("Hosted LLM");
  });

  it("merges defaultTags with extraTags (deduped)", () => {
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "",
        provider,
        extraTags: ["llm", "provider", "critical"],
      },
      baseResolved(["provider"]),
    );
    expect([...el.tags].toSorted()).toEqual(["critical", "llm", "provider"]);
  });

  it("uses custom defaultTags when configured", () => {
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "",
        provider,
        extraTags: [],
      },
      baseResolved(["external", "managed"]),
    );
    expect([...el.tags]).toEqual(["external", "managed"]);
  });

  it("attaches sourceLocation when provided", () => {
    const loc = {
      file: "compose.yml",
      start: { line: 5, col: 1, offset: 50 },
      end: { line: 5, col: 8, offset: 57 },
    } as const;
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "",
        provider,
        extraTags: [],
        sourceLocation: loc,
      },
      baseResolved(),
    );
    expect(el.sourceLocation).toEqual(loc);
  });

  it("omits sourceLocation when undefined", () => {
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "",
        provider,
        extraTags: [],
      },
      baseResolved(),
    );
    expect("sourceLocation" in el).toBe(false);
  });

  it("attaches link and properties when provided", () => {
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "",
        provider,
        extraTags: [],
        link: "https://docs.example.com",
        properties: { region: "eu-west-1" },
      },
      baseResolved(),
    );
    expect(el.link).toBe("https://docs.example.com");
    expect(el.properties).toEqual({ region: "eu-west-1" });
  });

  it("omits link and properties when undefined", () => {
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "",
        provider,
        extraTags: [],
      },
      baseResolved(),
    );
    expect("link" in el).toBe(false);
    expect("properties" in el).toBe(false);
  });

  it("freezes returned element", () => {
    const el = buildProviderElement(
      {
        name: "x",
        label: "X",
        description: "",
        provider,
        extraTags: [],
      },
      baseResolved(),
    );
    expect(Object.isFrozen(el)).toBe(true);
  });
});
