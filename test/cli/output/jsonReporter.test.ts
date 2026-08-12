import { JsonReporter } from "../../../src/cli/output/jsonReporter";
import type { CommandResult } from "../../../src/cli/output/types";

const makeResult = (data: unknown): CommandResult<unknown> => ({
  envelope: {
    schemaVersion: 1,
    command: "analyze",
    ok: true,
    exitCode: 0,
    data,
    diagnostics: [],
    meta: {
      aactVersion: "test",
      durationMs: 1,
      configPath: null,
      source: "test.puml",
    },
  },
});

describe("JsonReporter", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  const captured: string[] = [];

  beforeEach(() => {
    captured.length = 0;
    writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        captured.push(
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
        );
        return true;
      });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("emits envelope as pretty JSON on stdout with trailing newline", () => {
    new JsonReporter().emit(makeResult({ ok: true }));

    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatch(/\n$/);
    const parsed = JSON.parse(captured[0]) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.command).toBe("analyze");
    expect(parsed.ok).toBe(true);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.data).toEqual({ ok: true });
  });

  it("preserves diagnostic structure verbatim", () => {
    const result = makeResult(null);
    const withDiag: CommandResult<unknown> = {
      envelope: {
        ...result.envelope,
        diagnostics: [
          {
            kind: "model.duplicateElementName",
            message: "Duplicate element name 'foo'",
            severity: "warning",
            context: { name: "foo" },
          },
        ],
      },
    };

    new JsonReporter().emit(withDiag);
    const parsed = JSON.parse(captured[0]) as { diagnostics: unknown[] };
    expect(parsed.diagnostics).toEqual([
      {
        kind: "model.duplicateElementName",
        message: "Duplicate element name 'foo'",
        severity: "warning",
        context: { name: "foo" },
      },
    ]);
  });

  it("does not write to stderr regardless of envelope content", () => {
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    new JsonReporter().emit(makeResult({}));

    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
