<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface QueueNodeData {
    name: string;
    label: string;
    kind: string;
    description: string;
    external: boolean;
    technology: string;
  }

  let { data, selected }: NodeProps<{ data: QueueNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);

  const fill = $derived(data.external ? "#475569" : "#1168bd");

  // Split the camelCase kind (ContainerQueue / SystemQueue / ComponentQueue)
  // into "<Tier> Queue" so the uppercase chip reads as two words.
  const kindLabel = $derived(data.kind.replace(/Queue$/, " Queue"));
</script>

<div
  class="q"
  class:external={data.external}
  class:is-selected={selected}
  style:--fill={fill}
  role="button"
  tabindex="0"
  onclick={() => actions?.selectElement(data.name)}
  onkeydown={(event) => {
    if (event.key === "Enter") actions?.selectElement(data.name);
  }}
>
  <Handle type="target" position={Position.Left} />
  <!-- Canonical C4 queue: horizontal cylinder (pipe). Small (8%)
       left/right rim ellipses so the pipe hint is unmistakable but
       most of the node is body for the text content. -->
  <svg
    class="shape"
    width="100%"
    height="100%"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    <path
      class="body"
      d="M 6 0 C 2 0 0 22 0 50 C 0 78 2 100 6 100 L 94 100 C 98 100 100 78 100 50 C 100 22 98 0 94 0 Z"
    />
    <path
      class="rim"
      d="M 6 0 C 10 0 12 22 12 50 C 12 78 10 100 6 100"
      fill="none"
    />
  </svg>
  <div class="content">
    <span class="kind">{kindLabel}</span>
    <span class="label">{data.label}</span>
    {#if data.technology}
      <span class="tech">[{data.technology}]</span>
    {/if}
    {#if data.description}
      <span class="desc">{data.description}</span>
    {/if}
  </div>
  <Handle type="source" position={Position.Right} />
</div>

<style>
  .q {
    position: relative;
    width: 100%;
    height: 100%;
    color: #f8fafc;
    cursor: pointer;
    box-sizing: border-box;
    transition: filter 100ms ease;
  }
  .q:hover {
    filter: brightness(1.08);
  }
  .shape {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .shape .body {
    fill: var(--fill);
    stroke: color-mix(in srgb, var(--fill) 55%, black);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .shape .rim {
    stroke: color-mix(in srgb, var(--fill) 55%, black);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
    opacity: 0.8;
  }
  .q.is-selected .shape .body {
    stroke: #7dd3fc;
    stroke-width: 2;
  }
  /* block layout — matches DatabaseNode. Horizontal padding clears
     the left rim and the right end-cap curve. */
  .content {
    position: relative;
    display: block;
    padding: 14px 10% 14px 14%;
    box-sizing: border-box;
    height: 100%;
    overflow: hidden;
  }
  .kind {
    display: block;
    font-size: 9.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(248, 250, 252, 0.65);
    font-weight: 500;
    margin-bottom: 3px;
  }
  .label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
    letter-spacing: -0.005em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tech {
    display: block;
    font-size: 10px;
    color: rgba(248, 250, 252, 0.75);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    margin-top: 2px;
  }
  .desc {
    display: block;
    font-size: 11px;
    line-height: 1.35;
    color: rgba(248, 250, 252, 0.7);
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }
</style>
