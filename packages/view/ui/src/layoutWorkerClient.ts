import ELK from "elkjs/lib/elk.bundled.js";

/**
 * Why ELK runs on the main thread:
 *
 * `elkjs/lib/elk.bundled.js` internally spawns its own compute
 * kernel as a Web Worker via `require('./elk-worker.min.js')`.
 * That `require()` is dynamic UMD plumbing which Vite cannot
 * trace through, so when we wrap ELK in our OWN Worker the
 * bundled output ends up with `e('./elk-worker.min.js').Worker`
 * resolving to undefined → `new undefined()` → `TypeError: o is
 * not a constructor` at runtime. We tried `worker.format: "es"`
 * + `?worker` import; same failure.
 *
 * Layout performance for the model sizes aact view targets (50
 * nodes / 100 relations sub-second) doesn't justify the extra
 * infra to inline ELK's nested worker. If we ever need it we'll
 * either ship `elk-worker.min.js` as a separately-served asset
 * (`?url` import + `new ELK({ workerUrl })`) or vendor the
 * synchronous Java→JS fallback path. For now: in-process.
 */
const elk = new ELK();

export const runElkLayout = <T>(graph: unknown): Promise<T> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ELK input types are deeply structural; the call sites already pass typed nodes/edges
  elk.layout(graph as any) as Promise<T>;
