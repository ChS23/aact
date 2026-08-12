<img width="150" height="150" alt="aact logo" src="https://github.com/user-attachments/assets/abbcea49-51c9-4e57-8cbe-a1ed11d1fa48" />

# Architecture As Code Tools (aact)

[![npm version](https://img.shields.io/npm/v/aact)](https://www.npmjs.com/package/aact)
[![test workflow](https://github.com/Byndyusoft/aact/actions/workflows/test.yaml/badge.svg?branch=main)](https://github.com/Byndyusoft/aact/actions/workflows/test.yaml)

🇷🇺 [Русский](README.md) | 🇬🇧 **English**

<p align="center">
  <img src="docs/demo/demo.gif" alt="aact demo: init → check → fix → analyze" width="820"/>
</p>

CLI and library for validating, analyzing, and generating microservice architectures described "as Code" (PlantUML C4, Structurizr).

Three things this repo gives you:

1. Test patterns for microservice architecture described in PlantUML ([#](#architecture-testing))
2. Architecture auto-generation ([#](#architecture-auto-generation))
3. Modular monolith architecture testing ([#](#modular-monolith-testing))

See the [roadmap](roadmap.md) for what's planned. PRs and issues welcome.

A [pattern catalogue](patterns.md) of design principles and microservice patterns with worked test examples is being added incrementally.

<img src="https://github.com/Byndyusoft/aact/assets/1096954/a3c3b3b0-a09b-4da7-aca4-5538159b371c" width="15"/> Telegram channel: [Distributed Systems Architecture](https://t.me/rsa_enc) (Russian)

aact can be used two ways: as a **CLI** (`npx aact check`, auto-fix, artefact generation) or as a **library** (import `aclRule`, `analyzeArchitecture`, etc. into your vitest/jest tests). CLI usage below; library usage in [its own section](#using-as-a-library).

## Quick Start (CLI)

In an empty directory:

```bash
# Creates aact.config.ts and a starter architecture.puml with one
# deliberate violation so there's something to fix
npx aact init

# Shows one CRUD-rule violation (orders → orders_db directly)
npx aact check

# Apply auto-fix: insert orders_repo as an intermediary to the DB
npx aact check --fix

# Clean again
npx aact check
```

After that, edit `architecture.puml` to describe your own system — the syntax is [C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML).

### Other commands

```bash
npx aact check --dry-run             # preview auto-fix without writing
npx aact model                       # inspect the normalized C4 model
npx aact analyze                     # coupling / cohesion metrics
npx aact view                        # local live workbench in the browser
npx aact generate --format plantuml  # generate .puml from the source
npx aact generate --format model-json
npx aact generate --format kubernetes
npx aact generate --format compose
```

`--fix` writes edits back to `source.path`. v3 no longer has a separate `source.writePath`.

### What `aact init` creates

Two files side by side:

- **`aact.config.ts`** — source settings and the set of enabled rules. Uses `import type { AactConfig }` — no runtime package resolution, so `npx aact check` works without `npm install aact`.
- **`architecture.puml`** — a starter C4 diagram with one service, one DB, and a deliberate CRUD-rule violation. Replace with your own.

```ts
// aact.config.ts (excerpt)
import type { AactConfig } from "aact";

const config: AactConfig = {
  source: {
    type: "plantuml", // "plantuml" | "structurizr" | "model-json" | "kubernetes" | "compose"
    path: "./architecture.puml",
  },
  rules: {
    acl: true,
    acyclic: true,
    apiGateway: true,
    crud: true,
    dbPerService: true,
    cohesion: true,
    stableDependencies: true,
    commonReuse: true,
  },
};

export default config;
```

## AI agents

aact ships an agent skill (`aact-architect`) and a stable JSON envelope so AI coding agents (Copilot, Claude, Codex, Cursor, Cline) can drive it without parsing text:

```bash
# Install the skill so the agent knows when to invoke aact
npx aact skill install --claude     # Claude Code
npx aact skill install --codex      # Codex (shared ~/.agents/skills path)
npx aact skill install --cursor     # Cursor (same shared path)
npx aact skill install --copilot    # GitHub Copilot (same shared path)
npx aact skill install --cline      # Cline
npx aact skill install --all        # all clients at once

# Machine-readable commands (every command supports --json)
npx aact model --json    # parsed C4 model + diagnostics
npx aact check --json    # violations + suggestedFixes + rule catalogue
npx aact check --sarif   # SARIF v2.1.0 for GitHub Code Scanning
npx aact analyze --json  # cohesion / coupling metrics
```

Exit codes: `0` clean, `1` violations, `2` tool error. The envelope shape is stable from `schemaVersion: 1` — see [AGENTS.md](AGENTS.md) for the full agent-facing contract.

## Using as a library

```ts
import {
  plantumlFormat,
  aclRule,
  acyclicRule,
  crudRule,
  analyzeArchitecture,
  validateModel,
} from "aact";

// Load via format — returns Model + diagnostic issues
const { model, issues } = await plantumlFormat.load("architecture.puml");
for (const issue of issues) console.warn(`model:`, issue);

// Run rules — uniform signature (model, options?) => Violation[]
const aclViolations = aclRule.check(model);
const cyclicViolations = acyclicRule.check(model);
const crudViolations = crudRule.check(model, { repoTags: ["repo", "dao"] });

// Metrics
const { report } = analyzeArchitecture(model);
console.log(`Elements: ${report.elementsCount}`);

// Direct access to elements / boundaries — Record<name, ...>
for (const element of Object.values(model.elements)) {
  console.log(`${element.kind} ${element.name}`);
}
const ordersService = model.elements["orders"];
```

Full API surface: [`Model`](./src/model/types.ts), [`Format`](./src/formats/types.ts), [`RuleDefinition`](./src/rules/types.ts). See `CHANGELOG.md` for v2 → v3 migration notes.

## Examples

Runnable out of the box (clone the repo, `cd examples/<name>`, `npx aact check`):

- [`examples/ecommerce-structurizr/`](examples/ecommerce-structurizr/) — Structurizr source with `workspace.json` + `workspace.dsl`, full rule cycle and auto-fix.
- [`examples/custom-rules/`](examples/custom-rules/) — PlantUML source + two project rules (`bcIsolation`, `requireOwnerTag`) via `defineConfig` / `defineRule` — how to write and wire your own rules.
- [`examples/violations-demo/`](examples/violations-demo/) — a small set of deliberate violations across every rule, useful to see the output and the fixes `--fix` proposes.

Integration test scenarios (for package developers, run via `vitest`):

- [`examples/banking-plantuml/`](examples/banking-plantuml/), [`examples/common-reuse-plantuml/`](examples/common-reuse-plantuml/) and [`examples/microservices-structurizr/`](examples/microservices-structurizr/) — integration tests on real architectures from `fixtures/`.

## Documentation

- [Pattern catalogue](patterns.md) — principles and patterns with worked test examples
- [ADRs](ADRs/) — Architecture Decision Records
- [Roadmap](roadmap.md) — what's planned
- [AGENTS.md](AGENTS.md) — instructions for AI coding agents working on aact

## Testing

The test stack is split into four levels:

```bash
pnpm test            # all unit + integration + e2e
pnpm test:unit       # unit only
pnpm test:integration # integration on real fixtures
pnpm test:e2e        # subprocess CLI tests via execa
pnpm test:coverage   # with v8 coverage + thresholds
pnpm test:mutation   # Stryker mutation testing
```

**Test quality metrics:**

- **Coverage** (v8) thresholds in CI — statements ≥95%, branches ≥85%, functions ≥95%, lines ≥95%
- **Mutation score** (Stryker) ≥95% — every meaningful change to the source must break at least one test
- **Property-based** (`@fast-check/vitest`) tests on option-bearing rules — guards against the "hardcoded literal where the option should be read" bug
- **Inline snapshots** on generators for output-format regression pins
- **E2E** on the `init → check → fix → recheck` chain via `npx aact` in a subprocess

## Talks and articles

### "Architecture is code — why not cover it with tests?!"

<a href="https://www.youtube.com/watch?v=POIbWZh68Cg"><img src="https://github.com/Byndyusoft/aact/assets/1096954/e011958e-12c8-4fb9-97f4-a61779408e4f" width="400"/></a>
<a href="https://www.youtube.com/watch?v=tZ-FQeObSjY"><img src="https://github.com/Byndyusoft/aact/assets/1096954/daea29de-776b-49a0-b781-ad4eba9a2221" width="400"/></a>
https://www.youtube.com/watch?v=POIbWZh68Cg &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; https://www.youtube.com/watch?v=tZ-FQeObSjY

(Talks in Russian.)

[Article on Habr](https://habr.com/ru/articles/800205/) (Russian).

### Architecture auto-generation

<a href="https://www.youtube.com/watch?v=fb2UjqjHGUE"><img src="https://github.com/Byndyusoft/aact/assets/1096954/ecb54a6f-f6c1-4816-972b-c845069e9f4a" width="400"/></a><br/>
https://www.youtube.com/watch?v=fb2UjqjHGUE

(Talk in Russian.)

# Architecture testing

## What it is, the pain it addresses, and where to start

If architecture is "as code", why not cover it with tests?!

The idea and this open-source repo received unexpected positive response — the approach hit a real pain point and turned out to be applicable and useful.

The approach helps solve **the staleness, declarativeness, and lack-of-control problems of IT architecture and infrastructure** (with the constraint that architecture and infrastructure must be described "as code").

The tests check two big things:

- the architecture is in sync with what is actually running in production
- the "drawn" architecture conforms to the chosen design principles and patterns

More on the approach, the problems it solves, the workflow of the example in this repo, and the principles checked by the included tests is in the [slides](https://docs.google.com/presentation/d/16_3h1BTIRyREXO_oSqnjEbRJAnN3Z4aX/edit?usp=sharing&ouid=106100367728328513490&rtpof=true&sd=true) (Russian).

### Workflow

<img src="https://github.com/Byndyusoft/aact/assets/1096954/9b0ad909-b789-4395-a580-9fb44397afa0" height="350">

### Visualization of one auto-checked principle (no business logic in CRUD services)

<img src="https://github.com/Byndyusoft/aact/assets/1096954/292b1bbd-0f18-40be-9560-65385a1d4df9" height="300">

## Example architecture used in tests

[![C4](fixtures/architecture/Demo%20Tests.svg)](fixtures/architecture/Demo%20Tests.svg)

## Example tests

1. [find diff in configs and uml containers](examples/banking-plantuml/architecture.test.ts) — checks that the list of microservices in the architecture matches the [infrastructure config](fixtures/kubernetes/microservices)
2. [find diff in configs and uml dependencies](examples/banking-plantuml/architecture.test.ts) — checks that microservice dependencies in the architecture match the [infrastructure config](fixtures/kubernetes/microservices)
3. [check that urls and topics from relations exist in config](examples/banking-plantuml/architecture.test.ts) — checks that REST URLs and Kafka topics on relations in the architecture exist in the [infrastructure config](fixtures/kubernetes/microservices)
4. [only acl can depend on external systems](test/rules/acl.test.ts) — checks the chosen ACL (Anti-Corruption Layer) integration principle — only ACL services may depend on external systems
5. [connect to external systems only by API Gateway or kafka](examples/banking-plantuml/architecture.test.ts) — checks that all external integrations go through an API Gateway or Kafka

# Architecture auto-generation

## Generate architecture from infrastructure described "as code"

Comparison of the hand-drawn architecture and the auto-generated one.

### Hand-drawn:

[![C4](fixtures/architecture/Demo%20Tests.svg)](fixtures/architecture/Demo%20Tests.svg)

### Auto-generated:

[![C4](fixtures/architecture/Demo%20Generated.svg)](fixtures/architecture/Demo%20Generated.svg)

# Modular monolith testing

Architecture tests apply not only to microservices but to monolith architecture too — especially modular monoliths.

- [Modular monolith architecture testing in C#](https://github.com/Byndyusoft/aact/tree/main/ModularMonolith)

# Code-based architecture testing

You can also extract architecture information from the implementation code itself — particularly if the code is well-structured.

- [Extracting architecture information from system code](https://github.com/Byndyusoft/byndyusoft-architecture-testing)
