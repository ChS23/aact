/**
 * Pre-lex passes for the C4-PlantUML chevrotain parser.
 *
 * The reference C4-PlantUML stdlib mixes architectural macros
 * (`Container(...)`, `Rel(...)`, `System_Boundary(...) { ... }`) with
 * a large body of host PlantUML syntax (`!include`, `LAYOUT_*`,
 * `skinparam`, `title`, `note`, `class`, …) that the linter has no
 * business interpreting. Letting that material through to the parser
 * would mean every real-world `.puml` file fails to lex.
 *
 * Approach: rewrite the **raw source** before tokenisation, replacing
 * out-of-scope content with whitespace **of the same length** (JS
 * string length = UTF-16 code units, the unit chevrotain operates on).
 * This is the only safe transform — chevrotain's `positionTracking:
 * "full"` records code-unit offsets from the start of the lexer input,
 * so if we shorten the source by even one character every downstream
 * `SourceLocation` is wrong. Whitespace-preserving strip keeps offsets
 * identical between the stripped buffer and the original file, so the
 * `range` carried by every AST node points at the same position in
 * the user's `.puml` that they typed.
 *
 * Passes (applied in order):
 *
 *   1. `stripPreprocessor` — drops every line starting with `!`
 *      (after optional whitespace). Covers `!include`, `!includeurl`,
 *      `!define`, `!if`/`!else`/`!endif`, `!procedure`/`!function`,
 *      `!global`, etc. The reference stdlib uses `!if` blocks inside
 *      `!includes` of itself, so without this pass the lexer never
 *      gets past the URL line.
 *
 *   2. `stripLineComments` — drops whole-line `' comments` before
 *      the lexer can confuse apostrophes inside comment prose with
 *      single-quoted strings.
 *
 *   3. `stripPlantumlNative` — drops every line whose first token is
 *      a PlantUML host keyword the linter does not interpret
 *      (`skinparam`, `title`, `caption`, `header`, `footer`,
 *      `hide`, `show`, `scale`, `legend`, `endlegend`, `note`,
 *      `endnote`, `together`, `class`, `interface`, `enum`, …).
 *      `note ... end note` multi-line blocks land in the same pass.
 *
 *   4. `stripOpaqueMacros` — drops every line that opens with a known
 *      opaque C4 macro call: `LAYOUT_*`, `HIDE_STEREOTYPE`,
 *      `SHOW_*`, `SET_SKETCH_STYLE`, `SetPropertyHeader`,
 *      `AddProperty`, `WithoutPropertyHeader`,
 *      `SetDefaultLegendEntries`, `UpdateLegendTitle`,
 *      `Add*Tag` (`AddElementTag`, `AddRelTag`, `AddBoundaryTag`,
 *      `AddNodeTag`, `Add*PersonTag`/`Add*SystemTag`/etc.),
 *      `Update*Style` (`UpdateElementStyle`, `UpdateRelStyle`,
 *      `Update*BoundaryStyle`). The implementation walks balanced
 *      parens across newlines, so multi-line opaque calls (named-arg
 *      lists wrapped onto several lines) strip cleanly.
 *
 *   5. `stripDeploymentBlocks` — `Deployment_Node`, `Node`, `Node_L`,
 *      `Node_R`, `Deployment_Node_L`, `Deployment_Node_R`. Per
 *      `grammar.md` §3 these are parsed-then-info-issue: out of C4
 *      scope, but a legal file must not crash. Whitespace out the
 *      macro call AND its balanced `{ ... }` body (if present); emit
 *      one `infoIssue` per stripped block.
 *
 *   6. `keepFirstDiagram` — `.puml` may hold multiple
 *      `@startuml`/`@enduml` blocks. aact processes the first and
 *      emits an info-issue for the rest.
 *
 * Each pass returns the rewritten text plus a list of `PreParseIssue`s
 * with full `SourceLocation` so the CLI can surface "N deployment
 * blocks ignored", "M opaque macros stripped", etc.
 */

import type { SourceLocation } from "../../../model";
import { unescapePlantumlText } from "../strings";

