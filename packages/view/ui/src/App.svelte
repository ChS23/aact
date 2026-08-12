<script lang="ts">
  import { setContext } from "svelte";

  import {
    SvelteFlow,
    SvelteFlowProvider,
    Background,
    Controls,
    MiniMap,
    MarkerType,
    type Node,
    type Edge,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  import BoundaryNode from "./BoundaryNode.svelte";
  import DatabaseNode from "./DatabaseNode.svelte";
  import ElementNode from "./ElementNode.svelte";
  import PersonNode from "./PersonNode.svelte";
  import QueueNode from "./QueueNode.svelte";
  import {
    layoutFlat,
    layoutNested,
    layoutScope,
    sliceModel,
  } from "./layout.ts";
  import type {
    BreadcrumbEntry,
    ChangeAction,
    DiffChange,
    DiffChangeGroup,
    Element,
    Boundary,
    ModelIssue,
    ModelEnvelope,
    Relation,
    ServerMessage,
    ViewError,
  } from "./types.ts";
  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  type ViewMode = "drill" | "expand" | "flat";
  type EdgeStyle = "bezier" | "smoothstep" | "step";
  type EdgeFilter = "all" | "cross-boundary";
  interface IncomingRelation {
    readonly from: string;
    readonly relation: Relation;
  }

  // Persist edge-style + edge-filter + analyze-overlay choices across
  // page reloads — all three are personal preferences with no model
  // coupling, so we bring them back next session instead of resetting.
  const EDGE_STYLE_KEY = "aact-view:edge-style";
  const EDGE_FILTER_KEY = "aact-view:edge-filter";
  const ANALYZE_KEY = "aact-view:analyze";
  const initialEdgeStyle =
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem(EDGE_STYLE_KEY) as EdgeStyle | null)) ||
    "bezier";
  const initialEdgeFilter =
    (typeof localStorage !== "undefined" &&
      (localStorage.getItem(EDGE_FILTER_KEY) as EdgeFilter | null)) ||
    "all";
  const initialAnalyzeOn =
    typeof localStorage !== "undefined" &&
    localStorage.getItem(ANALYZE_KEY) === "on";

  let envelope = $state<ModelEnvelope | null>(null);
  let mode = $state<ViewMode>("drill");
  let edgeStyle = $state<EdgeStyle>(initialEdgeStyle);
  let edgeFilter = $state<EdgeFilter>(initialEdgeFilter);
  let analyzeOn = $state<boolean>(initialAnalyzeOn);
  let breadcrumb = $state<BreadcrumbEntry[]>([{ kind: "landscape" }]);
  let expanded = $state<Set<string>>(new Set());
  let selected = $state<
    | { kind: "element"; name: string }
    | { kind: "boundary"; name: string }
    | null
  >(null);
  let hoveredNodeId = $state<string | null>(null);
  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);
  let status = $state<"connecting" | "live" | "lost" | "error">(
    "connecting",
  );
  let loadError = $state<ViewError | null>(null);
  let layoutError = $state<ViewError | null>(null);

  const nodeTypes = {
    element: ElementNode,
    person: PersonNode,
    database: DatabaseNode,
    queue: QueueNode,
    boundary: BoundaryNode,
  } as const;

  const clientError = (error: unknown): ViewError => ({
    message: error instanceof Error ? error.message : String(error),
    source: envelope?.meta.source ?? null,
    configPath: envelope?.meta.configPath ?? null,
    durationMs: 0,
    at: new Date().toISOString(),
  });

  // Re-layout whenever model, mode, breadcrumb, or expanded set
  // changes. Each branch hands a different ELK invocation back the
  // same `{nodes, edges}` shape so the render code stays uniform.
  $effect(() => {
    if (!envelope) return;
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (mode === "drill") {
        const scope = sliceModel(envelope!.data.model, breadcrumb);
        const result = await layoutScope(scope);
        if (cancelled) return;
        nodes = result.nodes;
        edges = result.edges;
      } else if (mode === "expand") {
        const result = await layoutNested(envelope!.data.model, expanded);
        if (cancelled) return;
        nodes = result.nodes;
        edges = result.edges;
      } else {
        const result = await layoutFlat(envelope!.data.model);
        if (cancelled) return;
        nodes = result.nodes;
        edges = result.edges;
      }
      layoutError = null;
      if (!loadError && status === "error") status = "live";
    };
    void run().catch((error: unknown) => {
      if (cancelled) return;
      layoutError = clientError(error);
      status = "error";
    });
    return () => {
      cancelled = true;
    };
  });

  const readSessionToken = (): string | null => {
    if (typeof location === "undefined") return null;
    const url = new URL(location.href);
    const token = url.searchParams.get("token");
    if (token) {
      url.searchParams.delete("token");
      history.replaceState(
        history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    return token;
  };

  const sessionToken = readSessionToken();

  const withSessionToken = (path: string): string =>
    sessionToken ? `${path}?token=${encodeURIComponent(sessionToken)}` : path;

  const fetchModel = async (): Promise<ModelEnvelope> => {
    const res = await fetch(withSessionToken("/api/model"));
    if (!res.ok) throw new Error(`/api/model returned ${res.status}`);
    return (await res.json()) as ModelEnvelope;
  };

  let diffAutoModeApplied = $state(false);
  const acceptEnvelope = (env: ModelEnvelope): void => {
    envelope = env;
    if (!diffAutoModeApplied && env.data.diff) {
      mode = "flat";
      selected = null;
      breadcrumb = [{ kind: "landscape" }];
      diffAutoModeApplied = true;
    }
  };

  const wsUrl = (() => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}${withSessionToken("/api/ws")}`;
  })();

  const connect = (): void => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => {
      if (!loadError && !layoutError) status = "live";
    });
    ws.addEventListener("message", (ev) => {
      try {
        const payload = JSON.parse(ev.data) as ServerMessage;
        if (payload.type === "model-update") {
          acceptEnvelope(payload.envelope);
          loadError = null;
          if (!layoutError) status = "live";
        }
        if (payload.type === "model-error") {
          loadError = payload.error;
          status = "error";
        }
      } catch {
        // ignore malformed payloads — server won't emit any
      }
    });
    ws.addEventListener("close", () => {
      status = "lost";
      setTimeout(connect, 1000);
    });
    ws.addEventListener("error", () => ws.close());
  };

  void fetchModel().then((env) => {
    acceptEnvelope(env);
    loadError = null;
    connect();
  }).catch((error: unknown) => {
    loadError = clientError(error);
    status = "error";
    connect();
  });

  const onnodeclick = ({ node }: { node: Node }): void => {
    if (node.type === "boundary") {
      selected = { kind: "boundary", name: String(node.data.name) };
    } else {
      selected = { kind: "element", name: String(node.data.name) };
    }
  };

  // @xyflow/svelte 1.x exposes pointer events on the SvelteFlow
  // component as callback props. Pointer events fire for both mouse
  // and touch, so they cover the "trace a relation" UX better than
  // the deprecated mouse-only equivalents.
  const onnodepointerenter = ({ node }: { node: Node }): void => {
    hoveredNodeId = node.id;
  };
  const onnodepointerleave = (): void => {
    hoveredNodeId = null;
  };

  const actions: ViewActions = {
    selectElement: (name) => {
      selected = { kind: "element", name };
    },
    selectBoundary: (name) => {
      selected = { kind: "boundary", name };
    },
    enterBoundary: (name, label) => {
      // Drill-down only makes sense in Drill mode; in Expand mode
      // this is mapped to "toggle" by the BoundaryNode itself.
      if (mode !== "drill") return;
      breadcrumb = [...breadcrumb, { kind: "boundary", name, label }];
      selected = null;
    },
    toggleBoundary: (name) => {
      if (mode !== "expand") return;
      const next = new Set(expanded);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      expanded = next;
    },
  };
  setContext(VIEW_ACTIONS, actions);

  const breadcrumbClick = (index: number): void => {
    breadcrumb = breadcrumb.slice(0, index + 1);
    selected = null;
  };

  const setMode = (next: ViewMode): void => {
    mode = next;
    // Mode change resets selection / breadcrumb so users don't
    // chase the wrong context when switching strategies.
    selected = null;
    if (next === "drill") {
      breadcrumb = [{ kind: "landscape" }];
    }
    if (next === "expand") {
      expanded = new Set();
    }
  };

  /**
   * Global keyboard shortcuts — Zed-style, single-letter, no chord.
   *   1 / 2 / 3 — switch view mode (Drill / Expand / Flat)
   *   A         — toggle the Analyze overlay
   *   Esc       — clear selection (closes the element / boundary panel)
   *
   * Shortcuts no-op when the user is typing into a form control or a
   * contenteditable surface so the keys don't fight the page.
   */
  const isEditableTarget = (event: KeyboardEvent): boolean => {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  };
  const onGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isEditableTarget(event)) return;
    switch (event.key) {
      case "1": {
        setMode("drill");
        event.preventDefault();
        return;
      }
      case "2": {
        setMode("expand");
        event.preventDefault();
        return;
      }
      case "3": {
        setMode("flat");
        event.preventDefault();
        return;
      }
      case "a":
      case "A": {
        setAnalyze(!analyzeOn);
        event.preventDefault();
        return;
      }
      case "Escape": {
        if (selected) {
          selected = null;
          event.preventDefault();
        }
        return;
      }
    }
  };

  const collapseAll = (): void => {
    expanded = new Set();
  };
  const expandAll = (): void => {
    if (!envelope) return;
    expanded = new Set(Object.keys(envelope.data.model.boundaries));
  };

  const selectedElement = $derived<Element | null>(
    selected?.kind === "element" && envelope
      ? (envelope.data.model.elements[selected.name] ?? null)
      : null,
  );
  const selectedBoundary = $derived<Boundary | null>(
    selected?.kind === "boundary" && envelope
      ? (envelope.data.model.boundaries[selected.name] ?? null)
      : null,
  );
  const incomingRelations = $derived<readonly IncomingRelation[]>(
    selectedElement && envelope
      ? Object.values(envelope.data.model.elements).flatMap((el) =>
          el.relations
            .filter((rel) => rel.to === selectedElement.name)
            .map((relation) => ({ from: el.name, relation })),
        )
      : [],
  );
  const selectedIssues = $derived<readonly ModelIssue[]>(
    selected && envelope
      ? envelope.data.issues.filter((issue) =>
          selected.kind === "element"
            ? issue.element === selected.name
            : issue.boundary === selected.name,
        )
      : [],
  );

  const setEdgeStyle = (next: EdgeStyle): void => {
    edgeStyle = next;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(EDGE_STYLE_KEY, next);
    }
  };
  const setEdgeFilter = (next: EdgeFilter): void => {
    edgeFilter = next;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(EDGE_FILTER_KEY, next);
    }
  };
  const setAnalyze = (next: boolean): void => {
    analyzeOn = next;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ANALYZE_KEY, next ? "on" : "off");
    }
  };

  /** Set of element names participating in the smallest detected
   *  cycle, used by the cycles-overlay to outline nodes + thicken
   *  edges. Empty when analyze is off, no cycles exist, or the
   *  envelope hasn't loaded yet. */
  const cycleMembers = $derived<Set<string>>(
    analyzeOn && envelope?.data.analysis.cycles.smallest
      ? new Set(envelope.data.analysis.cycles.smallest)
      : new Set(),
  );

  const diffData = $derived(envelope?.data.diff?.data ?? null);
  const diffGroups = $derived<readonly DiffChangeGroup[]>(
    diffData?.groups ?? [],
  );
  const topDiffChanges = $derived<readonly DiffChange[]>(
    (diffData?.changes ?? []).slice(0, 10),
  );

  /** Whether we're in diff mode — set by the server when the
   *  workbench was booted with `aact view --diff <baseline>`. */
  const diffMode = $derived<boolean>(diffData !== null);

  /** Element-name → diff status. Only entries for elements that
   *  changed; unchanged elements are not in the map. Both `added` and
   *  `renamed` keys land here under the *current* name (so the graph
   *  node renders coloured); `removed` keys carry the baseline name
   *  and stay visible in the sidebar list. */
  const elementDiffStatus = $derived.by<Map<string, ChangeAction>>(() => {
    const out = new Map<string, ChangeAction>();
    for (const change of diffData?.changes ?? []) {
      if (change.entity !== "element") continue;
      out.set(change.name, change.action);
    }
    return out;
  });

  /** Boundary-name → diff status. Same pattern as `elementDiffStatus`
   *  but for boundary nodes (Bounded Contexts). */
  const boundaryDiffStatus = $derived.by<Map<string, ChangeAction>>(() => {
    const out = new Map<string, ChangeAction>();
    for (const change of diffData?.changes ?? []) {
      if (change.entity !== "boundary") continue;
      out.set(change.name, change.action);
    }
    return out;
  });

  const relationDiffKey = (from: string, to: string): string => `${from}->${to}`;

  /** Relation address (`from->to`) → diff status. Edges use this to
   *  pick up the status colour without re-walking the diff every
   *  render. Address includes technology only when relations are
   *  multiset-distinguished by it; we drop the tech qualifier here
   *  because the edge model in the graph already collapses by
   *  `(from, to)`. */
  const relationDiffStatus = $derived.by<Map<string, ChangeAction>>(() => {
    const out = new Map<string, ChangeAction>();
    for (const change of diffData?.changes ?? []) {
      if (change.entity !== "relation") continue;
      out.set(relationDiffKey(change.from, change.to), change.action);
    }
    return out;
  });

  /** Colour mapping for diff status overlays. Tied to the bordering
   *  style in `decoratedNodes` / `decoratedEdges` below — keep in
   *  sync with the visual key shown next to the diff banner. */
  // Desaturated diff palette derived from Zed's One Dark token set —
  // each hue is paired with a glyph (see diffGlyph) so the signal
  // survives colour-blindness and dark-mode shifts.
  const DIFF_COLOR: Readonly<Record<ChangeAction, string>> = {
    added: "#a1c181",
    removed: "#d07277",
    modified: "#dec184",
    renamed: "#7dd3fc",
    moved: "#b6a4d7",
  };

  const diffGlyph = (action: ChangeAction): string => {
    switch (action) {
      case "added":
        return "+";
      case "removed":
        return "−";
      case "modified":
        return "~";
      case "renamed":
        return "↦";
      case "moved":
        return "⇄";
    }
  };

  const nodeDiffStatus = (node: Node): ChangeAction | undefined => {
    const name = node.id.slice(2);
    if (node.id.startsWith("e:")) return elementDiffStatus.get(name);
    if (node.id.startsWith("b:")) return boundaryDiffStatus.get(name);
    return undefined;
  };

  const edgeDiffStatus = (edge: Edge): ChangeAction | undefined => {
    if (!edge.source.startsWith("e:") || !edge.target.startsWith("e:")) {
      return undefined;
    }
    return relationDiffStatus.get(
      relationDiffKey(edge.source.slice(2), edge.target.slice(2)),
    );
  };

  const elementNameFromNodeId = (id: string): string | null =>
    id.startsWith("e:") ? id.slice(2) : null;

  const evidenceString = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;

  const groupSubtitle = (group: DiffChangeGroup): string => {
    const ev = group.evidence ?? {};
    const service = evidenceString(ev.service);
    const repository = evidenceString(ev.repository);
    const database = evidenceString(ev.database);
    if (service && repository && database) {
      return `${service} → ${repository} → ${database}`;
    }
    const from = evidenceString(ev.from);
    const to = evidenceString(ev.to);
    const before = evidenceString(ev.before);
    const after = evidenceString(ev.after);
    if (from && to && before && after) {
      return `${from} → ${to}: ${before} → ${after}`;
    }
    return `${group.changeAddresses.length} change${group.changeAddresses.length === 1 ? "" : "s"}`;
  };

  const changeTitle = (change: DiffChange): string => {
    switch (change.entity) {
      case "element":
        return `${change.name}${change.previousName ? ` ← ${change.previousName}` : ""}`;
      case "boundary":
        return `${change.name}${change.previousName ? ` ← ${change.previousName}` : ""}`;
      case "relation":
        return `${change.from} → ${change.to}`;
      case "workspace":
        return "workspace";
    }
  };

  const changeSubtitle = (change: DiffChange): string =>
    change.fields.length
      ? change.fields.map((f) => f.field).join(", ")
      : change.severity;

  // Dim edges that aren't incident to the hovered node so the user
  // can trace a single dependency through a crowded canvas. Strip
  // labels from non-incident edges as well — at 30+ relations the
  // label chips pile up faster than the lines do. Re-write
  // markerEnd color explicitly because SVG markers don't inherit
  // `stroke` from the referencing path. Override `type` so the
  // topbar style toggle applies to every edge without re-running
  // ELK.
  const isCross = (e: Edge): boolean =>
    Boolean((e.data as { crossBoundary?: boolean } | undefined)?.crossBoundary);

  /** Decorate nodes with overlays. Diff-mode status wins over cycle
   *  highlight when both apply (diff is the user's primary signal —
   *  they booted with `--diff`); analyze-mode cycle highlight applies
   *  when the node isn't already diff-coloured. Reactive Flow's node
   *  `style` field accepts CSS as a string. */
  const decoratedNodes = $derived<Node[]>(
    nodes.map((n) => {
      const existingStyle = typeof n.style === "string" ? n.style : "";
      const diffStatus = nodeDiffStatus(n);
      if (diffStatus) {
        const color = DIFF_COLOR[diffStatus];
        return {
          ...n,
          data: {
            ...(n.data as Record<string, unknown> | undefined),
            diffAction: diffStatus,
          },
          style: `${existingStyle} outline: 3px solid ${color}; outline-offset: 5px; border-radius: 8px;`,
        };
      }
      const nodeName = elementNameFromNodeId(n.id);
      if (nodeName && cycleMembers.has(nodeName)) {
        return {
          ...n,
          style: `${existingStyle} box-shadow: 0 0 0 3px #ef4444; border-radius: 8px;`,
        };
      }
      return n;
    }),
  );

  const decoratedEdges = $derived<Edge[]>(
    edges.map((e) => {
      const incident =
        hoveredNodeId !== null &&
        (e.source === hoveredNodeId || e.target === hoveredNodeId);
      const filterActive = edgeFilter === "cross-boundary";
      const cross = isCross(e);
      const intraInFilter = filterActive && !cross;
      const crossInFilter = filterActive && cross;
      const sourceName = elementNameFromNodeId(e.source);
      const targetName = elementNameFromNodeId(e.target);
      const inCycle =
        sourceName !== null &&
        targetName !== null &&
        cycleMembers.has(sourceName) &&
        cycleMembers.has(targetName);
      const diffStatus = edgeDiffStatus(e);

      // Diff status wins when present — the user booted with `--diff`
      // explicitly to spot architecture deltas. Hover/filter still
      // takes over for incident edges so dependency tracing keeps
      // working when the user wants to inspect a specific node.
      if (diffStatus && !incident) {
        const color = DIFF_COLOR[diffStatus];
        return {
          ...e,
          type: edgeStyle,
          animated: diffStatus !== "removed",
          data: {
            ...(e.data as Record<string, unknown> | undefined),
            diffAction: diffStatus,
          },
          style: `stroke: ${color}; stroke-width: 2.8; opacity: 1;`,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 26,
            height: 26,
            color,
          },
        };
      }

      // Cycle edges win over filter/hover decoration — distributed
      // monolith is the top signal the user toggled Analyze to spot.
      if (inCycle && !incident) {
        return {
          ...e,
          type: edgeStyle,
          animated: false,
          style: "stroke: #ef4444; stroke-width: 2.4; opacity: 1;",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 24,
            height: 24,
            color: "#ef4444",
          },
        };
      }

      // Filter overrides default rendering: intra disappears almost
      // entirely, cross gets thicker bright stroke so it visibly
      // "lights up" as the interesting subgraph. Hover still wins
      // for incident edges so dependency tracing keeps working.
      if (intraInFilter && !incident) {
        return {
          ...e,
          type: edgeStyle,
          animated: false,
          label: undefined,
          style: "stroke: #1e293b; stroke-width: 0.8; opacity: 0.12;",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: "#1e293b",
          },
        };
      }
      if (crossInFilter && !hoveredNodeId) {
        return {
          ...e,
          type: edgeStyle,
          animated: false,
          style: "stroke: #38bdf8; stroke-width: 2.2; opacity: 1;",
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 26,
            height: 26,
            color: "#38bdf8",
          },
        };
      }
      if (!hoveredNodeId) {
        return { ...e, type: edgeStyle };
      }
      const color = incident ? "#38bdf8" : "#475569";
      return {
        ...e,
        type: edgeStyle,
        animated: incident,
        label: incident ? e.label : undefined,
        style: incident
          ? "stroke: #38bdf8; stroke-width: 2.4; opacity: 1;"
          : "stroke: #475569; stroke-width: 1.2; opacity: 0.35;",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 24,
          height: 24,
          color,
        },
      };
    }),
  );

  const summary = $derived<{
    elements: number;
    boundaries: number;
    relations: number;
    issues: number;
  } | null>(
    envelope
      ? {
          elements: Object.keys(envelope.data.model.elements).length,
          boundaries: Object.keys(envelope.data.model.boundaries).length,
          relations: Object.values(envelope.data.model.elements).reduce(
            (acc, el) => acc + el.relations.length,
            0,
          ),
          issues: envelope.data.issues.length,
        }
      : null,
  );
  const activeError = $derived<ViewError | null>(loadError ?? layoutError);
  const activeErrorTitle = $derived<string>(
    loadError ? "Reload failed" : "Layout failed",
  );

  // Translate a SourceLocation into a deep link the OS knows. Vendor
  // schemes match aact's CLI link format so the IDE the user already
  // configured for `aact check` handles the click here too.
  const sourceUrl = (
    file: string,
    line: number,
    col: number,
  ): string => {
    const opener =
      (typeof window !== "undefined" &&
        (window as { __AACT_OPENER__?: string }).__AACT_OPENER__) ||
      "vscode";
    const encodedFile = file
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${opener}://file/${encodedFile}:${line}:${col}`;
  };

  const propertyEntries = (
    properties: Readonly<Record<string, string>> | undefined,
  ): readonly (readonly [string, string])[] => Object.entries(properties ?? {});

  const issueMessage = (issue: ModelIssue): string =>
    issue.message ? `${issue.kind}: ${issue.message}` : issue.kind;

  const minimapNodeColor = (node: Node): string => {
    const diffAction = (node.data as { diffAction?: ChangeAction } | undefined)
      ?.diffAction;
    if (diffAction) return DIFF_COLOR[diffAction];
    const kind = String((node.data as { kind?: string } | undefined)?.kind);
    const external = Boolean(
      (node.data as { external?: boolean } | undefined)?.external,
    );
    if (node.type === "person") return "#08427b";
    if (external) return "#475569";
    if (kind === "System") return "#1168bd";
    if (kind === "Container") return "#438dd5";
    if (kind === "Component") return "#85bbf0";
    return "#64748b";
  };
