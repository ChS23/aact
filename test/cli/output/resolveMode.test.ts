import { resolveOutputMode } from "../../../src/cli/output/resolveMode";
import type { AactConfig } from "../../../src/config";

const baseConfig: AactConfig = {
  source: { type: "plantuml", path: "x.puml" },
};

describe("resolveOutputMode", () => {
  it("defaults to text when no input provided", () => {
    expect(resolveOutputMode({})).toBe("text");
  });

  it("returns json when CLI flag is true", () => {
    expect(resolveOutputMode({ cliJson: true })).toBe("json");
  });

  it("returns json when config.output.mode is json and CLI flag unset", () => {
    const config: AactConfig = {
      ...baseConfig,
      output: { mode: "json" },
    };
    expect(resolveOutputMode({ config })).toBe("json");
  });

  it("CLI flag wins over config", () => {
    const config: AactConfig = {
      ...baseConfig,
      output: { mode: "text" },
    };
    expect(resolveOutputMode({ cliJson: true, config })).toBe("json");
  });

  it("returns text when neither CLI nor config requests json", () => {
    const config: AactConfig = {
      ...baseConfig,
      output: { mode: "text" },
    };
    expect(resolveOutputMode({ cliJson: false, config })).toBe("text");
  });

  it("returns text when config has no output section", () => {
    expect(resolveOutputMode({ config: baseConfig })).toBe("text");
  });

  it("returns text when config is null", () => {
    expect(resolveOutputMode({ config: null })).toBe("text");
  });

  it("returns sarif when --sarif flag is set", () => {
    expect(resolveOutputMode({ cliSarif: true })).toBe("sarif");
  });

  it("returns sarif when config.output.mode is sarif and CLI flag unset", () => {
    const config: AactConfig = {
      ...baseConfig,
      output: { mode: "sarif" },
    };
    expect(resolveOutputMode({ config })).toBe("sarif");
  });

  it("--sarif outranks --json when both flags are passed", () => {
    expect(resolveOutputMode({ cliJson: true, cliSarif: true })).toBe("sarif");
  });

  it("--sarif beats config.output.mode = json", () => {
    const config: AactConfig = {
      ...baseConfig,
      output: { mode: "json" },
    };
    expect(resolveOutputMode({ cliSarif: true, config })).toBe("sarif");
  });
});
