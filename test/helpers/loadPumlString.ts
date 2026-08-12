import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { load as loadPlantuml } from "../../src/formats/plantuml/load";
import type { Model } from "../../src/model";

export interface LoadedPuml {
  readonly model: Model;
  readonly source: string;
}

/**
 * Load a PUML snippet through the real chevrotain parser so rule-fix
 * tests can pin behavior with byte-accurate `SourceLocation`s.
 *
 * Range-based edits need real offsets to slice the source — synthetic
 * `makeModel` produces no SourceLocation, so any fix that anchors on
 * `sourceLocation` returns no edits. Loading through the real format
 * loader is the cheapest way to exercise the actual fix path the CLI
 * runs in production.
 *
 * Returns the parsed Model plus the *exact* source the parser saw, so
 * `applyEdits(source, fix.edits)` operates on consistent byte offsets.
 */
export const loadPumlString = async (puml: string): Promise<LoadedPuml> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "aact-loadpuml-"));
  const file = path.join(dir, "arch.puml");
  try {
    await fs.writeFile(file, puml);
    const { model } = await loadPlantuml(file);
    return { model, source: puml };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};
