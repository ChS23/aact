import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { runCommand } from "citty";

import type { AactConfig } from "../../../src/config";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock("../../../src/cli/loadConfig", () => ({
  loadAndValidateConfig: vi.fn(),
}));

// Per-test toggle for what `@aact/view` looks like to the SUT.
// `vi.hoisted` lifts this above any `vi.mock` factory so the module-
// graph mock can reach it before any module body runs.
const companionState = vi.hoisted(() => {
  type Behaviour =
    | "ok"
    | "no-runWorkbench"
    | "throw-not-found-code"
    | "throw-cannot-find-module"
    | "throw-cannot-find-package"
    | "throw-other"
    | "throw-string";
  type State = {
    behaviour: Behaviour;
    runWorkbench: unknown;
  };
  const state: State = { behaviour: "ok", runWorkbench: undefined };
  return state;
});

// The mocked module exposes `runWorkbench` as a getter so we can
// re-route the SUT's behaviour per test without re-running the
// `vi.mock` factory (which only runs once per module-graph reset).
// The getter inspects `companionState.behaviour` at the moment the
// SUT awaits and reads `mod.runWorkbench`. To simulate ESM import
// failures (MODULE_NOT_FOUND, etc.), the getter throws — the throw
// happens during the SUT's `typeof mod.runWorkbench` check inside
// `importCompanion`, which is the same try-catch site that would
// otherwise catch a real failed `await import(...)`.
vi.mock("@aact/view", () => ({
  get runWorkbench() {
    const b = companionState.behaviour;
    if (b === "throw-not-found-code") {
      const err: NodeJS.ErrnoException = new Error("not found");
      err.code = "ERR_MODULE_NOT_FOUND";
      throw err;
    }
    if (b === "throw-cannot-find-module") {
      throw new Error("Cannot find module '@aact/view'");
    }
    if (b === "throw-cannot-find-package") {
      throw new Error(
        "Cannot find package '@aact/view' imported from /work/x.js",
      );
    }
    if (b === "throw-other") {
      throw new Error("syntax error inside companion");
    }
    if (b === "throw-string") {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "string thrown";
    }
    if (b === "no-runWorkbench") return;
    // Happy path — trampoline through the per-test mock.
    return (...args: unknown[]) => {
      const rw = companionState.runWorkbench as
        | ((...a: unknown[]) => unknown)
        | undefined;
      if (typeof rw !== "function") {
        throw new TypeError("runWorkbench mock not configured for this test");
      }
      return rw(...args);
    };
  },
}));

vi.mock("consola", () => ({
  default: { prompt: vi.fn() },
}));

const mockSpawn = vi.mocked(spawn);
const mockExistsSync = vi.mocked(existsSync);

const baseConfig: AactConfig = {
  source: { type: "plantuml", path: "test.puml" },
};

const loadView = async (): Promise<
  typeof import("../../../src/cli/commands/view")
> => {
  vi.resetModules();
  return import("../../../src/cli/commands/view");
};

const resetCompanionState = (): void => {
  companionState.behaviour = "ok";
  companionState.runWorkbench = vi
    .fn()
    .mockResolvedValue({ exitCode: 0, url: null });
};

beforeEach(() => {
  resetCompanionState();
  mockSpawn.mockReset();
  mockExistsSync.mockReset();
  mockExistsSync.mockReturnValue(false);
});

describe("executeView — happy path", () => {
  it("returns envelope with URL when companion runWorkbench resolves", async () => {
    const runWorkbench = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, url: "http://localhost:7314" });
    companionState.runWorkbench = runWorkbench;
    const { executeView } = await loadView();

    const result = await executeView(baseConfig, {}, "/abs/aact.config.ts");

    expect(result.exitCode).toBe(0);
    expect(result.data).toEqual({
      companion: "@aact/view",
      url: "http://localhost:7314",
    });
    expect(runWorkbench).toHaveBeenCalledWith({
      config: baseConfig,
      configPath: "/abs/aact.config.ts",
      noOpen: false,
    });
  });

  it("forwards --port as integer to runWorkbench", async () => {
    const runWorkbench = vi.fn().mockResolvedValue({ exitCode: 0, url: "u" });
    companionState.runWorkbench = runWorkbench;
    const { executeView } = await loadView();

    await executeView(baseConfig, { port: "8080" }, null);

    expect(runWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8080 }),
    );
  });

  it("forwards --no-open: true when flag is set", async () => {
    const runWorkbench = vi.fn().mockResolvedValue({ exitCode: 0, url: "u" });
    companionState.runWorkbench = runWorkbench;
    const { executeView } = await loadView();

    await executeView(baseConfig, { "no-open": true }, null);

    expect(runWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({ noOpen: true }),
    );
  });

  it("forwards --diff baseline and --diff-format to runWorkbench", async () => {
    const runWorkbench = vi.fn().mockResolvedValue({ exitCode: 0, url: "u" });
    companionState.runWorkbench = runWorkbench;
    const { executeView } = await loadView();

    await executeView(
      baseConfig,
      { diff: "main:architecture.puml", "diff-format": "plantuml" },
      null,
    );

    expect(runWorkbench).toHaveBeenCalledWith(
      expect.objectContaining({
        diffBaseline: "main:architecture.puml",
        diffBaselineFormat: "plantuml",
      }),
    );
  });

  it("handles url null cleanly when companion never bound a port", async () => {
    companionState.runWorkbench = vi
      .fn()
      .mockResolvedValue({ exitCode: 2, url: null });
    const { executeView } = await loadView();

    const result = await executeView(baseConfig, {}, null);

    expect(result.exitCode).toBe(2);
    expect(result.data.url).toBeNull();
  });

  it("normalises missing url field to null on envelope", async () => {
    companionState.runWorkbench = vi.fn().mockResolvedValue({ exitCode: 0 });
    const { executeView } = await loadView();

    const result = await executeView(baseConfig, {}, null);
    expect(result.data.url).toBeNull();
  });

  it("propagates exitCode 2 from companion (boot / port collision)", async () => {
    companionState.runWorkbench = vi
      .fn()
      .mockResolvedValue({ exitCode: 2, url: "http://localhost:7314" });
    const { executeView } = await loadView();

    const result = await executeView(baseConfig, {}, null);
    expect(result.exitCode).toBe(2);
    expect(result.data.url).toBe("http://localhost:7314");
  });
});

