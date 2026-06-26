import fs from "node:fs/promises";

import path from "pathe";

import type { AactConfig } from "../../config";
import { loadFormat } from "../../formats/registry";
import { canGenerate } from "../../formats/types";
import { loadModel } from "../loadModel";
import type { Diagnostic, Renderer } from "../output";
import { resolveOutputMode, ToolError } from "../output";
import { formatDisplayPath } from "../output/hyperlinks";
import type { ExecuteResult } from "../run";
import { cliCommandWithConfig } from "../run";
import { configArg, jsonArg } from "../sharedArgs";
import { sourceArg } from "../sourceArg";

// -----------------------------------------------------------------------------
// Public data shape (envelope.data for `aact generate`)
// -----------------------------------------------------------------------------

export type GenerateOutputSink = "stdout" | "file" | "directory" | "none";

export interface GeneratedFileInfo {
  /** Path relative to outputPath for directory sinks; basename for file sinks; "<stdout>" for stdout. */
  readonly path: string;
  /** Size in UTF-8 bytes — what lands on disk — not JS string length
   *  (which counts UTF-16 code units and undercounts non-ASCII content). */
  readonly bytes: number;
}

export interface GenerateData {
  readonly formatName: string;
  readonly outputSink: GenerateOutputSink;
  readonly outputPath: string | null;
  readonly files: readonly GeneratedFileInfo[];
}

// -----------------------------------------------------------------------------
// Sink resolution — UNIX-style: `-` means stdout
// -----------------------------------------------------------------------------

type Sink =
  | { readonly kind: "stdout" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "directory"; readonly path: string };

const STDOUT_SENTINEL = "-";

const looksLikeDirectory = (p: string): boolean =>
  p.endsWith("/") || p.endsWith("\\");

const isExistingDirectory = async (p: string): Promise<boolean> => {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
};

const resolveSink = async (
  args: { output?: string },
  config: AactConfig,
  fileCount: number,
): Promise<Sink> => {
  if (fileCount === 1) {
    if (args.output === STDOUT_SENTINEL) return { kind: "stdout" };
    if (args.output) {
      // A trailing slash or an existing directory means "put the artefact
      // *inside*" — `--output ./k8s/` must not flip between file and
      // directory semantics depending on how many files the model
      // happens to produce.
      if (
        looksLikeDirectory(args.output) ||
        (await isExistingDirectory(args.output))
      )
        return { kind: "directory", path: args.output };
      return { kind: "file", path: args.output };
    }
    // No --output for a single-file artefact: stream to stdout (UNIX default).
    return { kind: "stdout" };
  }

  // Multi-file: directory sink is required.
  if (args.output === STDOUT_SENTINEL) {
    throw new ToolError(
      "config.missingOutputPath",
      "Multi-file artefact cannot stream to stdout — provide --output <directory>.",
    );
  }
  const dir =
    args.output ??
    config.generate?.kubernetes?.path ??
    "fixtures/kubernetes/microservices";
  return { kind: "directory", path: dir };
};

// -----------------------------------------------------------------------------
// Pure executor
// -----------------------------------------------------------------------------

export interface GenerateArgs {
  readonly source?: string;
  readonly format?: string;
  readonly output?: string;
  readonly json?: boolean;
}

const loadFormatOrThrow = async (formatName: string) => {
  try {
    return await loadFormat(formatName);
  } catch (error) {
    throw new ToolError(
      "format.unknown",
      error instanceof Error ? error.message : String(error),
      { format: formatName },
    );
  }
};

