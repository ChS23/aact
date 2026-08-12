import path from "node:path";

import terminalLink from "terminal-link";

import type { SourceLocation } from "../../model";

/**
 * Terminal hyperlinks for source-location anchoring.
 *
 * The challenge with `file:line:col` Cmd-click navigation is that
 * **no single URL convention works across all terminal hosts**:
 *
 * - VSCode integrated terminal parses `file://<abs>:<line>:<col>`
 *   with its private terminal-link parser. Cursor inherits the
 *   same parser (Cursor is a VSCode fork). Plain `file://` URLs
 *   from the host OS handler can't carry `:line:col` — it's an
 *   internal convention.
 *
 * - Zed has built-in autodetection of `<file>:<line>:<col>` plain
 *   text. Wrapping it in OSC 8 with any external URL scheme
 *   bypasses Zed's "open in this Zed window" flow and routes
 *   through the OS handler instead. Zed has no URL scheme of its
 *   own yet (zed-industries/zed#8482).
 *
 * - Ghostty / iTerm2 / WezTerm / Kitty / Alacritty pass OSC 8
 *   URLs to the OS URL handler. Ghostty maintainers explicitly
 *   refuse to add `path:line:col` autodetection because the
 *   convention isn't standardised. The only URL format that
 *   survives the round-trip is an editor-specific deeplink —
 *   `vscode://file/...`, `cursor://file/...`, etc. — which macOS
 *   / Linux routes to the registered editor.
 *
 * **Resolution.** We emit plain `<file>:<line>:<col>` as the
 * visible display text (auto-detected by VSCode / Cursor / Zed
 * integrated terminals and by most modern external terminals
 * with Smart Selection) and wrap it in a per-host URL when the
 * terminal advertises OSC 8 support:
 *
 * | Host (env detection)        | OSC 8 URL                              |
 * | --------------------------- | -------------------------------------- |
 * | `TERM_PROGRAM=vscode`       | `file://abs:line:col` (VSCode private) |
 * | `CURSOR_TRACE_ID` set       | `file://abs:line:col` (Cursor inherits)|
 * | `TERM_PROGRAM=zed`          | (plain text — Zed autodetects)         |
 * | everything else, OSC 8 ok   | `<file_opener>://file/abs:line:col`    |
 * | no OSC 8 (piped / CI)       | (plain text)                           |
 *
 * The `<file_opener>` scheme is configurable, mirroring OpenAI
 * Codex's `file_opener` setting so users only need to set it
 * once across the agent-CLI ecosystem. Supported schemes:
 *
 * - `vscode` (default) — `vscode://file/...`
 * - `vscode-insiders` — `vscode-insiders://file/...`
 * - `cursor` — `cursor://file/...`
 * - `windsurf` — `windsurf://file/...`
 * - `zed` — `zed://file/...` (forward-compatible; Zed app must
 *   register the scheme — currently only opens via plain text
 *   inside the Zed terminal itself)
 * - `none` — disable OSC 8 emission, plain text only
 *
 * Override priority: `AACT_FILE_OPENER` env → `output.fileOpener`
 * in `aact.config.ts` → `"vscode"` default. Env var takes
 * precedence so users can override per shell without editing
 * project config.
 *
 * **Library safety:** `terminal-link.isSupported` is `false` when
 * stdout isn't a TTY (piped to `jq`, redirected to file, CI), so
 * the wrapper degrades to plain text — no escape sequences leak
 * into machine-readable output.
 */

/**
 * URI-based file opener — mirrors OpenAI Codex's `file_opener`
 * config so users only need to set the scheme once across
 * their agent-CLI tooling.
 */
export type FileOpener =
  | "vscode"
  | "vscode-insiders"
  | "cursor"
  | "windsurf"
  | "zed"
  | "none";

const FILE_OPENERS: ReadonlySet<string> = new Set<FileOpener>([
  "vscode",
  "vscode-insiders",
  "cursor",
  "windsurf",
  "zed",
  "none",
]);

export interface HyperlinkOptions {
  /** Skip OSC 8 even if the host terminal supports it. */
  readonly disabled?: boolean;
  /**
   * Override the URL scheme used for the OSC 8 wrapper. When
   * omitted, falls back to `AACT_FILE_OPENER` env then `"vscode"`.
   * `output.fileOpener` in `aact.config.ts` plumbs through here.
   */
  readonly fileOpener?: FileOpener;
}

