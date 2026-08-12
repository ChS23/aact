import type { ArgsDef } from "citty";

/**
 * Shared CLI arg fragments. Spread into each subcommand's `args` block so
 * the definition lives in one place and stays consistent across commands.
 *
 * citty 0.2.x does not propagate parent-level args into subcommand contexts,
 * which is why these are shared shapes rather than a top-level declaration.
 */

export const configArg = {
  config: {
    type: "string",
    description:
      "Path to aact config file (defaults to c12 auto-discovery from cwd)",
  },
} as const satisfies ArgsDef;

export const jsonArg = {
  json: {
    type: "boolean",
    description:
      "Emit JSON envelope on stdout (machine-readable for CI / agents)",
  },
} as const satisfies ArgsDef;

export const sarifArg = {
  sarif: {
    type: "boolean",
    description:
      "Emit SARIF v2.1.0 on stdout (uploadable to GitHub Code Scanning, " +
      "SonarQube, etc.). Outranks --json if both are set.",
  },
} as const satisfies ArgsDef;