/**
 * Info-level diagnostic raised by a pre-lex pass. The PUML parser's
 * `index.ts` aggregates these alongside lex/parse errors into the
 * `LoadResult` returned to the CLI. Distinct from `ModelIssue` —
 * `ModelIssue` is a closed union of post-build invariant violations;
 * preParse issues are processing notes (deployment skipped, second
 * diagram ignored) that the CLI surfaces as informational output.
 */
export interface PreParseIssue {
  readonly kind: "info";
  readonly message: string;
  readonly range: SourceLocation;
}

/**
 * Key=value pairs attached to a C4 macro call via the
 * `SetPropertyHeader` / `AddProperty` / `WithoutPropertyHeader`
 * stdlib protocol. Indexed by the **1-based line number** of the
 * target macro (Container / Person / System / Rel / etc.) so the
 * AST → Model lowering can attach them once `sourceLocation` is
 * known.
 *
 * `key` and `value` come straight from the `AddProperty` positional
 * literals — quotes stripped, whitespace preserved. Single-column
 * `AddProperty("foo")` lands as `{ "foo": "" }` so the round-trip
 * back through `generate` keeps the order; the consumer is free to
 * treat empty-string values as flags.
 */
export type AttachedPropertiesByLine = ReadonlyMap<
  number,
  Readonly<Record<string, string>>
>;

export type SimpleConstants = ReadonlyMap<string, string>;

export interface PreParseResult {
  /** Source text after all strip passes — same length as input (UTF-16 code units). */
  readonly text: string;
  /** Info-level notes raised by the passes. */
  readonly issues: readonly PreParseIssue[];
  /** Key=value rows from `SetPropertyHeader` / `AddProperty`
   *  protocol, keyed by the target macro's 1-based line. Empty when
   *  the source uses no property table. */
  readonly attachedProperties: AttachedPropertiesByLine;
  /** Literal `!$var=...` / `!define NAME ...` constants for C4 arg values. */
  readonly simpleConstants: SimpleConstants;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Replace every char of `s` with a space, preserving `\n` and `\r`. */
const blank = (s: string): string => s.replaceAll(/[^\r\n]/g, " ");

/**
 * Compute 1-based `{line, col, offset}` for a 0-based offset inside
 * the source. Used to build `SourceLocation` ranges for `PreParseIssue`s.
 *
 * The implementation is O(offset) per call — fine for the small number
 * of issues we emit (one per stripped block, not per stripped char).
 */
const positionAt = (
  source: string,
  offset: number,
): { line: number; col: number; offset: number } => {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col, offset };
};

const rangeOf = (
  source: string,
  start: number,
  end: number,
  file: string,
): SourceLocation => ({
  file,
  start: positionAt(source, start),
  end: positionAt(source, end),
});

// ── Pass 1: preprocessor directives ─────────────────────────────────

/**
 * Every line whose first non-whitespace character is `!` is replaced
 * with whitespace. PlantUML preprocessor directives can be multi-line
 * via `\` continuation (rare in C4 files) — we accept that current
 * implementation only handles the single-line form and note this as a
 * known limitation in `grammar.md`.
 */
export const stripPreprocessor = (text: string): string =>
  text.replaceAll(/^[ \t]*!.*$/gm, (line) => blank(line));

const INCLUDE_DIRECTIVES = ["!include_once", "!include_many", "!include"];

const includeTarget = (line: string): string | undefined => {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("!includeurl")) return undefined;

  const directive = INCLUDE_DIRECTIVES.find((d) => trimmed.startsWith(d));
  if (directive === undefined) return undefined;

  const raw = trimmed.slice(directive.length);
  if (raw.length === 0 || !/\s/u.test(raw[0])) return undefined;
  const value = raw.trim();
  if (value.length === 0) return undefined;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value.split(/\s+/u)[0];
};

const isLocalIncludeTarget = (target: string): boolean =>
  !target.startsWith("<") &&
  !/^https?:\/\//iu.test(target) &&
  !target.startsWith("$") &&
  !target.startsWith("%");

