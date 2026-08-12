import * as tty from "node:tty";

import { colors as ansiColors } from "consola/utils";

/**
 * Single colour-detection point for all text renderers.
 *
 * consola's global `colors` enables ANSI unconditionally on win32
 * (legacy cmd.exe had colour support but no $TERM), which leaks
 * escape codes into redirected output — `aact check > log.txt` on
 * Windows must come out as plain as it does on POSIX. Otherwise the
 * logic mirrors consola's: explicit force/disable wins, then an
 * interactive terminal ($TERM required only on POSIX — Windows
 * terminals don't set it), then well-known CI log renderers.
 *
 * Our predicate only ever *narrows* consola's (every force-on case —
 * FORCE_COLOR, --color, TTY, CI — is also force-on upstream), so
 * "off" is implemented as identity functions over the same surface.
 */
const env = process.env;
const isDisabled = "NO_COLOR" in env || process.argv.includes("--no-color");
const isForced = "FORCE_COLOR" in env || process.argv.includes("--color");
const isDumb = env.TERM === "dumb";
const isInteractive =
  tty.isatty(1) && !isDumb && (process.platform === "win32" || !!env.TERM);
const isCI =
  "CI" in env &&
  ("GITHUB_ACTIONS" in env || "GITLAB_CI" in env || "CIRCLECI" in env);

type ColorFunctions = typeof ansiColors;

const identityColors = Object.fromEntries(
  Object.keys(ansiColors).map((name) => [name, String]),
) as unknown as ColorFunctions;

export const colors: ColorFunctions =
  !isDisabled && (isForced || isInteractive || isCI)
    ? ansiColors
    : identityColors;