describe("executeView — port validation", () => {
  it("throws ToolError when --port is not numeric", async () => {
    const runWorkbench = vi.fn().mockResolvedValue({ exitCode: 0, url: "u" });
    companionState.runWorkbench = runWorkbench;
    const { executeView } = await loadView();

    await expect(
      executeView(baseConfig, { port: "not-a-port" }, null),
    ).rejects.toMatchObject({
      name: "ToolError",
      kind: "view.bootFailed",
      message: expect.stringContaining("--port must be an integer"),
    });
    expect(runWorkbench).not.toHaveBeenCalled();
  });

  it("rejects --port values with numeric suffixes", async () => {
    const runWorkbench = vi.fn().mockResolvedValue({ exitCode: 0, url: "u" });
    companionState.runWorkbench = runWorkbench;
    const { executeView } = await loadView();

    await expect(
      executeView(baseConfig, { port: "123abc" }, null),
    ).rejects.toMatchObject({
      name: "ToolError",
      kind: "view.bootFailed",
      message: expect.stringContaining("--port must be an integer"),
    });
    expect(runWorkbench).not.toHaveBeenCalled();
  });

  it("rejects --port values outside 0..65535", async () => {
    const runWorkbench = vi.fn().mockResolvedValue({ exitCode: 0, url: "u" });
    companionState.runWorkbench = runWorkbench;
    const { executeView } = await loadView();

    await expect(
      executeView(baseConfig, { port: "70000" }, null),
    ).rejects.toMatchObject({
      name: "ToolError",
      kind: "view.bootFailed",
      message: expect.stringContaining("0..65535"),
    });
    expect(runWorkbench).not.toHaveBeenCalled();
  });
});

describe("executeView — companion module loading", () => {
  it("throws view.bootFailed when companion has no runWorkbench", async () => {
    companionState.behaviour = "no-runWorkbench";
    const { executeView } = await loadView();

    await expect(executeView(baseConfig, {}, null)).rejects.toMatchObject({
      name: "ToolError",
      kind: "view.bootFailed",
      message: expect.stringContaining("does not export runWorkbench"),
    });
  });

  // NOTE: tests for `import("@aact/view")` failure paths
  // (non-MODULE_NOT_FOUND import error, string throw, companion-
  // missing prompt/install flow) ARE possible only by mocking
  // dynamic-import resolution — vi.mock'ing @aact/view as a registered
  // module makes the import always succeed. Closing those paths needs
  // either a refactor in view.ts to make `importCompanion` injectable,
  // or an e2e test that runs aact view in an isolated env where the
  // companion is genuinely absent. Skipped here for that reason.
});

describe("view (citty CommandDef) — renderViewText path", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);

    const { loadAndValidateConfig } =
      await import("../../../src/cli/loadConfig");
    vi.mocked(loadAndValidateConfig).mockResolvedValue({
      config: baseConfig,
      configPath: "/abs/aact.config.ts",
    });
  });

  const capturedStdout = (): string =>
    stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");

  it("renders URL in human-mode session-end banner", async () => {
    companionState.runWorkbench = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, url: "http://localhost:7314" });

    const { view } = await loadView();
    await runCommand(view, { rawArgs: [] });

    expect(capturedStdout()).toContain("aact view session ended");
    expect(capturedStdout()).toContain("http://localhost:7314");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("renders bare session-end banner when url is null", async () => {
    companionState.runWorkbench = vi
      .fn()
      .mockResolvedValue({ exitCode: 0, url: null });

    const { view } = await loadView();
    await runCommand(view, { rawArgs: [] });

    const out = capturedStdout();
    expect(out).toContain("aact view session ended");
    // No URL substring on the bare line.
    expect(out).not.toMatch(/https?:\/\//);
  });
});