const collectIgnoredLocalIncludes = (
  text: string,
  file: string,
): readonly PreParseIssue[] => {
  const issues: PreParseIssue[] = [];
  let offset = 0;
  for (const line of text.split(/(?<=\n)/u)) {
    const target = includeTarget(line);
    if (target && isLocalIncludeTarget(target)) {
      issues.push({
        kind: "info",
        message: `Local !include "${target}" was ignored by parseSource(); use format.load() to expand local PlantUML includes from disk.`,
        range: rangeOf(text, offset, offset + line.length, file),
      });
    }
    offset += line.length;
  }
  return issues;
};

const isAsciiWhitespace = (char: string): boolean =>
  char === " " || char === "\t" || char === "\r" || char === "\n";

const isIdentifierStart = (char: string): boolean => {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return (
    (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char === "_"
  );
};

const isIdentifierPart = (char: string): boolean => {
  const code = char.codePointAt(0);
  if (code === undefined) return false;
  return isIdentifierStart(char) || (code >= 48 && code <= 57);
};

const isSimpleIdentifier = (value: string): boolean => {
  if (value.length === 0 || !isIdentifierStart(value[0])) return false;
  for (const char of value.slice(1)) {
    if (!isIdentifierPart(char)) return false;
  }
  return true;
};

const parseSimpleVariableConstant = (
  line: string,
): readonly [string, string] | undefined => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("!$")) return undefined;
  const equals = trimmed.indexOf("=", 2);
  if (equals === -1) return undefined;

  const rawName = trimmed.slice(2, equals).trimEnd();
  if (rawName.trimStart() !== rawName || !isSimpleIdentifier(rawName)) {
    return undefined;
  }
  return [`$${rawName}`, trimmed.slice(equals + 1).trim()];
};

const firstWhitespaceIndex = (value: string): number => {
  let index = 0;
  for (const char of value) {
    if (isAsciiWhitespace(char)) return index;
    index += char.length;
  }
  return -1;
};

const parseSimpleDefineConstant = (
  line: string,
): readonly [string, string] | undefined => {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("!define")) return undefined;
  const rest = trimmed.slice("!define".length);
  if (rest.length === 0 || !isAsciiWhitespace(rest[0])) return undefined;

  const body = rest.trimStart();
  const nameEnd = firstWhitespaceIndex(body);
  if (nameEnd === -1) return undefined;

  const name = body.slice(0, nameEnd);
  const value = body.slice(nameEnd).trim();
  if (!isSimpleIdentifier(name) || value.length === 0) return undefined;
  return [name, value];
};

const unquoteConstantValue = (raw: string): string => {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

export const extractSimpleConstants = (text: string): SimpleConstants => {
  const constants = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const variableConstant = parseSimpleVariableConstant(line);
    if (variableConstant) {
      constants.set(
        variableConstant[0],
        unquoteConstantValue(variableConstant[1]),
      );
      continue;
    }

    const defineConstant = parseSimpleDefineConstant(line);
    if (!defineConstant) continue;
    constants.set(defineConstant[0], unquoteConstantValue(defineConstant[1]));
  }
  return constants;
};

// ── Pass 2: whole-line comments ────────────────────────────────────