export const executeGenerate = async (
  config: AactConfig,
  args: GenerateArgs,
): Promise<ExecuteResult<GenerateData>> => {
  const formatName = args.format ?? "plantuml";
  const format = await loadFormatOrThrow(formatName);

  if (!canGenerate(format)) {
    throw new ToolError(
      "format.unknown",
      `Format "${format.name}" doesn't support generate`,
      { format: format.name },
    );
  }

  const { model } = await loadModel(config);
  // Per-format generate options from `config.generate.<formatName>`. The key
  // cast narrows the registry name to the known format slices; unknown
  // formats (e.g. compose) simply resolve to `undefined`.
  const generateOptions =
    config.generate?.[formatName as keyof NonNullable<AactConfig["generate"]>];
  const output = format.generate(model, generateOptions);

  if (output.files.length === 0) {
    const diagnostic: Diagnostic = {
      kind: "format.emptyOutput",
      message: "Generator produced no files",
      severity: "warning",
      context: { format: formatName },
    };
    return {
      data: {
        formatName,
        outputSink: "none",
        outputPath: null,
        files: [],
      },
      exitCode: 0,
      diagnostics: [diagnostic],
    };
  }

  const sink = await resolveSink(args, config, output.files.length);

  // Any machine-readable mode owns stdout for the envelope — JSON or SARIF,
  // whether set via `--json` or `config.output.mode`. The artefact can't
  // share it. (Text mode is fine: the confirmation goes to stderr via
  // `stdoutClaimed`.)
  const outputMode = resolveOutputMode({ cliJson: args.json, config });
  if (outputMode !== "text" && sink.kind === "stdout") {
    throw new ToolError(
      "config.outputCollidesWithJson",
      `generate in ${outputMode} mode requires --output <path> — stdout is reserved for the ${outputMode} envelope, so the artefact would corrupt it.`,
      { format: formatName },
    );
  }

  if (sink.kind === "stdout") {
    const file = output.files[0];
    process.stdout.write(file.content);
    return {
      data: {
        formatName,
        outputSink: "stdout",
        outputPath: null,
        files: [
          { path: "<stdout>", bytes: Buffer.byteLength(file.content, "utf8") },
        ],
      },
      exitCode: 0,
      stdoutClaimed: true,
    };
  }

  if (sink.kind === "file") {
    const file = output.files[0];
    await fs.mkdir(path.dirname(sink.path), { recursive: true });
    await fs.writeFile(sink.path, file.content);
    return {
      data: {
        formatName,
        outputSink: "file",
        outputPath: sink.path,
        files: [
          { path: sink.path, bytes: Buffer.byteLength(file.content, "utf8") },
        ],
      },
      exitCode: 0,
    };
  }

  // directory sink
  await fs.mkdir(sink.path, { recursive: true });
  await Promise.all(
    output.files.map(async (f) => {
      const outputPath = path.join(sink.path, f.path);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, f.content);
    }),
  );
  return {
    data: {
      formatName,
      outputSink: "directory",
      outputPath: sink.path,
      files: output.files.map((f) => ({
        path: f.path,
        bytes: Buffer.byteLength(f.content, "utf8"),
      })),
    },
    exitCode: 0,
  };
};

// -----------------------------------------------------------------------------
// Text rendering — mirrors current consola.success messages
// -----------------------------------------------------------------------------

export const renderGenerateText: Renderer<GenerateData> = (envelope, sink) => {
  const { data } = envelope;

  if (data.outputSink === "none") {
    sink.write("⚠ Generator produced no files\n");
    return;
  }

  if (data.outputSink === "stdout") {
    // The artefact itself is already on stdout. Envelope goes to stderr via
    // stdoutClaimed → this writes a brief confirmation.
    sink.write(
      `✔ Generated ${data.formatName} artefact (${data.files[0].bytes} bytes) to stdout\n`,
    );
    return;
  }

  // `outputPath` is typed `string | null` because the stdout / none
  // sinks set it to null upstream; both branches below have already
  // returned, so anything reaching here has a real path. `?? ""`
  // keeps TS happy without a non-null assertion in case a future
  // GenerateOutputSink variant forgets to populate it.
  const displayPath = formatDisplayPath(data.outputPath ?? "");

  if (data.outputSink === "file") {
    sink.write(`✔ Written to ${displayPath}\n`);
    return;
  }

  // directory
  sink.write(`✔ Generated ${data.files.length} file(s) in ${displayPath}\n`);
};

// -----------------------------------------------------------------------------
// Command definition
// -----------------------------------------------------------------------------

export const generate = cliCommandWithConfig({
  name: "generate",
  meta: { name: "generate", description: "Generate architecture artifacts" },
  args: {
    ...sourceArg,
    ...configArg,
    ...jsonArg,
    output: {
      type: "string",
      description:
        "Output path: file or directory (trailing '/' or an existing dir), '-' for stdout",
    },
    format: {
      type: "string",
      description: "Target format name (plantuml, kubernetes, ...)",
    },
  },
  renderText: renderGenerateText,
  execute: (ctx, config) => executeGenerate(config, ctx.args as GenerateArgs),
});
