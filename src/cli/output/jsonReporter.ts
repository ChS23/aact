import type { CommandResult, Reporter } from "./types";

/**
 * Emits the envelope as a single JSON document on stdout. Stdout is reserved
 * for the envelope; artefact-producing commands (generate) must write
 * artefacts to disk in JSON mode — collisions raise `config.outputCollidesWithJson`.
 */
export class JsonReporter<TData = unknown> implements Reporter<TData> {
  emit(result: CommandResult<TData>): void {
    process.stdout.write(JSON.stringify(result.envelope, undefined, 2) + "\n");
  }
}