export const stripLineComments = (text: string): string =>
  text.replaceAll(/^[ \t]*'.*$/gm, (line) => blank(line));

// ── Pass 3: PlantUML native ─────────────────────────────────────────

/**
 * Tokens we treat as line-leading PlantUML host syntax. The list is
 * conservative — anything we miss surfaces as a parse error rather
 * than silent loss, which is recoverable. Keep this list narrow and
 * authoritative; extending it loosens the safety net.
 */
const PLANTUML_NATIVE_LEADERS = [
  "skinparam",
  "title",
  "caption",
  "header",
  "footer",
  "hide",
  "show",
  "scale",
  "legend",
  "endlegend",
  "note",
  String.raw`end\s+note`,
  "endnote",
  "together",
  // UML element keywords that may appear as block openers
  "class",
  "interface",
  "abstract",
  "enum",
  "namespace",
  "package",
  "actor",
  "participant",
  "usecase",
  "state",
  "object",
  "database",
];

const PLANTUML_NATIVE_RE = new RegExp(
  String.raw`^[ \t]*(?:${PLANTUML_NATIVE_LEADERS.join("|")})\b.*$`,
  "gim",
);

export const stripPlantumlNative = (text: string): string => {
  // First pass — single-line statements.
  let out = text.replaceAll(PLANTUML_NATIVE_RE, (line) => blank(line));
  // Second pass — `note ... end note` / `note ... endnote` blocks.
  out = out.replaceAll(/note\b[\s\S]*?\bend\s*note\b/gi, (block) =>
    blank(block),
  );
  return out;
};

// ── Pass 4: opaque C4 macros ────────────────────────────────────────

const OPAQUE_MACRO_NAMES = [
  // Layout / view directives
  "LAYOUT_TOP_DOWN",
  "LAYOUT_LEFT_RIGHT",
  "LAYOUT_LANDSCAPE",
  "LAYOUT_WITH_LEGEND",
  "LAYOUT_AS_SKETCH",
  // Legend / element visibility
  "SHOW_LEGEND",
  "SHOW_FLOATING_LEGEND",
  "SHOW_DYNAMIC_LEGEND",
  "SHOW_ELEMENT_TYPE",
  "SHOW_PERSON_SPRITE",
  "SHOW_PERSON_PORTRAIT",
  "SHOW_PERSON_OUTLINE",
  "HIDE_STEREOTYPE",
  "HIDE_PERSON_SPRITE",
  "SET_SKETCH_STYLE",
  "SetDefaultLegendEntries",
  "UpdateLegendTitle",
  // Property table
  "SetPropertyHeader",
  "AddProperty",
  "WithoutPropertyHeader",
  // Tag declarations
  "AddElementTag",
  "AddRelTag",
  "AddBoundaryTag",
  "AddNodeTag",
  "AddPersonTag",
  "AddSystemTag",
  "AddContainerTag",
  "AddComponentTag",
  "AddExternalContainerTag",
  "AddExternalComponentTag",
  "AddExternalPersonTag",
  "AddExternalSystemTag",
  // Style overrides
  "UpdateElementStyle",
  "UpdateRelStyle",
  "UpdateBoundaryStyle",
  "UpdateContainerBoundaryStyle",
  "UpdateEnterpriseBoundaryStyle",
  "UpdateSystemBoundaryStyle",
  "increment",
];

const OPAQUE_MACRO_RE = new RegExp(
  String.raw`^[ \t]*(?:${OPAQUE_MACRO_NAMES.join("|")})\s*\(`,
);

/**
 * Strip lines opening with a known opaque macro call. The macro may
 * span multiple lines (multi-line `$arg=` list), so we balance the
 * parentheses character-by-character starting at the opening `(`.
 *
 * `text` is rewritten in place; the same string length is preserved
 * (paren-counter walks the buffer character by character).
 */
export const stripOpaqueMacros = (text: string): string => {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!OPAQUE_MACRO_RE.test(line)) {
      out.push(line);
      i++;
      continue;
    }
    // Find the opening paren on this line and balance through the rest
    // of the buffer.
    const openIdx = line.indexOf("(");
    if (openIdx === -1) {
      out.push(line);
      i++;
      continue;
    }
    let depth = 0;
    let j = i;
    let closed = false;
    const blankedLines: string[] = [];
    while (j < lines.length) {
      const current = j === i ? line : lines[j];
      let blanked = "";
      for (let k = 0; k < current.length; k++) {
        const ch = current[k];
        const inPrefix = j === i && k < openIdx;
        if (!inPrefix && ch === "(") depth++;
        else if (!inPrefix && ch === ")") {
          depth--;
          if (depth === 0) {
            // Blank the closing `)`, then copy the original trailing
            // characters on the same line — anything after `)` may be
            // a separate macro call we shouldn't touch.
            blanked += ` ${current.slice(k + 1)}`;
            closed = true;
            break;
          }
        }
        blanked += " ";
      }
      blankedLines.push(blanked);
      j++;
      if (closed) break;
    }
    if (!closed) {
      // Unbalanced — fall back to per-line strip of just the opening
      // line so we don't accidentally eat the rest of the file.
      out.push(blank(line));
      i++;
      continue;
    }
    out.push(...blankedLines);
    i = j;
  }
  return out.join("\n");
};

