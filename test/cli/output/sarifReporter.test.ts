import type {
  CliEnvelope,
  SarifAdapter,
  SarifLog,
} from "../../../src/cli/output";
import { SarifReporter } from "../../../src/cli/output/sarifReporter";

const baseEnvelope: CliEnvelope<{ ok: boolean }> = {
  schemaVersion: 1,
  command: "analyze",
  ok: true,
  exitCode: 0,
  data: { ok: true },
  diagnostics: [],
  meta: {
    aactVersion: "3.0.0-test",
    durationMs: 1,
    configPath: null,
    source: null,
  },
};

describe("SarifReporter", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  const captured = (): string =>
    stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");

  it("emits a valid empty SARIF log when no adapter is supplied", () => {
    new SarifReporter().emit({ envelope: baseEnvelope });
    const log = JSON.parse(captured()) as SarifLog;
    expect(log.version).toBe("2.1.0");
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].results).toEqual([]);
    expect(log.runs[0].tool.driver.name).toBe("aact");
    expect(log.runs[0].tool.driver.version).toBe("3.0.0-test");
  });

  it("delegates to the supplied adapter when given one", () => {
    const adapter: SarifAdapter<{ ok: boolean }> = (env) => ({
      $schema: "https://example.com/sarif",
      version: "2.1.0",
      runs: [
        {
          tool: {
            driver: {
              name: "custom-driver",
              version: env.meta.aactVersion,
            },
          },
          results: [],
        },
      ],
    });

    new SarifReporter(adapter).emit({
      envelope: baseEnvelope,
    });

    const log = JSON.parse(captured()) as SarifLog;
    expect(log.runs[0].tool.driver.name).toBe("custom-driver");
    expect(log.runs[0].tool.driver.version).toBe("3.0.0-test");
  });

  it("appends a trailing newline so stdout-piped consumers see a complete document", () => {
    new SarifReporter().emit({ envelope: baseEnvelope });
    expect(captured().endsWith("\n")).toBe(true);
  });

  it("emits an error log with invocations when envelope is exit 2 (data=null)", () => {
    // Reproduces the `aact check --config missing.ts --sarif` crash:
    // run.ts builds an error envelope (exit 2, data null) and the
    // adapter would dereference null. The reporter short-circuits.
    const errorEnvelope: CliEnvelope<null> = {
      schemaVersion: 1,
      command: "check",
      ok: false,
      exitCode: 2,
      data: null,
      diagnostics: [
        {
          kind: "config.loadFailed",
          message: "missing.ts not found",
          severity: "warning",
        },
      ],
      meta: {
        aactVersion: "3.0.0-test",
        durationMs: 1,
        configPath: "./missing.ts",
        source: null,
      },
    };

    // Adapter that would crash on data=null — should NOT be called.
    const crashingAdapter = vi.fn(() => {
      throw new Error("adapter should not run on error envelope");
    });

    new SarifReporter(crashingAdapter).emit({ envelope: errorEnvelope });
    const log = JSON.parse(captured()) as SarifLog;

    expect(crashingAdapter).not.toHaveBeenCalled();
    expect(log.runs[0].results).toEqual([]);
    expect(log.runs[0].invocations).toHaveLength(1);
    const inv = log.runs[0].invocations?.[0];
    expect(inv?.executionSuccessful).toBe(false);
    expect(inv?.exitCode).toBe(2);
    expect(inv?.toolExecutionNotifications).toHaveLength(1);
    const [note] = inv?.toolExecutionNotifications ?? [];
    expect(note.level).toBe("error");
    expect(note.descriptor?.id).toBe("config.loadFailed");
    expect(note.message.text).toContain("missing.ts");
  });
});
