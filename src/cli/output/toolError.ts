import type { Diagnostic, DiagnosticKind } from "./types";

/**
 * Distinguishes tool-failure (config rot, missing source file, bad format)
 * from domain-failure (architecture violations). Tool-failure → exit 2;
 * domain-failure → exit 1. Agents branch on this distinction.
 */
export class ToolError extends Error {
  readonly kind: DiagnosticKind;
  readonly context?: Readonly<Record<string, string>>;

  constructor(
    kind: DiagnosticKind,
    message: string,
    context?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = "ToolError";
    this.kind = kind;
    this.context = context;
  }

  toDiagnostic(): Diagnostic {
    // A ToolError is always fatal (exit 2), so its diagnostic carries
    // `error` severity — not `warning`. Keeps the JSON/SARIF severity
    // consistent with the exit code it produced.
    return {
      kind: this.kind,
      message: this.message,
      severity: "error",
      ...(this.context ? { context: this.context } : {}),
    };
  }
}
