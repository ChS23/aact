<script lang="ts">
  import { getContext } from "svelte";

  import { Handle, Position, type NodeProps } from "@xyflow/svelte";

  import { VIEW_ACTIONS, type ViewActions } from "./actions.ts";

  interface DatabaseNodeData {
    name: string;
    label: string;
    kind: string;
    description: string;
    external: boolean;
    technology: string;
  }

  let { data, selected }: NodeProps<{ data: DatabaseNodeData }> = $props();

  const actions = getContext<ViewActions>(VIEW_ACTIONS);

  // Database fill follows the C4 container/system gradient. Externals
  // drop to neutral grey per Simon Brown's reference palette so the
  // "ours vs theirs" distinction stays at a glance.
  const fill = $derived(data.external ? "#475569" : "#1168bd");

  // Split the camelCase kind (ContainerDb / SystemDb / ComponentDb) into
  // "<Tier> DB" so the uppercase chip reads as two words at a glance.
  const kindLabel = $derived(data.kind.replace(/Db$/, " DB"));
</script>

<div
  class="db"
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
  <!-- Canonical C4 database cylinder. Small (8%) top/bottom rim
       ellipses so the cylinder hint is unmistakable but doesn't eat
       the content area. preserveAspectRatio="none" + non-scaling
       stroke keeps the shape crisp at any ELK-assigned size. -->
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
      d="M 0 6 C 0 2 22 0 50 0 C 78 0 100 2 100 6 L 100 94 C 100 98 78 100 50 100 C 22 100 0 98 0 94 Z"
    />
    <path
      class="rim"
      d="M 0 6 C 0 10 22 12 50 12 C 78 12 100 10 100 6"
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
  .db {
    position: relative;
    width: 100%;
    height: 100%;
    color: #f8fafc;
    cursor: pointer;
    box-sizing: border-box;
    transition: filter 100ms ease;
  }
  .db:hover {
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
  .db.is-selected .shape .body {
    stroke: #7dd3fc;
    stroke-width: 2;
  }
  /* Content sits inside the cylindrical body. Top padding clears the
     rim ellipse; horizontal padding matches ElementNode so text reads
     identically across node kinds. block display (not webkit-box) on
     truncating children — flex column + line-clamp collapses them to
     zero height otherwise. */
  /* block layout — flex column shrinks the single-line label below its
     line-height for some reason; block keeps each child at its
     natural height. Top padding clears the rim ellipse; bottom
     padding clears the bottom curve. */
  .content {
    position: relative;
    display: block;
    padding: 14% 14px 16%;
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
