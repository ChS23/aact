import { randomBytes } from "node:crypto";

import type { AactConfig, DiffData, Model } from "aact";
import { analyzeArchitecture, computeDiff, loadBaseline } from "aact";

import { loadModelFromConfig } from "./load-model.js";
import type { ModelEnvelope, ServerHandle, ViewError } from "./server.js";
import { startServer } from "./server.js";
import { startWatcher } from "./watcher.js";

/**
 * Inputs the core `aact view` subcommand hands over after loading
 * and validating the user's config. Everything is already resolved
 * — paths are absolute, the customRules array is parsed — so the
 * companion has no business touching the loader pipeline a second
 * time. It just hosts the UI on top of what's already in memory.
 */
export interface RunWorkbenchOptions {
  /** Loaded + validated `aact.config.ts` payload. */
  readonly config: AactConfig;
  /** Absolute path to the resolved config file, or `null` when the
   *  caller (rarely) skipped config discovery. */
  readonly configPath: string | null;
  /** Override port. When omitted, listhen picks the next free
   *  port — the workbench prints the URL it actually bound to. */
  readonly port?: number;
  /** Suppress the automatic browser-open. The URL still prints to
   *  stdout so CI / headless flows can pick it up. */
  readonly noOpen?: boolean;
  /** Baseline input for diff mode (file path, git ref, or `-`).
   *  When set, the workbench loads two models, runs `computeDiff`,
   *  and exposes the result on the envelope so the SPA renders a
   *  diff overlay. Current side stays the configured source. */
  readonly diffBaseline?: string;
  /** Explicit format hint for the diff baseline — required for
   *  stdin input or non-canonical file extensions. */
  readonly diffBaselineFormat?: string;
}

export interface RunWorkbenchResult {
  /** `0` when the user quit cleanly; `2` when the server failed to
   *  boot (port collision the picker couldn't escape, file
   *  watcher errored, etc.). */
  readonly exitCode: 0 | 2;
  /** URL the workbench bound to, or `null` if the boot failed
   *  before binding. Surfaced on the core CLI's `ViewData`
   *  envelope so CI / agents can pick up where the session went. */
  readonly url: string | null;
}

const sourceOf = (config: AactConfig): string =>
  typeof config.source === "string" ? config.source : config.source.path;

const createAuthToken = (): string => randomBytes(24).toString("base64url");

/**
 * Loaded diff baseline kept in closure for the lifetime of the
 * workbench process. Baseline is immutable per session — a git ref
 * never moves, and even a file path is taken at boot time. The
 * watcher only re-reads the current side; we never need to reload
 * the baseline.
 */
interface CachedBaseline {
  readonly model: Model;
  readonly source: string;
  readonly format: string;
}

const loadDiffBaseline = async (
  options: RunWorkbenchOptions,
): Promise<CachedBaseline | undefined> => {
  if (!options.diffBaseline) return undefined;
  const result = await loadBaseline({
    arg: options.diffBaseline,
    sideLabel: "baseline",
    ...(options.diffBaselineFormat
      ? { formatOverride: options.diffBaselineFormat }
      : {}),
  });
  return {
    model: result.model,
    source: result.side.source,
    format: result.side.format,
  };
};

/** Build a `ModelEnvelope` from a single in-process loadModel call.
 *  Mirrors the wider `aact model --json` envelope so the SPA can
 *  reuse aact's contract — schemaVersion stays at `1`. */
const buildEnvelope = async (
  options: RunWorkbenchOptions,
  aactVersion: string,
  baseline: CachedBaseline | undefined,
): Promise<ModelEnvelope> => {
  const startedAt = performance.now();
  const { model, issues } = await loadModelFromConfig(options.config);
  // Architecture metrics for the optional UI overlay. Same options
  // path as the CLI (`src/cli/commands/analyze.ts`), so the user's
  // `config.analyze.{syncTechnologies, asyncTechnologies, exclude,
  // topN}` flows uniformly between `aact analyze` and the workbench.
  const { report: analysis } = analyzeArchitecture(
    model,
    options.config.analyze,
  );
  // Compute diff against the cached baseline when diff mode is on.
  // Reuses the same `computeDiff` the CLI runs — no second pipeline.
  let diff: { baselineModel: Model; data: DiffData } | undefined;
  if (baseline) {
    const data = computeDiff(
      baseline.model,
      model,
      { source: baseline.source, format: baseline.format },
      { source: sourceOf(options.config), format: options.config.source.type },
      // Diff options come at defaults for the workbench — the user
      // can tune via `aact diff` for CLI workflows; the workbench is
      // optimised for "show me what changed" rather than threshold
      // tuning.
    );
    diff = { baselineModel: baseline.model, data };
  }
  return {
    schemaVersion: 1,
    command: "view",
    ok: true,
    exitCode: 0,
    data: {
      model,
      issues: [...issues],
      analysis,
      ...(diff ? { diff } : {}),
    },
    diagnostics: [],
    meta: {
      aactVersion,
      durationMs: Math.round(performance.now() - startedAt),
      configPath: options.configPath,
      source: sourceOf(options.config),
    },
  };
};

