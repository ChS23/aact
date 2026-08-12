<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface BoundaryNodeData {
    name: string;
    label: string;
    kind: string;
    childCount: number;
    expanded: boolean;
    canExpand: boolean;
  }

  let { data, selected }: NodeProps<{ data: BoundaryNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);

  // Boundary borders follow the same C4 progression as the elements
  // they wrap, just dashed and translucent so they read as containers
  // not as solid shapes.
  const palette: Record<string, string> = {
    Enterprise: "#0b3b6c",
    System: "#1168bd",
    Container: "#438dd5",
    Component: "#85bbf0",
  };
  const accent = $derived(palette[data.kind] ?? "#94a3b8");

  const onClick = (event: MouseEvent): void => {
    // Boundary headers absorb clicks; ignore clicks that bubble up
    // from interactive children (controls, child nodes) so we don't
    // double-fire selection.
    if (event.target !== event.currentTarget) {
      const isHeader = (event.target as HTMLElement).closest(".header");
      if (!isHeader) return;
    }
    actions?.selectBoundary(data.name);
  };

  const onDblClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (data.canExpand) {
      actions?.toggleBoundary(data.name, data.label);
    } else {
      actions?.enterBoundary(data.name, data.label);
    }
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Enter") {
      actions?.selectBoundary(data.name);
      return;
    }
    if (event.key !== " ") return;
    event.preventDefault();
    if (data.canExpand) {
      actions?.toggleBoundary(data.name, data.label);
    } else {
      actions?.enterBoundary(data.name, data.label);
    }
  };
</script>

<div
  class="boundary"
  class:expanded={data.expanded}
  class:is-selected={selected}
  style:--accent={accent}
  role="button"
  tabindex="0"
  aria-label={`${data.kind} boundary: ${data.label}`}
  onclick={onClick}
  ondblclick={onDblClick}
  onkeydown={onKeydown}
>
  <Handle type="target" position={Position.Left} />
  <header class="header">
    <span class="kind">{data.kind} boundary</span>
    <span class="label">{data.label}</span>
    {#if !data.expanded}
      <span class="meta">
        {data.childCount} · double-click to {data.canExpand ? "expand" : "enter"}
      </span>
    {/if}
  </header>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .boundary {
    display: flex;
    flex-direction: column;
    border-radius: 16px;
    border: 2px dashed var(--accent, #94a3b8);
    background: color-mix(in srgb, var(--accent, #94a3b8) 8%, transparent);
    color: #e2e8f0;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    cursor: pointer;
    transition:
      background 120ms ease,
      box-shadow 120ms ease;
    backdrop-filter: blur(2px);
  }
  .boundary:hover {
    background: color-mix(in srgb, var(--accent, #94a3b8) 14%, transparent);
  }
  .boundary.expanded {
    cursor: default;
  }
  .boundary.is-selected {
    box-shadow:
      0 0 0 1px var(--accent),
      0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .header {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px 10px;
    border-bottom: 1px dashed
      color-mix(in srgb, var(--accent) 40%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    border-radius: 14px 14px 0 0;
  }
  .kind {
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--accent) 65%, #cbd5e1);
    font-weight: 500;
  }
  .label {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    color: #f8fafc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }
  .meta {
    font-size: 10px;
    color: rgba(226, 232, 240, 0.45);
    letter-spacing: 0.01em;
  }
</style>
