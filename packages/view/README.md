# `@aact/view`

Browser-based live viewer for the C4 architecture model that
[aact](https://github.com/Byndyusoft/aact) parses. The Structurizr
DSL / C4-PUML / model-json source you point `aact check` at is the
source of truth; `aact view` renders it as an interactive graph
that re-layouts every time you save the file.

## Install

`@aact/view` is an optional companion package. Install alongside
aact in the project you want to inspect:

```bash
npm install -D @aact/view
# or
pnpm add -D @aact/view
```

The core `aact` package detects `@aact/view` via dynamic import; no
configuration plumbing.

## Usage

```bash
npx aact view                    # uses aact.config.ts in cwd
npx aact view --port 4321        # pin port (defaults to 3000 with auto-fallback)
npx aact view --no-open          # skip auto-opening the browser
npx aact view --diff main:architecture.dsl
```

The console prints a URL with a per-session auth token:

```
▸ aact view ready at http://localhost:3000/?token=AbCd…
  watching ./architecture.dsl for changes (Ctrl-C to stop)
```

Open that URL. Saving the source file re-parses through aact-core
and pushes the new model over WebSocket — the graph re-layouts in
place.

`--diff <baseline>` loads the baseline once at boot (file path, git
ref, or stdin with `--diff-format`) and keeps the current side live
from `aact.config.ts`. The canvas colors changed nodes / relations;
the right panel shows the diff summary, grouped architectural changes,
and primitive changes.

## What you see

The canvas follows the Simon Brown C4 reference palette (Person
deep blue, System mid blue, Container lighter, Component lightest,
externals neutral slate). Three view modes in the top bar:

- **Drill** — classic C4 levels. Double-click a boundary to descend;
  breadcrumb walks back up.
- **Expand** — toggle boundaries open inline; parents stay visible
  so cross-context interactions read in one frame.
- **Flat** — every boundary expanded at once; read-only big-picture
  view.

Two more topbar toggles cover edge presentation:

- **Edge style** — Curve / Smooth / Step. Personal preference,
  persisted in localStorage.
- **Edge filter** — All / Cross-BC. In Cross-BC mode intra-boundary
  relations fade to background and inter-context interactions light
  up; useful when an API gateway has many fan-outs and you want to
  see which Bounded Contexts actually talk.

Hover a node to highlight only the edges incident to it; everything
else dims. The right-side details panel shows the selected
element / boundary's tags, technology, source location (clickable —
opens your IDE), properties, and outgoing relations.

The full visual + interaction spec lives in [`DESIGN.md`](./DESIGN.md).

## Live reload

A chokidar watcher debounces source changes by 80ms and coalesces
in-flight reloads. When the parser fails (broken DSL syntax) the
last good model stays on screen and the status pill flips to
"error" with the parser message — restoring the file recovers via
the next successful broadcast.

## Protocol vs CLI `ViewData`

Two "view" shapes exist — keep them separate:

- **`aact view`'s `ViewData`** (the core `aact` package) is the `--json`
  envelope _result_ of running the CLI command — a one-shot summary (port,
  URL, whether this companion was found).
- **`@aact/view`'s `ModelEnvelope`** is this package's **live workbench
  protocol** — the payload served at `/api/model` and pushed over `/api/ws`
  on every reload. It carries the normalized Model itself.

They are not interchangeable: the CLI envelope describes _the command run_,
the workbench envelope _streams the model_. Don't conflate them.

## Security

`aact view` listens on `localhost` only. Each session generates a
24-byte random auth token; `/api/model` and the `/api/ws` upgrade
require it as either a query string parameter (first navigation) or
a `HttpOnly` cookie (set on first HTML response). This stops random
browser tabs / extensions on the same machine from reading your
architecture graph or following `vscode://file/...` source links.

## What it doesn't do

- **Editing.** The viewer is read-only. Source DSL/PUML stays the
  authority; your IDE is the editor.
- **Per-user layout persistence.** Positions are deterministic from
  the model — every re-parse re-runs ELK so the layout is
  reproducible across machines.
- **ArchiMate / Deployment view / UML / BPMN.** C4 paradigm only,
  matching aact-core scope.

## Known follow-ups

These are flagged but not built:

- **ELK in a worker** — layout currently runs on the main thread.
  Sub-100ms on typical C4 models (V < 100), can take 300-500ms at
  V > 500. Canonical fix: ship `elkjs/lib/elk-worker.min.js` as a
  static asset via Vite `?url` + `new ELK({ workerUrl })` so ELK
  spawns its own sub-worker out of the main thread.
- **Search / filter by name.**
- **Focus mode** — pick a node, dim all non-1-hop-neighbours.
- **Export to SVG / PNG.**

## License

GPL-3.0, matching aact-core.