// ── Pass 4.5: arithmetic after auto-number values ───────────────────

/**
 * PUML preprocessor lets `$index=Index()-1` and legacy dynamic
 * diagrams use `$index-1`. The C4 macro grammar has no notion of
 * arithmetic expressions — `)` / `$index` must be followed by `,`
 * or `)`, so the bare `-1` tail would produce parser recovery noise.
 *
 * The architectural meaning of `Index()-1` is "this step's index
 * minus one" — a presentation-time auto-numbering offset that
 * does not survive into the Model anyway (the Index() sentinel
 * itself already collapses to `Relation.order = undefined`).
 *
 * Strategy: strip the `[op N]` tail after a function-call's `)` or
 * a variable ref so the parser sees a clean `Index()` / `$index`.
 * Byte length preserved as usual.
 *
 * Pattern: literal `)` or `$name` followed by optional whitespace,
 * an operator (`+ - * /`), more whitespace, and digits. The
 * operator/digits are blanked; the value head survives.
 */
const arithmeticTailLength = (text: string, start: number): number => {
  let i = start;
  while (i < text.length && /[ \t]/u.test(text[i])) i++;
  if (!"+-*/".includes(text[i] ?? "")) return 0;
  i++;
  while (i < text.length && /[ \t]/u.test(text[i])) i++;
  const digitsStart = i;
  while (i < text.length && /\d/u.test(text[i])) i++;
  return i > digitsStart ? i - start : 0;
};

