<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface ElementNodeData {
    name: string;
    label: string;
    kind: string;
    description: string;
    external: boolean;
    technology: string;
  }

  let { data, selected }: NodeProps<{ data: ElementNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);

  // Simon Brown / c4model.com canonical palette: deeper blue for
  // higher-level abstractions, fading to lighter shades as we drill
  // down. Externals collapse to neutral slate so they read as
  // "someone else's box."
  const palette = (kind: string, external: boolean): string => {
    if (external) return "#475569";
    if (kind === "System") return "#1168bd";
    if (kind === "Container") return "#438dd5";
    if (kind === "Component") return "#85bbf0";
    return "#1168bd";
  };
  const fill = $derived(palette(data.kind, data.external));
  const textColor = $derived(
    data.kind === "Component" && !data.external ? "#0f172a" : "#f8fafc",
  );
</script>

<div
  class="el"
  class:external={data.external}
  class:is-selected={selected}
  style:--fill={fill}
  style:--text={textColor}
  role="button"
  tabindex="0"
  onclick={() => actions?.selectElement(data.name)}
  onkeydown={(event) => {
    if (event.key === "Enter") actions?.selectElement(data.name);
  }}
>
  <Handle type="target" position={Position.Left} />
  <div class="head">
    <span class="kind">{data.kind}{data.external ? " · external" : ""}</span>
  </div>
  <span class="label">{data.label}</span>
  {#if data.technology}
    <span class="tech">[{data.technology}]</span>
  {/if}
  {#if data.description}
    <span class="desc">{data.description}</span>
  {/if}
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .el {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 12px 12px;
    border-radius: 6px;
    background: var(--fill);
    color: var(--text, #f8fafc);
    border: 1px solid color-mix(in srgb, var(--fill) 60%, black);
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    cursor: pointer;
    transition: filter 100ms ease, border-color 100ms ease;
  }
  .el:hover {
    filter: brightness(1.08);
  }
  .el.is-selected {
    border-color: #7dd3fc;
    box-shadow: 0 0 0 1px #7dd3fc inset;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .kind {
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--text) 65%, transparent);
    font-weight: 500;
  }
  .label {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.005em;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .tech {
    font-size: 10px;
    color: color-mix(in srgb, var(--text) 75%, transparent);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .desc {
    font-size: 11px;
    line-height: 1.35;
    color: color-mix(in srgb, var(--text) 70%, transparent);
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
