import { runCommand } from "citty";
import path from "pathe";

import { ToolError } from "../../src/cli/output";
import { cliCommand, cliCommandWithConfig } from "../../src/cli/run";

vi.mock("../../src/cli/loadConfig", () => ({
  loadAndValidateConfig: vi.fn(),
}));

const { loadAndValidateConfig } = await import("../../src/cli/loadConfig");
const mockLoadConfig = vi.mocked(loadAndValidateConfig);

// vitest.config.ts has `restoreMocks: true`, which auto-restores spies between
// tests. So we (re-)create the spies in beforeEach and rely on the global
// reset to clean up. process.exit gets swallowed to keep the worker alive;
// stdout/stderr are captured for envelope assertions.
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
});

const capturedStdout = (): string =>
  stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");

const capturedStderr = (): string =>
  stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");

describe("cliCommand (no config)", () => {
  it("emits envelope and exits 0 on success", async () => {
    const cmd = cliCommand({
      name: "noop",
      meta: { name: "noop" },
      args: {},
      renderText: (_, sink) => sink.write("HUMAN\n"),
      execute: () => Promise.resolve({ data: { ok: true }, exitCode: 0 }),
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(capturedStdout()).toContain("HUMAN");
  });

  it("emits JSON envelope when --json flag is passed", async () => {
    const cmd = cliCommand({
      name: "noop",
      meta: { name: "noop" },
      args: { json: { type: "boolean" } },
      renderText: (_, sink) => sink.write("HUMAN\n"),
      execute: () => Promise.resolve({ data: { ok: true }, exitCode: 0 }),
    });

    await runCommand(cmd, { rawArgs: ["--json"] });

    const out = capturedStdout();
    const env = JSON.parse(out) as { command: string; ok: boolean };
    expect(env.command).toBe("noop");
    expect(env.ok).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("propagates execute exitCode to process.exit", async () => {
    const cmd = cliCommand({
      name: "fail",
      meta: { name: "fail" },
      args: {},
      renderText: () => {},
      execute: () => Promise.resolve({ data: null, exitCode: 1 }),
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("converts thrown error into exit 2 envelope", async () => {
    const cmd = cliCommand({
      name: "boom",
      meta: { name: "boom" },
      args: {},
      renderText: () => {},
      execute: () => Promise.reject(new Error("kaboom")),
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(capturedStderr()).toMatch(/kaboom/);
  });

  it("converts ToolError into a typed diagnostic kind", async () => {
    const cmd = cliCommand({
      name: "boom",
      meta: { name: "boom" },
      args: { json: { type: "boolean" } },
      renderText: () => {},
      execute: () =>
        Promise.reject(
          new ToolError("format.unknown", "no such format", { fmt: "x" }),
        ),
    });

    await runCommand(cmd, { rawArgs: ["--json"] });

    const env = JSON.parse(capturedStdout()) as {
      diagnostics: { kind: string; context?: Record<string, string> }[];
    };
    expect(env.diagnostics[0].kind).toBe("format.unknown");
    expect(env.diagnostics[0].context).toEqual({ fmt: "x" });
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("does not write to stdout when execute claims it", async () => {
    const cmd = cliCommand({
      name: "stream",
      meta: { name: "stream" },
      args: {},
      renderText: (_, sink) => sink.write("rendered\n"),
      execute: () =>
        Promise.resolve({
          data: null,
          exitCode: 0,
          stdoutClaimed: true,
        }),
    });

    await runCommand(cmd, { rawArgs: [] });

    // Human reporter renders to stderr when stdout is claimed by the command
    expect(capturedStderr()).toContain("rendered");
  });
});

describe("cliCommandWithConfig", () => {
  const fakeConfig = {
    source: { type: "plantuml" as const, path: "./arch.puml" },
    rules: {},
    customRules: [],
  };
  const fakeLoaded = {
    config: fakeConfig,
    configPath: "/abs/path/aact.config.ts",
  };

  it("invokes execute with loaded config", async () => {
    mockLoadConfig.mockResolvedValue(fakeLoaded);
    const execute = vi
      .fn()
      .mockResolvedValue({ data: { ok: true }, exitCode: 0 });

    const cmd = cliCommandWithConfig({
      name: "needs-cfg",
      meta: { name: "needs-cfg" },
      args: {},
      renderText: () => {},
      execute,
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(execute).toHaveBeenCalledWith(expect.anything(), fakeConfig, {
      configPath: fakeLoaded.configPath,
      source: path.resolve(fakeConfig.source.path),
    });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("emits config-load failure as exit 2 envelope without invoking execute", async () => {
    mockLoadConfig.mockRejectedValue(
      new ToolError("config.loadFailed", "broken", { path: "x" }),
    );
    const execute = vi.fn();

    const cmd = cliCommandWithConfig({
      name: "needs-cfg",
      meta: { name: "needs-cfg" },
      args: { json: { type: "boolean" }, config: { type: "string" } },
      renderText: () => {},
      execute,
    });

    await runCommand(cmd, { rawArgs: ["--json", "--config=./aact.config.ts"] });

    expect(execute).not.toHaveBeenCalled();
    const env = JSON.parse(capturedStdout()) as {
      exitCode: number;
      diagnostics: { kind: string }[];
      meta: { configPath: string | null };
    };
    expect(env.exitCode).toBe(2);
    expect(env.diagnostics[0].kind).toBe("config.loadFailed");
    expect(env.meta.configPath).toBe("./aact.config.ts");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("wraps non-ToolError config rejection as internal.unexpected", async () => {
    mockLoadConfig.mockRejectedValue(new Error("surprise"));

    const cmd = cliCommandWithConfig({
      name: "needs-cfg",
      meta: { name: "needs-cfg" },
      args: { json: { type: "boolean" } },
      renderText: () => {},
      execute: () => Promise.resolve({ data: null, exitCode: 0 }),
    });

    await runCommand(cmd, { rawArgs: ["--json"] });

    const env = JSON.parse(capturedStdout()) as {
      diagnostics: { kind: string; message: string }[];
    };
    expect(env.diagnostics[0].kind).toBe("internal.unexpected");
    expect(env.diagnostics[0].message).toBe("surprise");
  });

  it("converts execute throw into exit 2 envelope with source from config", async () => {
    mockLoadConfig.mockResolvedValue(fakeLoaded);

    const cmd = cliCommandWithConfig({
      name: "needs-cfg",
      meta: { name: "needs-cfg" },
      args: { json: { type: "boolean" } },
      renderText: () => {},
      execute: () =>
        Promise.reject(new ToolError("model.parseError", "bad", { path: "x" })),
    });

    await runCommand(cmd, { rawArgs: ["--json"] });

    const env = JSON.parse(capturedStdout()) as {
      exitCode: number;
      diagnostics: { kind: string }[];
      meta: { source: string | null };
    };
    expect(env.exitCode).toBe(2);
    expect(env.diagnostics[0].kind).toBe("model.parseError");
    // meta.source is canonicalised to an absolute path so it lines
    // up with the absolute configPath emitted by c12 — the JSON
    // envelope shouldn't mix conventions for the two file fields.
    expect(env.meta.source).toBe(path.resolve("./arch.puml"));
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("propagates execute exitCode in success path", async () => {
    mockLoadConfig.mockResolvedValue(fakeLoaded);

    const cmd = cliCommandWithConfig({
      name: "needs-cfg",
      meta: { name: "needs-cfg" },
      args: {},
      renderText: () => {},
      execute: () => Promise.resolve({ data: null, exitCode: 1 }),
    });

    await runCommand(cmd, { rawArgs: [] });

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