export const stripArithmeticAfterFunctionCalls = (text: string): string => {
  let out = "";
  let i = 0;
  let quote: '"' | "'" | undefined;

  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = undefined;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === ")") {
      out += ch;
      const tailLength = arithmeticTailLength(text, i + 1);
      if (tailLength > 0) {
        out += blank(text.slice(i + 1, i + 1 + tailLength));
        i += 1 + tailLength;
        continue;
      }
      i++;
      continue;
    }

    if (ch === "$" && /[A-Za-z_]/u.test(text[i + 1] ?? "")) {
      const start = i;
      i += 2;
      while (i < text.length && /\w/u.test(text[i])) i++;
      out += text.slice(start, i);
      const tailLength = arithmeticTailLength(text, i);
      if (tailLength > 0) {
        out += blank(text.slice(i, i + tailLength));
        i += tailLength;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
};

// ── Pass 5: deployment blocks (info-issue) ──────────────────────────

const DEPLOYMENT_MACRO_NAMES = [
  "Deployment_Node_L",
  "Deployment_Node_R",
  "Deployment_Node",
  "Node_L",
  "Node_R",
  "Node",
];

const DEPLOYMENT_HEAD_RE = new RegExp(
  String.raw`\b(?:${DEPLOYMENT_MACRO_NAMES.join("|")})\s*\(`,
);

/**
 * Walk `text` looking for deployment-macro names. When found, balance
 * the `( ... )` argument list AND the optional trailing `{ ... }`
 * body, then whitespace the entire span.
 */
export const stripDeploymentBlocks = (
  text: string,
  file: string,
): { text: string; issues: PreParseIssue[] } => {
  const issues: PreParseIssue[] = [];
  // Iterative scan: walk through `text`, replacing each matched
  // deployment span with whitespace of equal length.
  const chars = [...text];
  let scanFrom = 0;
  while (scanFrom < text.length) {
    DEPLOYMENT_HEAD_RE.lastIndex = scanFrom;
    const tail = text.slice(scanFrom);
    const m = DEPLOYMENT_HEAD_RE.exec(tail);
    if (!m) break;
    const matchStart = scanFrom + m.index;
    const parenStart = matchStart + m[0].length - 1; // index of `(`
    // Balance parens.
    let depth = 0;
    let p = parenStart;
    while (p < text.length) {
      const ch = text[p];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
      p++;
    }
    if (depth !== 0) break; // unbalanced — leave the rest alone
    let end = p + 1;
    // Optional `{ ... }` body — skip whitespace, then balance braces if
    // we see `{`.
    let q = end;
    while (q < text.length && /\s/.test(text[q])) q++;
    if (text[q] === "{") {
      let bDepth = 1;
      q++;
      while (q < text.length && bDepth > 0) {
        if (text[q] === "{") bDepth++;
        else if (text[q] === "}") bDepth--;
        q++;
      }
      if (bDepth === 0) end = q;
    }
    // Whitespace out [matchStart, end).
    for (let k = matchStart; k < end; k++) {
      if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " ";
    }
    issues.push({
      kind: "info",
      message:
        "Deployment view macro recognised but ignored — aact's C4 scope is Static + Dynamic views only.",
      range: rangeOf(text, matchStart, end, file),
    });
    scanFrom = end;
  }
  return { text: chars.join(""), issues };
};

// ── Pass 6: keep only the first diagram ─────────────────────────────

/**
 * Whitespace out everything after the first `@enduml` (inclusive of
 * subsequent `@startuml ... @enduml` blocks). Emits one info-issue
 * pointing at the start of the second `@startuml`.
 */
export const keepFirstDiagram = (
  text: string,
  file: string,
): { text: string; issues: PreParseIssue[] } => {
  const firstEndUml = text.search(/@enduml\b/);
  if (firstEndUml < 0) return { text, issues: [] };
  const afterFirst = firstEndUml + "@enduml".length;
  const remainder = text.slice(afterFirst);
  const nextStart = remainder.search(/@startuml\b/);
  if (nextStart < 0) return { text, issues: [] };
  const absNextStart = afterFirst + nextStart;
  // Whitespace out [absNextStart .. end of text).
  const chars = [...text];
  for (let k = absNextStart; k < chars.length; k++) {
    if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " ";
  }
  return {
    text: chars.join(""),
    issues: [
      {
        kind: "info",
        message:
          "Multiple `@startuml ... @enduml` diagrams in file — only the first is processed.",
        range: rangeOf(text, absNextStart, chars.length, file),
      },
    ],
  };
};

// ── Pass 3.5: extract attached properties ──────────────────────────

/**
 * C4-PlantUML stdlib lets the user prefix any element / relation
 * macro with a property table:
 *
 *     SetPropertyHeader("Property", "Value")    ' optional; defaults shown
 *     AddProperty("region", "us-east-1")
 *     AddProperty("tier",   "premium")
 *     Container(api, "API", "Node")
 *
 * The properties attach to the **next in-scope macro call** and then
 * reset. `WithoutPropertyHeader()` flags "no header row on render"
 * but doesn't change the key=value semantics we keep on Model — we
 * surface only the user-typed AddProperty entries.
 *
 * Scan order: preProcessor + line comments already gone, but the
 * macro lines themselves are still here. We walk lines, accumulate
 * pending rows, attach on the first macro line that opens an
 * in-scope C4 family call, then reset. Deployment-block macros
 * (`Deployment_Node*`) are not in our scope — properties stacked
 * for them get dropped together with the block during
 * `stripDeploymentBlocks`.
 *
 * Returns a 1-based-line-keyed map. The downstream lowering
 * (`toModel`) looks up `element.sourceLocation.start.line` /
 * `relation.sourceLocation.start.line` against this map.
 */

const IN_SCOPE_MACRO_PREFIXES: readonly string[] = [
  // Element keywords.
  "Container",
  "ContainerDb",
  "ContainerQueue",
  "Container_Ext",
  "ContainerDb_Ext",
  "ContainerQueue_Ext",
  "Component",
  "ComponentDb",
  "ComponentQueue",
  "Component_Ext",
  "ComponentDb_Ext",
  "ComponentQueue_Ext",
  "System",
  "SystemDb",
  "SystemQueue",
  "System_Ext",
  "SystemDb_Ext",
  "SystemQueue_Ext",
  "Person",
  "Person_Ext",
  // Boundaries.
  "Boundary",
  "System_Boundary",
  "Container_Boundary",
  "Enterprise_Boundary",
  // Relation family — list explicit variants; the regex orders by
  // length so `RelIndex_Back_Neighbor` wins over `Rel`.
  "RelIndex_Back_Neighbor",
  "RelIndex_Neighbor",
  "RelIndex_Back",
  "RelIndex_Down",
  "RelIndex_Up",
  "RelIndex_Left",
  "RelIndex_Right",
  "RelIndex_Down_Long",
  "RelIndex_Up_Long",
  "RelIndex_Left_Long",
  "RelIndex_Right_Long",
  "RelIndex",
  "BiRel_Neighbor",
  "BiRel_Down",
  "BiRel_Up",
  "BiRel_Left",
  "BiRel_Right",
  "BiRel_Down_Long",
  "BiRel_Up_Long",
  "BiRel_Left_Long",
  "BiRel_Right_Long",
  "BiRel",
  "Rel_Back_Neighbor",
  "Rel_Neighbor",
  "Rel_Back_Down",
  "Rel_Back_Up",
  "Rel_Back_Left",
  "Rel_Back_Right",
  "Rel_Back",
  "Rel_Down_Long",
  "Rel_Up_Long",
  "Rel_Left_Long",
  "Rel_Right_Long",
  "Rel_Down",
  "Rel_Up",
  "Rel_Left",
  "Rel_Right",
  "Rel",
];

const IN_SCOPE_MACRO_RE = new RegExp(
  String.raw`^[ \t]*(?:${[...IN_SCOPE_MACRO_PREFIXES]
    .toSorted((a, b) => b.length - a.length)
    .join("|")})\s*\(`,
);

// `AddProperty("a", "b")` and friends — captures the inside of the
// outermost parens so we can split on top-level commas. Stripping
// the trailing `)` and `{` is handled by the caller.
const ADD_PROPERTY_RE = /^[ \t]*AddProperty\s*\((.*?)\)\s*$/;
const SET_PROPERTY_HEADER_RE = /^[ \t]*SetPropertyHeader\s*\((.*?)\)\s*$/;
const WITHOUT_PROPERTY_HEADER_RE = /^[ \t]*WithoutPropertyHeader\s*\(\s*\)/;
const splitTopLevelArgs = (raw: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let inString = false;
  let escape = false;
  for (const ch of raw) {
    if (escape) {
      buf += ch;
      escape = false;
      continue;
    }
    if (ch === "\\") {
      buf += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      buf += ch;
      continue;
    }
    if (!inString) {
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
      else if (ch === "," && depth === 0) {
        out.push(buf.trim());
        buf = "";
        continue;
      }
    }
    buf += ch;
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
};

// C4-PlantUML stdlib `AddProperty` accepts either positional values or
// named-arg form `$colN="value"`. The named-arg form is heavily used
// by the upstream `TestPropertyMissingColumns.puml` fixture — without
// stripping the `$colN=` prefix the named-arg literal would land on
// `Model.properties` as a synthetic key like `$col1="col1"`.
//
// Input is one `AddProperty(...)` arg string (already top-level split)
// — bounded by a single source line, so the trailing `(.*)$` cannot
// trigger pathological backtracking.
// eslint-disable-next-line sonarjs/slow-regex
const NAMED_ARG_RE = /^\$[A-Za-z_]\w*\s*=\s*(.*)$/;

const unwrapArg = (raw: string): string => {
  const named = NAMED_ARG_RE.exec(raw);
  const target = (named ? named[1] : raw).trim();
  // `JSON.parse` handles the full set of stdlib escape sequences
  // (`\"`, `\\`, `\n`, …) symmetrically with `JSON.stringify` in the
  // generator, so the round-trip through `aact generate` preserves
  // backslashes and quotes verbatim. Malformed literals (a bare
  // identifier, an unterminated string) fall through as verbatim
  // text — the parser shouldn't crash on a property whose value
  // shape we don't recognise.
  if (target.startsWith('"') && target.endsWith('"') && target.length >= 2) {
    try {
      const parsed = JSON.parse(target) as unknown;
      if (typeof parsed === "string") return unescapePlantumlText(parsed);
    } catch {
      // JSON.parse rejects literal control characters inside a
      // string literal (raw tabs, newlines), even though the PUML
      // input might carry them. Fall back to a lenient quote-strip
      // so those values still land on Model.properties — the
      // whitespace-only-key drop below catches the genuinely
      // empty cases either way.
      return unescapePlantumlText(target.slice(1, -1));
    }
  }
  return unescapePlantumlText(target);
};

interface PendingProps {
  rows: string[][];
}

const buildPropertiesObject = (
  rows: readonly (readonly string[])[],
): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row[0];
    // Skip rows whose key is empty or whitespace-only. Upstream
    // fixtures (`TestPropertyMissingColumns.puml`) use ` ` strings
    // as column placeholders — keeping them on Model.properties
    // would let " " (and "  ", and "\t") survive as semantically
    // meaningless keys.
    if (!key || key.trim() === "") continue;
    out[key] = row[1] ?? "";
  }
  return out;
};

