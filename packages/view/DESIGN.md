---
name: aact view
version: 0.1.0
description: |
  Browser-based live viewer for the normalised C4 Model that
  `aact view` boots locally. Visual language follows the Simon
  Brown C4 reference palette so a Structurizr/PUML reader can
  open the canvas and orient in seconds.

tokens:
  color:
    palette:
      person:
        value: "#08427B"
        description: "C4 Person primary fill; high-contrast dark blue, used for Person nodes and the matching MiniMap dot."
      system:
        value: "#1168BD"
        description: "C4 Software System primary fill; the canonical 'our system' blue."
      container:
        value: "#438DD5"
        description: "C4 Container primary fill; one step lighter than System."
      component:
        value: "#85BBF0"
        description: "C4 Component primary fill; light blue, switches to dark text for contrast."
      external:
        value: "#475569"
        description: "Neutral slate for anything tagged `External`; collapses regardless of original kind so 'theirs vs ours' reads at a glance."
    accent:
      selection:
        value: "#38BDF8"
        description: "Selected node outline + incident edge highlight on hover."
      live:
        value: "#34D399"
        description: "WS connection status badge — live."
      lost:
        value: "#F87171"
        description: "WS connection status badge — disconnected/retrying."
      warn:
        value: "#FBBF24"
        description: "Loader-issue count in the workspace summary card."
    surface:
      canvas:
        value: "#0B1220"
        description: "ReactFlow / Svelte Flow canvas background."
      panel:
        value: "#0F172A"
        description: "Top bar + details panel base; one step lighter than canvas."
      elevated:
        value: "#1E293B"
        description: "Cards, edge label chips, MiniMap mask."
      border:
        value: "#334155"
        description: "Default panel/chip border."
      hairline:
        value: "#475569"
        description: "Stronger border for edge label chips so they pop on canvas."
    text:
      primary:
        value: "#F8FAFC"
        description: "Body + node labels."
      secondary:
        value: "#CBD5E1"
        description: "Descriptions, less-prominent meta."
      muted:
        value: "#94A3B8"
        description: "Workspace metadata, kind chips, idle controls."
      faint:
        value: "#64748B"
        description: "Edge stroke default, separators."

  typography:
    family:
      sans:
        value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif"
        description: "System stack; no custom font shipped to keep the workbench dependency-free."
    size:
      kind-chip:
        { value: "9px", description: "PERSON / CONTAINER / SYSTEM chip caps." }
      meta: { value: "10px", description: "Boundary meta line, edge labels." }
      body: { value: "11px", description: "Details panel rows, descriptions." }
      label: { value: "13-14px", description: "Node titles." }
      heading: { value: "18px", description: "Details panel heading." }
    weight:
      regular: { value: 400 }
      semibold: { value: 600 }
      bold: { value: 700 }
      heavy: { value: 800 }
    letter-spacing:
      caps: { value: "0.14em", description: "All-caps kind chips." }

  spacing:
    node-padding:
      value: "12px 14px"
      description: "Inner padding for ElementNode / PersonNode."
    elk:
      node-spacing:
        { value: "45px", description: "elk.spacing.nodeNode — sibling gap." }
      layer-spacing:
        {
          value: "80px",
          description: "elk.layered.spacing.nodeNodeBetweenLayers — gap between depth layers.",
        }
      padding-flat:
        {
          value: "[top=48, left=44, bottom=44, right=44]",
          description: "Default container padding.",
        }
      padding-expanded:
        {
          value: "[top=96, left=44, bottom=44, right=44]",
          description: "Expanded boundary padding — reserves space for the header.",
        }

  shape:
    radius:
      element: { value: "12px" }
      person: { value: "14px" }
      boundary: { value: "16px" }
      database:
        {
          value: "14px 14px 22px 22px / 14px 14px 30px 30px",
          description: "Pseudo-cylinder bottom.",
        }
      queue: { value: "999px", description: "Capsule for queue containers." }
    border:
      element-internal:
        {
          value: "transparent",
          description: "Solid fill carries the kind colour.",
        }
      element-external:
        {
          value: "1px solid #94A3B8",
          description: "Externals get a visible border + slate fill.",
        }
      boundary:
        {
          value: "2px dashed (palette.kind)",
          description: "Dashed C4 boundary in the boundary's kind colour.",
        }
    elevation:
      node:
        {
          value: "0 10px 28px -18px (fill, 70% alpha)",
          description: "Soft cast shadow scaled to node colour.",
        }
      label-chip: { value: "0 4px 12px -8px rgba(0,0,0,0.6)" }

  edge:
    stroke-default:
      {
        value: "#94A3B8",
        description: "Edges read on dark canvas without hover.",
      }
    stroke-width: { value: 1.8 }
    arrow:
      type: ArrowClosed
      size: 20
      color: matches-stroke
    label:
      background: "#1E293B"
      border: "1px solid #475569"
      radius: "6px"
      padding: "3px 8px"
      max-width: "240px"

components:
  element:
    file: "src/ElementNode.svelte"
    size: { width: 220, height: 110 }
    binds: ["kind", "label", "tech", "description", "external", "tags"]
    notes: "Gradient fill in palette.kind; Component uses light fill + dark text."
  person:
    file: "src/PersonNode.svelte"
    size: { width: 200, height: 130 }
    binds: ["label", "description"]
    notes: "Inline SVG silhouette (head circle + shoulders arc) above the kind chip."
  database:
    file: "src/DatabaseNode.svelte"
    matches-kind: ["SystemDb", "ContainerDb", "ComponentDb"]
    notes: "Cylinder via asymmetric border-radius + top cap div."
  queue:
    file: "src/QueueNode.svelte"
    matches-kind: ["SystemQueue", "ContainerQueue", "ComponentQueue"]
    notes: "Capsule via radius=999px."
  boundary:
    file: "src/BoundaryNode.svelte"
    size: { min-width: 260, min-height: 160 }
    binds: ["kind", "label", "childCount", "expanded", "canExpand"]
    notes: "Header (chip + label + meta) sits inside the container border; elk.padding[top] reserves space below it for children."