const buildReloadError = (
  options: RunWorkbenchOptions,
  error: unknown,
  startedAt: number,
): ViewError => ({
  message: error instanceof Error ? error.message : String(error),
  source: sourceOf(options.config),
  configPath: options.configPath,
  durationMs: Math.round(performance.now() - startedAt),
  at: new Date().toISOString(),
});

/**
 * Lifecycle entry point invoked by the core `aact view` subcommand
 * via dynamic import.
 *
 * Boots the local HTTP server (listhen-picked port, browser opens
 * unless `--no-open`), serves the inline workbench page, exposes
 * `GET /api/model` + the `/api/ws` push channel, and wires a
 * chokidar watcher on `config.source.path` so every save triggers
 * a re-load + broadcast.
 *
 * Resolves only when the user terminates the session (Ctrl-C /
 * SIGTERM); the core CLI then propagates the exit code into the
 * envelope. Defensive cleanup: signal handlers tear the watcher
 * + listener down so a hard-killed Node process doesn't leak the
 * port or a stuck file watcher into the editor's `.fseventsd`.
 */
export const runWorkbench = async (
  options: RunWorkbenchOptions,
): Promise<RunWorkbenchResult> => {
  // Resolve aact version lazily — it's only surfaced on the
  // envelope `meta`, no need to crash the boot if the workspace
  // is mid-rebuild. Falls back to "unknown".
  let aactVersion = "unknown";
  try {
    const mod = (await import("aact")) as Record<string, unknown>;
    if (typeof mod.aactVersion === "string") aactVersion = mod.aactVersion;
  } catch {
    // ignore — version is informational only
  }

  let server: ServerHandle | undefined;

  try {
    const authToken = createAuthToken();
    // Load the diff baseline once at boot — git refs are immutable
    // and file paths are taken at session start. The watcher only
    // tracks the current side; baseline never reloads.
    const baseline = await loadDiffBaseline(options);
    const envelope = await buildEnvelope(options, aactVersion, baseline);
    server = await startServer({
      ...(options.port === undefined ? {} : { port: options.port }),
      ...(options.noOpen === undefined ? {} : { noOpen: options.noOpen }),
      initialEnvelope: envelope,
      authToken,
    });

    // eslint-disable-next-line no-console -- intentional user-facing banner
    console.log(`▸ aact view ready at ${server.url}`);
    if (options.noOpen) {
      // eslint-disable-next-line no-console
      console.log(`  open it manually — --no-open suppressed auto-launch`);
    }
    if (baseline) {
      // eslint-disable-next-line no-console
      console.log(`  diff baseline: ${baseline.source} (${baseline.format})`);
    }
    // eslint-disable-next-line no-console
    console.log(
      `  watching ${sourceOf(options.config)} for changes (Ctrl-C to stop)`,
    );

    const watcher = startWatcher({
      paths: [sourceOf(options.config)],
      onChange: async () => {
        const startedAt = performance.now();
        try {
          const next = await buildEnvelope(options, aactVersion, baseline);
          server?.broadcast(next);
          // eslint-disable-next-line no-console
          console.log(
            `  ↻ reloaded (${Object.keys(next.data.model.elements).length} elements, ${next.data.issues.length} issues)`,
          );
        } catch (error) {
          const viewError = buildReloadError(options, error, startedAt);
          server?.broadcastError(viewError);
          // eslint-disable-next-line no-console
          console.error(`  ✗ reload failed: ${viewError.message}`);
        }
      },
      onError: (error) => {
        const viewError = buildReloadError(options, error, performance.now());
        server?.broadcastError(viewError);
        // eslint-disable-next-line no-console
        console.error(`  ✗ watcher failed: ${viewError.message}`);
      },
    });

    await new Promise<void>((resolve) => {
      const cleanup = (signal: NodeJS.Signals): void => {
        // eslint-disable-next-line no-console
        console.log(`\n• stopping (${signal})…`);
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
        void Promise.allSettled([watcher.close(), server?.close()]).then(() =>
          resolve(),
        );
      };
      const onSigint = (): void => cleanup("SIGINT");
      const onSigterm = (): void => cleanup("SIGTERM");
      process.on("SIGINT", onSigint);
      process.on("SIGTERM", onSigterm);
    });

    return { exitCode: 0, url: server.url };
  } catch (error) {
    if (server) await server.close().catch(() => {});
    // eslint-disable-next-line no-console
    console.error(
      `aact view boot failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { exitCode: 2, url: server?.url ?? null };
  }
};