const resolveFileOpener = (override?: FileOpener): FileOpener => {
  if (override) return override;
  const env = process.env.AACT_FILE_OPENER;
  if (env && FILE_OPENERS.has(env)) return env as FileOpener;
  return "vscode";
};

const buildFileUri = (
  loc: SourceLocation,
  opener: FileOpener,
): string | undefined => {
  if (opener === "none") return undefined;
  const lineCol = `${loc.start.line}:${loc.start.col}`;
  const { TERM_PROGRAM, CURSOR_TRACE_ID } = process.env;
  // VSCode + Cursor integrated terminals: their internal parser
  // handles the `file://abs:line:col` private convention. We
  // emit it even when the user explicitly chose a different
  // `fileOpener` — inside the editor's own terminal there's
  // nothing to "open in", we're already there.
  if (TERM_PROGRAM === "vscode" || CURSOR_TRACE_ID) {
    return `file://${loc.file}:${lineCol}`;
  }
  return `${opener}://file/${loc.file}:${lineCol}`;
};

/**
 * Wrap `text` in an OSC 8 clickable hyperlink. Returns plain `text`
 * when:
 *   - `loc` is undefined (rule didn't anchor the violation);
 *   - `opts.disabled` is true;
 *   - `opts.fileOpener === "none"`;
 *   - `TERM_PROGRAM=zed` (Zed's built-in path autodetect drives
 *     Cmd-click; OSC 8 with any external URL scheme would bypass
 *     "open in this Zed window");
 *   - the host terminal doesn't support OSC 8 (CI, piped output,
 *     older terminals — detected by `terminal-link.isSupported`).
 *
 * Plain text is always `<file>:<line>:<col>` so that terminals
 * with smart-selection autodetection still pick it up even when
 * we skip OSC 8.
 */
export const linkSourceLocation = (
  text: string,
  loc?: SourceLocation,
  opts?: HyperlinkOptions,
): string => {
  if (!loc) return text;
  if (opts?.disabled) return text;
  if (process.env.TERM_PROGRAM === "zed") return text;
  if (!terminalLink.isSupported) return text;
  const opener = resolveFileOpener(opts?.fileOpener);
  const uri = buildFileUri(loc, opener);
  if (!uri) return text;
  return terminalLink(text, uri, { fallback: () => text });
};

export { formatLocation } from "../../model";

/**
 * Display-only path formatter for text-mode renderers. Loaders run
 * `path.resolve()` on the input, so `SourceLocation.file` is always
 * absolute — fine for JSON / SARIF consumers and for the OSC 8 URI
 * (editor deeplinks like `vscode://file/<abs>:line:col` need it), but
 * verbose in a terminal table where the same `/Users/.../project/`
 * prefix repeats on every row.
 *
 * Following the rustc / biome / eslint / oxlint convention: when the
 * file is under `cwd`, return the relative form (no leading `./` so
 * the canonical `path:line:col` autodetection in Zed and plain
 * terminals still triggers). When the file is outside `cwd` —
 * vendored examples, `git show <ref>:<path>` scratch tmpfiles, or any
 * file referenced by absolute path — return the original absolute.
 *
 * The URI passed to `linkSourceLocation` stays absolute regardless;
 * this helper only narrows the display TEXT.
 */
export const formatDisplayPath = (
  file: string,
  cwd: string = process.cwd(),
): string => {
  if (!path.isAbsolute(file)) return file;
  const rel = path.relative(cwd, file);
  // `path.relative` returns `..` segments when `file` is outside
  // `cwd` — that's an absolute reference dressed up as a long
  // relative one. Keep the absolute form so the user immediately
  // sees the file isn't part of the project.
  if (rel === "" || rel.startsWith("..")) return file;
  return rel;
};

/**
 * Pair `formatDisplayPath` with the canonical `:line:col` suffix.
 * The output is what goes into the visible cell of a violation
 * table — feed it to `linkSourceLocation` as the display text and
 * pass the original `SourceLocation` (with absolute file) so the
 * URI side stays correct.
 */
export const formatLocationDisplay = (
  loc: SourceLocation,
  cwd: string = process.cwd(),
): string =>
  `${formatDisplayPath(loc.file, cwd)}:${loc.start.line}:${loc.start.col}`;