modes:
  drill:
    description: "Replace the visible scope when a boundary is entered; classic C4 levels with breadcrumb navigation."
  expand:
    description: "Toggle individual boundaries open inline — parent siblings stay visible."
  flat:
    description: "Everything expanded; read-only full-hierarchy overview."

interactivity:
  single-click: "Select node, populate details panel."
  double-click:
    drill: "Descend into boundary, push breadcrumb."
    expand: "Toggle boundary expansion."
    flat: "No-op."
  hover: "Incident edges brighten to selection accent and animate; non-incident edges dim to opacity 0.2."
  source-link: "Details panel rows render `vscode://file/<abs>:line:col` (or AACT_FILE_OPENER vendor scheme)."

export-as: tokens.json # compatible with W3C DTCG
---

# aact view — Design

This document captures the **visual language and interaction model** of
`@aact/view`. It is the source of truth for the SPA's look and feel — the
SKILL definitions live in `aact-architect`, architectural rationale lives in
`ADRs/Architecture workbench (aact view).md`, and this file pins the design
tokens and component contracts that node components and ELK layout share.

## Why the C4 reference palette

aact view targets architects who already read C4 diagrams produced by
Structurizr Lite, PlantUML, IcePanel, LikeC4. Matching Simon Brown's
canonical palette (`#08427B / #1168BD / #438DD5 / #85BBF0` going from System
Context down to Component) means a reader doesn't relearn what "blue" means.
Externals collapse to neutral slate so the **ours-vs-theirs** distinction
stays at a glance — that's the dimension architects actually scan for first
on a Container view.

## The three view modes

Three layout strategies share one ELK `layered` pipeline:

- **Drill** — current breadcrumb level only; entering a boundary replaces
  the canvas. Closest to a Structurizr Lite "Container view" → "Component
  view" workflow. Lowest visual density, easiest to scan.
- **Expand** — boundaries that the user toggles open render inline as
  containers, with parent siblings still visible. Useful when tracing a
  cross-boundary dependency without losing the surrounding context.
- **Flat** — every boundary is preconfigured as expanded. Single rendering
  of the full hierarchy. Useful for an overview screenshot or a high-level
  read; not for editing.

ELK `INCLUDE_CHILDREN` with `direction: RIGHT` powers Expand and Flat;
Drill uses flat-layered at one level. The edges passed to ELK are the
**visible edges** (after cross-hierarchy aggregation), not the raw model
relations — without this, `layered` has no dependency data and collapses
to a single vertical column.

## Cross-boundary edge aggregation

C4 Landscape shows Persons + Systems + System Boundaries; Container
boundaries are nested inside a System. A relation like
`buyer → landingApp` where `landingApp` lives inside a Container boundary
inside the System wouldn't have both endpoints visible at Landscape — so
we **lift** the target endpoint to the deepest currently-visible ancestor.
The user sees `Покупатель → Phuket Landing Platform` at Landscape, and
`Покупатель → Landing Web App` once they expand `Edge` inside the
platform.

Self-loops produced by aggregation (both endpoints resolve to the same
visible node) are dropped — internal relations show up when the user
descends into that boundary, not at the outer level.

## Edge label styling notes

`@xyflow/svelte` 1.x renders edge labels as HTML `<div>` portaled to the
`edge-labels` container, not SVG `<text>+<rect>`. That means SVG-era props
like `labelBgStyle` / `labelBgPadding` / `labelBgBorderRadius` are silently
dropped, and `labelStyle: "fill: ..."` does nothing on HTML. Styling goes
through CSS variables (`--xy-edge-label-{color,background-color}-default`)
plus a direct rule on `.svelte-flow__edge-label`.

## Hover dependency tracing

On a 50-element / 100-relation model the canvas gets dense. Hover dims
non-incident edges to opacity 0.2 and lights incident edges in
`accent.selection` with an animation; the markerEnd colour is rewritten
explicitly because SVG markers don't inherit `stroke` from the
referencing path.

## What's out of scope

- **Editing the model on canvas.** aact stays a read-only viewer; the
  source DSL/PUML/JSON is the authority. Watcher + re-parse pipeline
  exists so the architect's IDE remains the editor.
- **ArchiMate / Deployment view / UML / BPMN.** C4 only, per aact-core
  scope discipline.
- **Light theme.** Today's design is dark-only; a `prefers-color-scheme`
  variant is plausible but not committed.
- **Per-user layout persistence.** Position changes are not saved —
  every re-parse re-runs ELK so the layout is deterministic from the
  model alone.

## Open follow-ups

These are flagged in the proposal branch but not built yet:

- **Search / filter** — filter visible nodes by name pattern.
- **Focus mode** — pick a node, dim all nodes that aren't 1-hop
  neighbours, so a "what calls X / what does X call" view falls out.
- **Export to SVG / PNG** — Svelte Flow has utilities for this.
- **Workspace tag filters** — toggle visibility of `External`, `acl`,
  `repo`-tagged groups.

## Related

- `ADRs/Architecture workbench (aact view).md` — initial decision +
  stack survey.
- `aact-architect` skill — agent-facing surface; this design doc covers
  the human-facing surface.
