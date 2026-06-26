import fs from "node:fs/promises";

import path from "pathe";
import { parseDocument } from "yaml";

import type { ModelIssue } from "../../model";
import type { ParsedComposeFile, ParsedIncludeEntry } from "./types";

/**
 * Compose Spec 2026 native composition — `include:` top-level
 * directive. Каждая запись — путь к другому compose-файлу
 * который мерджится в текущую model.
 *
 *   include:
 *     - path: ./common/db.yml           # long form
 *       project_directory: ./common
 *       env_file: ./.env
 *     - ./shared/cache.yml              # short form
 *
 * Резолвинг:
 *  1. Рекурсивно загрузить все включённые файлы (depth-first).
 *  2. Cycle detection — храним set посещённых абсолютных путей,
 *     ToolError-like issue при cycle.
 *  3. Merge: included files грузятся ПЕРЕД current — current
 *     ключи overrides included на коллизии (per Compose Spec).
 *
 * Возвращаем плоский ordered массив `ParsedComposeFile` где первый
 * элемент — самый "включённый" (deepest), последний — entry file.
 * Caller (`toModel`) идёт по этому массиву и собирает Model
 * аккумулятивно — last-write-wins получается естественно.
 */

export interface IncludedFile {
  readonly file: string;
  readonly source: string;
  readonly parsed: ParsedComposeFile;
  /** Возврат `Document` ленивый — caller сам решает нужен ли CST. */
  readonly documentFactory: () => ReturnType<typeof parseDocument>;
}

export interface ResolveIncludeResult {
  readonly files: readonly IncludedFile[];
  readonly issues: readonly ModelIssue[];
}

const normalizeIncludeEntry = (
  entry: ParsedIncludeEntry,
): string | undefined => {
  if (typeof entry === "string") return entry;
  if (typeof entry.path === "string") return entry.path;
  if (Array.isArray(entry.path) && entry.path.length > 0) {
    // Multi-path include — берём первый файл; merge нескольких в одном
    // include-entry это phase 1.5. Compose-spec тоже редкое сочетание.
    const first: unknown = entry.path[0];
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
};

interface VisitorState {
  readonly visited: Set<string>;
  readonly stack: readonly string[];
  readonly out: IncludedFile[];
  readonly issues: ModelIssue[];
}

const loadOne = async (absPath: string): Promise<IncludedFile> => {
  const source = await fs.readFile(absPath, "utf8");
  const documentFactory = () =>
    parseDocument(source, { keepSourceTokens: true });
  const doc = documentFactory();
  const parsed = (doc.toJSON() ?? {}) as ParsedComposeFile;
  return Object.freeze({
    file: absPath,
    source,
    parsed,
    documentFactory,
  });
};

const visit = async (absPath: string, state: VisitorState): Promise<void> => {
  if (state.stack.includes(absPath)) {
    const cycle = [...state.stack, absPath].join(" → ");
    state.issues.push({
      kind: "loader-warning",
      source: "compose",
      code: "include-cycle",
      message: `Compose include cycle detected: ${cycle}`,
    });
    return;
  }
  if (state.visited.has(absPath)) {
    // Уже видели — пропускаем, чтобы duplicate include просто
    // подмешивался один раз; merge всё равно last-write-wins
    // обеспечит current-wins.
    return;
  }
  state.visited.add(absPath);

  let loaded: IncludedFile;
  try {
    loaded = await loadOne(absPath);
  } catch (error) {
    state.issues.push({
      kind: "loader-warning",
      source: "compose",
      code: "include-read-error",
      message: `Failed to read include "${absPath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return;
  }

  const baseDir = path.dirname(absPath);
  const childStack = Object.freeze([...state.stack, absPath]);
  for (const rawEntry of loaded.parsed.include ?? []) {
    const rel = normalizeIncludeEntry(rawEntry);
    if (!rel) {
      state.issues.push({
        kind: "loader-warning",
        source: "compose",
        code: "include-malformed",
        message: `Compose include entry in "${absPath}" is malformed`,
      });
      continue;
    }
    const childAbs = path.resolve(baseDir, rel);
    await visit(childAbs, {
      ...state,
      stack: childStack,
    });
  }

  // After children — push self. Так получаем DFS post-order:
  // deepest included file first, entry-file last → last-write-wins
  // при последующем merge работает корректно.
  state.out.push(loaded);
};

export const resolveIncludes = async (
  entryFile: string,
): Promise<ResolveIncludeResult> => {
  const abs = path.resolve(entryFile);
  // Probe entry file существование отдельно — если самой entry нет,
  // это hard error (как у структурайзера и c4-puml). Только нечитаемые
  // ВКЛЮЧЁННЫЕ файлы превращаются в loader-warning.
  await fs.access(abs);
  const state: VisitorState = {
    visited: new Set<string>(),
    stack: [],
    out: [],
    issues: [],
  };
  await visit(abs, state);
  return {
    files: Object.freeze(state.out),
    issues: Object.freeze(state.issues),
  };
};
