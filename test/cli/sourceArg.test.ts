import { ToolError } from "../../src/cli/output";
import { applyPositionalSource } from "../../src/cli/sourceArg";
import type { AactConfig } from "../../src/config";

const CONFIG: AactConfig = {
  source: { path: "./configured.puml", type: "plantuml" },
  rules: { crud: true },
};

const DSL = "examples/kubernetes-drift/architecture.dsl";
const K8S_DIR = "examples/kubernetes-drift/k8s";

describe("applyPositionalSource", () => {
  it("returns the same config reference when no positional is given", async () => {
    const out = await applyPositionalSource(CONFIG, {});
    expect(out).toBe(CONFIG);
  });

  it("ignores an empty-string positional", async () => {
    const out = await applyPositionalSource(CONFIG, { source: "" });
    expect(out).toBe(CONFIG);
  });

  it("overrides config.source with a positional file (format from ext)", async () => {
    const out = await applyPositionalSource(CONFIG, { source: DSL });
    expect(out).not.toBe(CONFIG);
    expect(out?.source).toEqual({ path: DSL, type: "structurizr" });
    // configured rules are preserved on override
    expect(out?.rules).toEqual({ crud: true });
  });

  it("detects a directory positional as kubernetes", async () => {
    const out = await applyPositionalSource(CONFIG, { source: K8S_DIR });
    expect(out?.source).toEqual({ path: K8S_DIR, type: "kubernetes" });
  });

  it("synthesises a config (all built-ins enabled) when none was loaded", async () => {
    const out = await applyPositionalSource(null, { source: DSL });
    expect(out?.source).toEqual({ path: DSL, type: "structurizr" });
    expect(out?.rules?.crud).toBe(true);
    expect(out?.rules?.acyclic).toBe(true);
    expect(out?.rules?.dbPerService).toBe(true);
  });

  it("throws a ToolError when the format can't be inferred", async () => {
    await expect(
      applyPositionalSource(null, { source: "README.md" }),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it("infers format from a non-existent path by extension", async () => {
    // stat fails, but the extension still resolves — the loader will
    // report the missing file with a precise error later.
    const out = await applyPositionalSource(null, { source: "nope.dsl" });
    expect(out?.source.type).toBe("structurizr");
  });
});