</script>

<svelte:window onkeydown={onGlobalKeyDown} />

<svelte:head>
  <title>aact view</title>
</svelte:head>

<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="logo">aact</span>
      <span class="subcmd">view</span>
      {#if envelope?.data.model.workspace?.name}
        <span class="workspace" title={envelope.data.model.workspace.description ?? ""}>
          {envelope.data.model.workspace.name}
        </span>
      {/if}
      <span class="status">
        <span class="status-dot dot-{status}" aria-hidden="true"></span>
        <span class="status-label">
          {#if status === "live"}live
          {:else if status === "error"}reload failed
          {:else if status === "lost"}reconnecting
          {:else}connecting
          {/if}
        </span>
      </span>
      {#if diffMode && envelope?.data.diff}
        <span class="diff-chip" title={envelope.data.diff.data.summary.headline}>
          diff {envelope.data.diff.data.summary.headline}
        </span>
      {/if}
    </div>

    <div class="topbar-controls">
      <div class="modes" role="tablist" aria-label="View mode">
        <button
          role="tab"
          class:active={mode === "drill"}
          aria-selected={mode === "drill"}
          onclick={() => setMode("drill")}
          title="Replace the canvas with the boundary you double-click"
        >Drill</button>
        <button
          role="tab"
          class:active={mode === "expand"}
          aria-selected={mode === "expand"}
          onclick={() => setMode("expand")}
          title="Open boundaries inline — parents stay visible"
        >Expand</button>
        <button
          role="tab"
          class:active={mode === "flat"}
          aria-selected={mode === "flat"}
          onclick={() => setMode("flat")}
          title="Render every level of the hierarchy at once"
        >Flat</button>
      </div>
      <div class="modes edge-modes" role="tablist" aria-label="Edge style">
        <button
          role="tab"
          class:active={edgeStyle === "bezier"}
          aria-selected={edgeStyle === "bezier"}
          onclick={() => setEdgeStyle("bezier")}
          title="Smooth bezier curves"
        >Curve</button>
        <button
          role="tab"
          class:active={edgeStyle === "smoothstep"}
          aria-selected={edgeStyle === "smoothstep"}
          onclick={() => setEdgeStyle("smoothstep")}
          title="Rounded 90° corners — Structurizr-style"
        >Smooth</button>
        <button
          role="tab"
          class:active={edgeStyle === "step"}
          aria-selected={edgeStyle === "step"}
          onclick={() => setEdgeStyle("step")}
          title="Sharp 90° corners"
        >Step</button>
      </div>
      <div class="modes edge-modes" role="tablist" aria-label="Edge filter">
        <button
          role="tab"
          class:active={edgeFilter === "all"}
          aria-selected={edgeFilter === "all"}
          onclick={() => setEdgeFilter("all")}
          title="Show every relation"
        >All</button>
        <button
          role="tab"
          class:active={edgeFilter === "cross-boundary"}
          aria-selected={edgeFilter === "cross-boundary"}
          onclick={() => setEdgeFilter("cross-boundary")}
          title="Highlight relations that cross a Bounded Context; intra-boundary stays faint"
        >Cross-BC</button>
      </div>
      <div class="modes analyze-toggle" role="tablist" aria-label="Analyze overlay">
        <button
          role="tab"
          class:active={analyzeOn}
          aria-selected={analyzeOn}
          onclick={() => setAnalyze(!analyzeOn)}
          title="Highlight cycles on the graph and show architecture metrics in the sidebar"
        >Analyze</button>
      </div>
    </div>

    <div class="context">
      {#if mode === "drill"}
        <nav class="breadcrumb" aria-label="Drill path">
          {#each breadcrumb as crumb, i (i)}
            {#if i > 0}<span class="bsep" aria-hidden="true">/</span>{/if}
            <button class="bcrumb" onclick={() => breadcrumbClick(i)}>
              {crumb.kind === "landscape" ? "Landscape" : crumb.label}
            </button>
          {/each}
        </nav>
      {:else if mode === "expand"}
        <div class="expand-controls">
          <button class="ghost" onclick={expandAll}>Expand all</button>
          <button class="ghost" onclick={collapseAll}>Collapse all</button>
          <span class="hint">double-click a boundary to toggle</span>
        </div>
      {:else}
        <span class="hint">full hierarchy — read-only overview</span>
      {/if}
    </div>
  </header>

  <main>
    <div class="graph">
      <SvelteFlowProvider>
        <SvelteFlow
          nodes={decoratedNodes}
          edges={decoratedEdges}
          {nodeTypes}
          {onnodeclick}
          {onnodepointerenter}
          {onnodepointerleave}
          fitView
          fitViewOptions={{ padding: 0.18, duration: 400 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnDoubleClick={false}
          minZoom={0.1}
          maxZoom={2}
          defaultEdgeOptions={{ type: edgeStyle, animated: false }}
        >
          <Background />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={minimapNodeColor}
            maskColor="rgba(15, 23, 42, 0.7)"
            style="background: #0b1220;"
          />
        </SvelteFlow>
      </SvelteFlowProvider>

      <div class="kbd-floater" aria-label="Keyboard shortcuts">
        <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><span class="kbd-label">modes</span>
        <kbd>A</kbd><span class="kbd-label">analyze</span>
        <kbd>Esc</kbd><span class="kbd-label">clear</span>
      </div>

      <aside class="legend" aria-label="C4 element palette">
        <span class="legend-row"><span class="swatch" style="background: #08427b;"></span>Person</span>
        <span class="legend-row"><span class="swatch" style="background: #1168bd;"></span>System</span>
        <span class="legend-row"><span class="swatch" style="background: #438dd5;"></span>Container</span>
        <span class="legend-row"><span class="swatch" style="background: #85bbf0;"></span>Component</span>
        <span class="legend-row"><span class="swatch" style="background: #475569;"></span>External</span>
        {#if diffMode}
          <span class="legend-rule"></span>
          <span class="legend-row"><span class="swatch" style="background: #a1c181;"></span>Added</span>
          <span class="legend-row"><span class="swatch" style="background: #dec184;"></span>Modified</span>
          <span class="legend-row"><span class="swatch" style="background: #d07277;"></span>Removed</span>
          <span class="legend-row"><span class="swatch" style="background: #7dd3fc;"></span>Renamed</span>
          <span class="legend-row"><span class="swatch" style="background: #b6a4d7;"></span>Moved</span>
        {/if}
      </aside>

      {#if activeError}
        <aside class="error-overlay" role="status" aria-live="polite">
          <span class="error-kicker">{activeErrorTitle}</span>
          <p>{activeError.message}</p>
          <div class="error-meta">
            {#if activeError.source}<span>{activeError.source}</span>{/if}
            <span>{new Date(activeError.at).toLocaleTimeString()}</span>
            {#if activeError.durationMs > 0}<span>{activeError.durationMs} ms</span>{/if}
          </div>
        </aside>
      {/if}
    </div>

    <aside class="details">
      {#if selectedElement}
        <h2>{selectedElement.kind}{selectedElement.external ? " · external" : ""}</h2>
        <h3 class="title">{selectedElement.label}</h3>
        {#if selectedElement.technology}
          <p class="tech">[{selectedElement.technology}]</p>
        {/if}
        {#if selectedElement.description}
          <p class="desc">{selectedElement.description}</p>
        {/if}
        {#if selectedElement.tags.length}
          <div class="field">
            <span class="k">tags</span>
            <span class="v">
              {#each selectedElement.tags as t (t)}
                <span class="tag">{t}</span>
              {/each}
            </span>
          </div>
        {/if}
        {#if propertyEntries(selectedElement.properties).length}
          <div class="field">
            <span class="k">props</span>
            <span class="v props">
              {#each propertyEntries(selectedElement.properties) as [key, value] (key)}
                <span class="prop"><span class="prop-key">{key}</span>{value}</span>
              {/each}
            </span>
          </div>
        {/if}
        {#if selectedElement.sourceLocation}
          <div class="field">
            <span class="k">source</span>
            <span class="v">
              <a href={sourceUrl(selectedElement.sourceLocation.file, selectedElement.sourceLocation.start.line, selectedElement.sourceLocation.start.col)}>
                {selectedElement.sourceLocation.file.split("/").pop()}:{selectedElement.sourceLocation.start.line}:{selectedElement.sourceLocation.start.col}
              </a>
            </span>
          </div>
        {/if}
        {#if selectedIssues.length}
          <h4>Issues</h4>
          <ul class="issues">
            {#each selectedIssues as issue, i (i)}
              <li>{issueMessage(issue)}</li>
            {/each}
          </ul>
        {/if}
        {#if selectedElement.relations.length}
          <h4>Outgoing relations</h4>
          <ul class="relations">
            {#each selectedElement.relations as rel, i (i)}
              <li>
                <span class="arrow">→</span>
                <span class="to">{rel.to}</span>
                {#if rel.description}<span class="rdesc">{rel.description}</span>{/if}
                {#if rel.technology}<span class="rmeta">[{rel.technology}]</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if incomingRelations.length}
          <h4>Incoming relations</h4>
          <ul class="relations">
            {#each incomingRelations as item, i (i)}
              <li>
                <span class="arrow">←</span>
                <span class="to">{item.from}</span>
                {#if item.relation.description}<span class="rdesc">{item.relation.description}</span>{/if}
                {#if item.relation.technology}<span class="rmeta">[{item.relation.technology}]</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {:else if selectedBoundary}
        <h2>{selectedBoundary.kind} boundary</h2>
        <h3 class="title">{selectedBoundary.label}</h3>
        {#if selectedBoundary.description}
          <p class="desc">{selectedBoundary.description}</p>
        {/if}
        <div class="field">
          <span class="k">children</span>
          <span class="v">{selectedBoundary.elementNames.length} elements · {selectedBoundary.boundaryNames.length} boundaries</span>
        </div>
        {#if selectedBoundary.tags.length}
          <div class="field">
            <span class="k">tags</span>
            <span class="v">
              {#each selectedBoundary.tags as t (t)}
                <span class="tag">{t}</span>
              {/each}
            </span>
          </div>
        {/if}
        {#if propertyEntries(selectedBoundary.properties).length}
          <div class="field">
            <span class="k">props</span>
            <span class="v props">
              {#each propertyEntries(selectedBoundary.properties) as [key, value] (key)}
                <span class="prop"><span class="prop-key">{key}</span>{value}</span>
              {/each}
            </span>
          </div>
        {/if}
        {#if selectedBoundary.sourceLocation}
          <div class="field">
            <span class="k">source</span>
            <span class="v">
              <a href={sourceUrl(selectedBoundary.sourceLocation.file, selectedBoundary.sourceLocation.start.line, selectedBoundary.sourceLocation.start.col)}>
                {selectedBoundary.sourceLocation.file.split("/").pop()}:{selectedBoundary.sourceLocation.start.line}:{selectedBoundary.sourceLocation.start.col}
              </a>
            </span>
          </div>
        {/if}
        {#if selectedIssues.length}
          <h4>Issues</h4>
          <ul class="issues">
            {#each selectedIssues as issue, i (i)}
              <li>{issueMessage(issue)}</li>
            {/each}
          </ul>
        {/if}
        <p class="hint">
          {#if mode === "drill"}Double-click to enter this boundary.
          {:else if mode === "expand"}Double-click to {expanded.has(selectedBoundary.name) ? "collapse" : "expand"} this boundary.
          {:else}This boundary is part of the full hierarchy.
          {/if}
        </p>
      {:else if diffData}
        <h4>Diff</h4>
        <p class="diff-headline">{diffData.summary.headline}</p>
        <dl class="info-line">
          <div><dt>structural</dt><dd>{diffData.summary.bySeverity.structural}</dd></div>
          <div><dt>semantic</dt><dd>{diffData.summary.bySeverity.semantic}</dd></div>
          <div><dt>cosmetic</dt><dd>{diffData.summary.bySeverity.cosmetic}</dd></div>
          <div><dt>total</dt><dd>{diffData.changes.length}</dd></div>
        </dl>
        {#if diffGroups.length}
          <h4>Groups</h4>
          <ul class="change-list">
            {#each diffGroups as group (group.id)}
              <li class="change-row" style="border-left-color: #38bdf8;">
                <span class="change-title">{group.title}</span>
                <span class="change-subtitle">{groupSubtitle(group)} · {Math.round(group.confidence * 100)}% confidence</span>
              </li>
            {/each}
          </ul>
        {/if}
        {#if topDiffChanges.length}
          <h4>Changes</h4>
          <ul class="change-list">
            {#each topDiffChanges as change (change.address)}
              <li class="change-row" style={`border-left-color: ${DIFF_COLOR[change.action]};`}>
                <span class="change-title"><span class="change-glyph" style={`color: ${DIFF_COLOR[change.action]};`}>{diffGlyph(change.action)}</span> {changeTitle(change)}</span>
                <span class="change-subtitle">{change.entity} · {changeSubtitle(change)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if analyzeOn && envelope}
        {@const a = envelope.data.analysis}
        <h4>Metrics</h4>
        <dl class="info-line">
          <div><dt>elements</dt><dd>{a.elementsCount}</dd></div>
          <div><dt>databases</dt><dd>{a.databases.count}</dd></div>
          <div><dt>relations</dt><dd>{a.relationsByStyle.sync + a.relationsByStyle.async + a.relationsByStyle.unspecified}</dd></div>
          {#if a.cycles.count > 0}
            <div class="warn"><dt>cycles</dt><dd>{a.cycles.count}</dd></div>
          {/if}
        </dl>
        {#if Object.keys(a.elementsByKind).length}
          <h4>By kind</h4>
          <ul class="metrics">
            {#each Object.entries(a.elementsByKind).sort((x, y) => x[0].localeCompare(y[0])) as [kind, count] (kind)}
              <li><span class="k">{kind}</span><span class="v">{count}</span></li>
            {/each}
          </ul>
        {/if}
        <h4>Relations by style</h4>
        <ul class="metrics">
          <li><span class="k">sync</span><span class="v">{a.relationsByStyle.sync}</span></li>
          <li><span class="k">async</span><span class="v">{a.relationsByStyle.async}</span></li>
          <li><span class="k">unspecified</span><span class="v">{a.relationsByStyle.unspecified}</span></li>
        </ul>
        {#if a.cycles.count > 0 && a.cycles.smallest}
          <h4 class="warn-h">Cycles</h4>
          <p class="cycle-list">
            <span class="cycle-trail">{a.cycles.smallest.join(" → ")}</span>
          </p>
        {/if}
        {#if a.fanOut.length}
          <h4>Top fan-out</h4>
          <ul class="metrics">
            {#each a.fanOut as it (it.name)}
              <li><span class="k">{it.name}</span><span class="v">{it.count}</span></li>
            {/each}
          </ul>
        {/if}
        {#if a.fanIn.length}
          <h4>Top fan-in</h4>
          <ul class="metrics">
            {#each a.fanIn as it (it.name)}
              <li><span class="k">{it.name}</span><span class="v">{it.count}</span></li>
            {/each}
          </ul>
        {/if}
      {:else if envelope?.data.model.workspace}
        <h4>Workspace</h4>
        <h3 class="title">{envelope.data.model.workspace.name ?? "(unnamed)"}</h3>
        {#if envelope.data.model.workspace.description}
          <p class="desc">{envelope.data.model.workspace.description}</p>
        {/if}
        {#if summary}
          <dl class="info-line">
            <div><dt>elements</dt><dd>{summary.elements}</dd></div>
            <div><dt>boundaries</dt><dd>{summary.boundaries}</dd></div>
            <div><dt>relations</dt><dd>{summary.relations}</dd></div>
            {#if summary.issues > 0}
              <div class="warn"><dt>issues</dt><dd>{summary.issues}</dd></div>
            {/if}
          </dl>
        {/if}
        {#if envelope.data.issues.length}
          <h4>Loader issues</h4>
          <ul class="issues">
            {#each envelope.data.issues as issue, i (i)}
              <li>{issueMessage(issue)}</li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="hint">Loading model…</p>
      {/if}
    </aside>
  </main>
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #0b1220;
    color: #e2e8f0;
    font-family:
      -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  }
  :global(body) {
    overflow: hidden;
  }
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100vh;
  }
  .topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 16px;
    padding: 8px 14px;
    background: #0d1424;
    border-bottom: 1px solid rgba(148, 163, 184, 0.10);
  }
  /* Zed-style title bar left cluster: no middot separators, slot
     siblings sit on a small gap. Project name reads as the main
     identity (regular weight, default text); subcommand and status
     are muted breadcrumb-like. Status indicator is a 6×6 rounded dot
     followed by a muted label — matches Zed's `Indicator::dot()` +
     `LabelSize::Small Color::Muted` pattern. */
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .logo {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: -0.005em;
    color: #f8fafc;
  }
  .subcmd {
    font-size: 12px;
    color: #64748b;
    font-weight: 400;
  }
  .workspace {
    font-size: 12px;
    color: #e2e8f0;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 340px;
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .status-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .dot-live {
    background: #34d399;
  }
  .dot-lost {
    background: #f87171;
  }
  .dot-error {
    background: #fbbf24;
  }
  .dot-connecting {
    background: #64748b;
  }
  .status-label {
    font-size: 12px;
    color: #94a3b8;
    font-weight: 400;
  }
  .diff-chip {
    display: inline-block;
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 400;
    color: #fbbf24;
  }
  .topbar-controls {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .modes {
    display: inline-flex;
    background: transparent;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 5px;
    padding: 0;
    overflow: hidden;
  }
  .modes button + button {
    border-left: 1px solid rgba(148, 163, 184, 0.10);
  }
  .edge-modes button {
    padding: 5px 10px;
    font-size: 11px;
  }
  .modes button {
    appearance: none;
    border: 0;
    background: transparent;
    color: #94a3b8;
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 500;
    border-radius: 0;
    cursor: pointer;
    letter-spacing: 0.01em;
    transition: background 80ms ease, color 80ms ease;
  }
  .modes button:hover {
    background: rgba(255, 255, 255, 0.03);
    color: #e2e8f0;
  }
  .modes button.active {
    background: rgba(56, 189, 248, 0.12);
    color: #7dd3fc;
  }
  .context {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    min-width: 0;
  }
  /* Single-line keyboard cheat-sheet — pinned to the bottom-left,
     directly right of the Legend so the two help surfaces read as
     one row. Chip-only, no panel chrome. */
  .kbd-floater {
    position: absolute;
    bottom: 14px;
    left: 130px;
    display: flex;
    align-items: center;
    gap: 5px;
    z-index: 4;
    pointer-events: none;
  }
  .kbd-floater kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    padding: 2px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
    line-height: 1.2;
    color: #cbd5e1;
    background: rgba(148, 163, 184, 0.08);
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 3px;
  }
  .kbd-floater .kbd-label {
    font-size: 11px;
    color: #64748b;
    letter-spacing: 0.01em;
    margin: 0 8px 0 2px;
  }
  .kbd-floater .kbd-label:last-child {
    margin-right: 0;
  }
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .bcrumb {
    appearance: none;
    border: 0;
    background: transparent;
    color: #7dd3fc;
    cursor: pointer;
    font-size: 11.5px;
    padding: 2px 5px;
    border-radius: 3px;
    letter-spacing: 0.01em;
  }
  .bcrumb:hover {
    background: rgba(56, 189, 248, 0.08);
  }
  .bsep {
    color: #334155;
  }
  .expand-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ghost {
    appearance: none;
    border: 1px solid rgba(148, 163, 184, 0.14);
    background: transparent;
    color: #cbd5e1;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    letter-spacing: 0.01em;
    transition: background 80ms ease, color 80ms ease;
  }
  .ghost:hover {
    background: rgba(255, 255, 255, 0.04);
    color: #f8fafc;
  }
  .hint {
    color: #64748b;
    font-size: 10.5px;
    letter-spacing: 0.01em;
  }

  main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    background: #0b1220;
    overflow: hidden;
  }
  .graph {
    background: #0b1220;
    overflow: hidden;
    position: relative;
  }
  .details {
    overflow: auto;
  }

  .legend {
    position: absolute;
    bottom: 14px;
    left: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    background: #0d1424;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 4px;
    font-size: 11px;
    color: #cbd5e1;
    z-index: 4;
    letter-spacing: 0.01em;
  }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .legend-rule {
    display: block;
    height: 1px;
    margin: 4px 0;
    background: rgba(148, 163, 184, 0.10);
  }
  .error-overlay {
    position: absolute;
    top: 18px;
    left: 18px;
    z-index: 5;
    max-width: min(520px, calc(100% - 36px));
    padding: 14px 16px;
    border-radius: 8px;
    border: 1px solid #b45309;
    background: rgba(69, 26, 3, 0.92);
    box-shadow: 0 18px 50px -28px rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(6px);
  }
  .error-kicker {
    display: block;
    margin-bottom: 6px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #fbbf24;
  }
  .error-overlay p {
    margin: 0;
    color: #fff7ed;
    font-size: 13px;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .error-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
    font-size: 10px;
    color: #fed7aa;
  }

  .details {
    padding: 16px 18px 20px;
    overflow: auto;
    background: #0d1424;
    border-left: 1px solid rgba(148, 163, 184, 0.10);
  }
  .details h2 {
    margin: 0 0 6px;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #64748b;
  }
  .details h3 {
    margin: 2px 0 12px;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.25;
    color: #f8fafc;
    letter-spacing: -0.005em;
  }
  .details h4 {
    margin: 16px 0 6px;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: #64748b;
  }
  .tech {
    margin: 0 0 10px;
    font-size: 12px;
    font-style: italic;
    color: #94a3b8;
  }
  .desc {
    margin: 0 0 14px;
    font-size: 13px;
    line-height: 1.45;
    color: #cbd5e1;
  }
  .field {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 12px;
    color: #cbd5e1;
  }
  .field .k {
    color: #64748b;
    min-width: 70px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 10px;
    padding-top: 2px;
  }
  .field a {
    color: #38bdf8;
    text-decoration: none;
  }
  .field a:hover {
    text-decoration: underline;
  }
  .tag {
    display: inline-block;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(148, 163, 184, 0.10);
    color: #cbd5e1;
    margin-right: 4px;
    letter-spacing: 0.01em;
  }
  .props {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .prop {
    display: inline-flex;
    gap: 5px;
    max-width: 100%;
    padding: 2px 6px;
    border-radius: 3px;
    background: transparent;
    color: #cbd5e1;
    border: 1px solid rgba(148, 163, 184, 0.14);
    font-size: 10px;
    overflow-wrap: anywhere;
  }
  .prop-key {
    color: #7dd3fc;
    font-weight: 600;
  }
  .relations {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 12px;
  }
  .relations li {
    display: flex;
    gap: 6px;
    align-items: baseline;
    padding: 4px 0;
    color: #cbd5e1;
  }
  .arrow {
    color: #38bdf8;
  }
  .to {
    font-weight: 700;
    color: #e2e8f0;
  }
  .rdesc {
    color: #94a3b8;
  }
  .rmeta {
    font-size: 10px;
    color: #64748b;
    font-style: italic;
  }
  .issues {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 12px;
  }
  .issues li {
    margin: 6px 0;
    padding: 7px 9px;
    border-radius: 4px;
    border-left: 2px solid #dec184;
    background: rgba(222, 193, 132, 0.06);
    color: #e2c896;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .change-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .change-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    align-items: start;
    padding: 6px 0 6px 10px;
    border-left: 2px solid var(--diff-tint, rgba(148, 163, 184, 0.40));
    background: transparent;
  }
  .change-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }
  .change-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e2e8f0;
    font-size: 12px;
    font-weight: 500;
  }
  .change-glyph {
    display: inline-block;
    width: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-weight: 700;
    font-size: 11px;
    text-align: center;
  }
  .change-subtitle {
    overflow-wrap: anywhere;
    color: #64748b;
    font-size: 11px;
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
  }
  .info-line {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 18px;
    margin: 8px 0 4px;
    padding: 0;
    font-size: 11px;
    color: #64748b;
    font-variant-numeric: tabular-nums;
  }
  .info-line > div {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .info-line dt {
    color: #64748b;
    letter-spacing: 0.01em;
  }
  .info-line dd {
    margin: 0;
    color: #e2e8f0;
    font-weight: 500;
    font-size: 13px;
  }
  .info-line .warn dd {
    color: #dec184;
  }
  .info-line .warn dt {
    color: #dec184;
  }
  :global(.svelte-flow) {
    background: #0b1220;
    /* xyflow exposes edge styling via CSS variables. Setting them
       here overrides the defaults baked into
       @xyflow/svelte/dist/style.css regardless of which template
       (default / smoothstep / straight) renders the edge.
       Edge labels are HTML <div>s, not SVG <text>, so they need
       HTML CSS background / color — labelBgStyle prop is ignored
       in @xyflow/svelte 1.x. */
    --xy-edge-stroke-default: #94a3b8;
    --xy-edge-stroke-selected-default: #38bdf8;
    --xy-edge-stroke-width-default: 1.8;
    --xy-connectionline-stroke-default: #38bdf8;
    --xy-edge-label-color-default: #f8fafc;
    --xy-edge-label-background-color-default: #1e293b;
  }
  :global(.svelte-flow__edge-label) {
    background: #1e293b;
    color: #f8fafc;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid #475569;
    font-size: 11px;
    font-weight: 700;
    box-shadow: 0 4px 12px -8px rgba(0, 0, 0, 0.6);
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.svelte-flow__background) {
    background-color: #0b1220;
  }
  :global(.svelte-flow__edge-path) {
    stroke: #94a3b8;
    stroke-width: 1.8;
  }
  :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: #38bdf8;
    stroke-width: 2.4;
  }
  :global(.svelte-flow__edge-text) {
    fill: #f8fafc;
    font-size: 11px;
    font-weight: 700;
  }
  :global(.svelte-flow__edge-textbg) {
    fill: #1e293b;
    stroke: #475569;
    stroke-width: 1;
  }
  :global(.svelte-flow__arrowhead polyline),
  :global(.svelte-flow__arrowhead path) {
    fill: #cbd5e1;
    stroke: #cbd5e1;
  }
  /* Hide connection handles. xyflow still needs the <Handle>
     components to compute edge endpoints, but the default `o` dot
     visually competes with the arrowhead at the node border. We
     keep size > 0 so the layout math is intact, just invisible. */
  :global(.svelte-flow__handle) {
    width: 6px;
    height: 6px;
    background: transparent;
    border: 0;
    min-width: 0;
    min-height: 0;
    opacity: 0;
    pointer-events: none;
  }
  /* Move xyflow's Controls to top-left of the canvas — bottom-left
     is owned by the Legend, and stacking the two created a "controls
     are hidden" trap. Top-left keeps zoom/fit/lock buttons one Cmd-tab
     away from the diagram. */
  :global(.svelte-flow__controls) {
    bottom: auto !important;
    left: 14px !important;
    top: 14px !important;
    background: #0d1424;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 4px;
    overflow: hidden;
  }
  :global(.svelte-flow__controls-button) {
    background: #0d1424;
    border-bottom: 1px solid rgba(148, 163, 184, 0.10);
    color: #cbd5e1;
  }
  :global(.svelte-flow__controls-button:hover) {
    background: rgba(255, 255, 255, 0.04);
  }
  :global(.svelte-flow__minimap) {
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 4px;
    overflow: hidden;
  }

  /* Analyze overlay — toggle button + sidebar metrics list. */
  .analyze-toggle button.active {
    /* Red tint ties the toggle to the cycle-highlight color on the
       graph — distinct from mode/edge accents which use sky blue. */
    background: rgba(239, 68, 68, 0.14);
    color: #fca5a5;
  }
  .metrics {
    list-style: none;
    padding: 0;
    margin: 0 0 10px 0;
    font-size: 12px;
  }
  .metrics li {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.06);
  }
  .metrics li:last-child {
    border-bottom: none;
  }
  .metrics .k {
    color: #94a3b8;
  }
  .metrics .v {
    color: #e2e8f0;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }
  .warn-h {
    color: #dec184;
  }
  .cycle-list {
    font-size: 12px;
    color: #94a3b8;
    margin: 4px 0 12px 0;
  }
  .cycle-trail {
    display: block;
    margin-top: 4px;
    padding: 6px 8px;
    background: rgba(222, 193, 132, 0.06);
    border-left: 2px solid #dec184;
    color: #e2c896;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    word-break: break-all;
  }
</style>