export const extractAttachedProperties = (
  text: string,
): AttachedPropertiesByLine => {
  const lines = text.split("\n");
  const map = new Map<number, Readonly<Record<string, string>>>();
  let pending: PendingProps = { rows: [] };

  for (const [i, line] of lines.entries()) {
    // SetPropertyHeader / WithoutPropertyHeader are render-time
    // semantics; we keep no header on Model.properties. They still
    // count as boundary markers that reset any pending rows from
    // a previous (unused) block.
    if (
      SET_PROPERTY_HEADER_RE.test(line) ||
      WITHOUT_PROPERTY_HEADER_RE.test(line)
    ) {
      pending = { rows: [] };
      continue;
    }

    const addMatch = ADD_PROPERTY_RE.exec(line);
    if (addMatch) {
      const args = splitTopLevelArgs(addMatch[1]).map((a) => unwrapArg(a));
      pending.rows.push(args);
      continue;
    }

    if (IN_SCOPE_MACRO_RE.test(line) && pending.rows.length > 0) {
      const props = buildPropertiesObject(pending.rows);
      if (Object.keys(props).length > 0) {
        // 1-based line index — matches `SourceLocation.start.line`.
        map.set(i + 1, props);
      }
      pending = { rows: [] };
    }
  }

  return map;
};

// ── Composite ───────────────────────────────────────────────────────

/**
 * Apply all pre-lex passes in order. Each pass preserves string length,
 * so the resulting `text` has identical offsets for surviving content.
 *
 * `extractAttachedProperties` runs **before** `stripOpaqueMacros`
 * blanks the `AddProperty` lines — the strip itself is unchanged, the
 * extracted map lives on `PreParseResult.attachedProperties` for
 * `toModel` to consume.
 */
export const preParse = (text: string, file: string): PreParseResult => {
  const preprocessorIssues = collectIgnoredLocalIncludes(text, file);
  const simpleConstants = extractSimpleConstants(text);
  let cur = stripPreprocessor(text);
  cur = stripLineComments(cur);
  cur = stripPlantumlNative(cur);
  const attachedProperties = extractAttachedProperties(cur);
  cur = stripOpaqueMacros(cur);
  cur = stripArithmeticAfterFunctionCalls(cur);
  const dep = stripDeploymentBlocks(cur, file);
  cur = dep.text;
  const diag = keepFirstDiagram(cur, file);
  cur = diag.text;
  return {
    text: cur,
    issues: [...preprocessorIssues, ...dep.issues, ...diag.issues],
    attachedProperties,
    simpleConstants,
  };
};
