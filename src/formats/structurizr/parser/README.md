# Structurizr DSL parser

A hand-written [chevrotain](https://chevrotain.io) parser for the
Structurizr DSL — replacement for the regex loader at `../load.ts`.
Tracking strategy: `memory/project_v3_parser_strategy.md`.

## Status

Live. `parseSource(text, filePath)` from `./index.ts` is the entry
point used by `../load.ts` when the loader is pointed at a `.dsl`
file. The accepted surface is documented rule-by-rule in `grammar.md`
(§1 "In scope") with deliberate gaps listed under "Remaining gaps".

## Why a hand-written parser

Regex loaders lose source positions — diagnostics cannot point to
`file:line:col`, and `--fix` is `search/replace` (fragile). chevrotain
gives a CST/AST with locations and error recovery, so a partial parse
plus parse errors surface as `ModelIssue` rather than a hard failure.

A maintained JS/TS Structurizr DSL parser with usable source locations
does not exist as of May 2026. Alternatives evaluated and rejected in
`project_v3_parser_strategy.md` §10.

## License posture

**aact is GPL-3.0.** The references listed below are studied for
grammar and behaviour — never copied verbatim into this repository.
Grammar and syntax are not copyrightable; the chevrotain grammar in this
directory is original work.

Test inputs under `test/formats/structurizr/parser/` are authored from
scratch in our fixture style, _informed by_ but not copied from
upstream test suites.

## References

Fetched on demand by `scripts/fetch-parser-refs.sh` into the
gitignored `.parser-refs/` directory.

| Reference                                                                                           | Use                                                                                                                                              | License       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| [structurizr/dsl](https://github.com/structurizr/dsl) — official Java parser and language reference | Authoritative grammar and behaviour. Read `src/test/java/com/structurizr/dsl/` for expected `input → behaviour` pairs to inform our test corpus. | Apache-2.0    |
| [Structurizr DSL Language Reference](https://docs.structurizr.com/dsl/language)                     | Token-level documentation.                                                                                                                       | Documentation |

## Files

| File          | Responsibility                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`    | Public entry point `parseSource(text, filePath): ChevrotainParseResult`. Orchestrates the pipeline below.                         |
| `tokens.ts`   | Chevrotain token definitions and the `StructurizrLexer` instance.                                                                 |
| `preParse.ts` | Post-lex passes: opaque-block stripping, deployment stripping, inline-directive stripping, hard-removed token diagnostics.        |
| `parser.ts`   | Chevrotain `CstParser` subclass. Productions match grammar.md §1.                                                                 |
| `ast.ts`      | Typed AST node interfaces. Discriminated union on `kind`.                                                                         |
| `visitor.ts`  | CST → AST visitor. Promotes chevrotain token positions to `SourceLocation`.                                                       |
| `toModel.ts`  | AST → canonical `Model` mapping. Applies `!impliedRelationships` strategy, joins nested group names, propagates `sourceLocation`. |
| `grammar.md`  | Target grammar (rule by rule, scope decisions).                                                                                   |

The pipeline: `joinContinuations → expandSubstitutions → tokenize →
normalizeKeywordCase → extractAndApplyArchetypes → stripOpaqueBlocks →
stripDeploymentBlocks → stripInlineDirectives → findHardRemovedTokens →
parse (CST) → buildAst → toModel`.

## Scope

In line with `project_v3_parser_strategy.md` §2 — full Structurizr DSL
within the C4 paradigm. Concrete scope and the list of deliberate gaps
live in `grammar.md`.
