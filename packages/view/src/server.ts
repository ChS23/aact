import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AnalysisReport, DiffData, Model } from "aact";
import { H3, defineWebSocketHandler, toNodeHandler } from "h3";
import { listen, type CrossWSOptions, type Listener } from "listhen";

import type { ModelLoadResult } from "./load-model.js";

/**
 * Resolve the bundled SPA dist relative to this module so the path
 * survives both the source tree (`packages/view/dist/ui/`) and the
 * post-publish layout (`<install>/node_modules/@aact/view/dist/ui/`).
 * Computed from `import.meta.url` because aact uses pure ESM —
 * `__dirname` is unavailable.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(HERE, "ui");

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const mimeFor = (file: string): string =>
  MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

/**
 * The envelope shape the server pushes over `/api/ws` and returns
 * from `/api/model`. Mirrors aact's `CliEnvelope<ModelData>` enough
 * that the client can treat them interchangeably — the workbench
 * adds no second contract.
 */
export interface ModelEnvelope {
  readonly schemaVersion: 1;
  readonly command: "view";
  readonly ok: boolean;
  readonly exitCode: 0 | 1 | 2;
  readonly data: {
    readonly model: ModelLoadResult["model"];
    readonly issues: readonly ModelLoadResult["issues"][number][];
    /** Architecture metrics from `analyzeArchitecture(model,
     *  config.analyze)`. The UI's optional "Analyze" overlay reads
     *  this — when disabled, the field is still populated, just
     *  hidden. Keeping it on the envelope avoids a second round-trip
     *  to compute it from the SPA's worker. */
    readonly analysis: AnalysisReport;
    /** Diff result against the baseline loaded at boot. Present
     *  only when `aact view --diff <baseline>` is in effect. The
     *  SPA colors current graph nodes/relations and keeps removed
     *  baseline-only items visible in the sidebar change list. */
    readonly diff?: {
      readonly baselineModel: Model;
      readonly data: DiffData;
    };
  };
  readonly diagnostics: readonly never[];
  readonly meta: {
    readonly aactVersion: string;
    readonly durationMs: number;
    readonly configPath: string | null;
    readonly source: string | null;
  };
}

export interface ViewError {
  readonly message: string;
  readonly source: string | null;
  readonly configPath: string | null;
  readonly durationMs: number;
  readonly at: string;
}

export type ServerMessage =
  | { readonly type: "model-update"; readonly envelope: ModelEnvelope }
  | { readonly type: "model-error"; readonly error: ViewError };

/** Subscriber callback type — the workbench pushes a fresh envelope
 *  to every subscriber whenever chokidar reports a source change. */
export type Subscriber = (message: ServerMessage) => void;

export interface ServerHandle {
  readonly listener: Listener;
  readonly url: string;
  /** Register a callback that fires on every model update. Returns
   *  an unsubscribe function. */
  subscribe(fn: Subscriber): () => void;
  /** Push a fresh envelope to every connected client. */
  broadcast(envelope: ModelEnvelope): void;
  /** Push a reload failure while keeping the latest valid model cached. */
  broadcastError(error: ViewError): void;
  /** Update the cached envelope so new HTTP `/api/model` hits return
   *  the latest known model without re-loading from disk. */
  setCurrent(envelope: ModelEnvelope): void;
  close(): Promise<void>;
}

export interface ServerOptions {
  readonly port?: number;
  /** Skip `listhen`'s automatic browser open — useful when the
   *  workbench is driven from CI or an editor extension. */
  readonly noOpen?: boolean;
  /** Initial envelope to serve immediately. The watcher will
   *  replace it via `setCurrent` whenever the source changes. */
  readonly initialEnvelope: ModelEnvelope;
  /** Per-session token protecting local JSON / WS endpoints from
   *  unrelated browser pages hitting localhost. */
  readonly authToken: string;
}

export const viewAuthState = (
  url: URL,
  headers: Headers,
  authToken: string,
): { readonly ok: boolean; readonly shouldSetCookie: boolean } => {
  const rawCookie = headers.get("cookie") ?? "";
  const viaQuery = url.searchParams.get("token") === authToken;
  const viaCookie = rawCookie
    .split(";")
    .map((part) => part.trim())
    .some((part) => part === `aact_view_token=${authToken}`);
  return { ok: viaQuery || viaCookie, shouldSetCookie: viaQuery };
};

/**
 * Bring up the local workbench HTTP server.
 *
 * Routes:
 *   - `GET /`           — inline HTML page (Phase 1 placeholder; the
 *                          Svelte SPA replaces it in Phase 3).
 *   - `GET /api/model`  — current `ModelEnvelope`, JSON.
 *   - `GET /api/ws`     — WebSocket channel pushing `{type:"model-update", envelope}`
 *                          payloads on every chokidar event.
 *
 * The h3 app keeps a per-client subscriber list keyed by peer; the
 * watcher (in `runWorkbench`) calls `broadcast()` to notify the SPA
 * after each successful `loadModelFromConfig`.
 */
export const startServer = async (
  options: ServerOptions,
): Promise<ServerHandle> => {
  let current: ModelEnvelope = options.initialEnvelope;
  const subscribers = new Set<Subscriber>();
  const peers = new Set<{ send: (data: string) => void }>();
  const authCookie = `aact_view_token=${options.authToken}; Path=/; SameSite=Strict; HttpOnly`;

  const authState = (
    url: URL,
    headers: Headers,
  ): { readonly ok: boolean; readonly shouldSetCookie: boolean } =>
    viewAuthState(url, headers, options.authToken);

  const isAuthorized = (url: URL, headers: Headers): boolean =>
    authState(url, headers).ok;

  const parseRequestUrl = (input: string): URL =>
    new URL(input, "http://localhost");

  // `listhen` opens its `baseURL` itself when `open: true`. Put the
  // per-session token there rather than appending it after `listen()`
  // returns; otherwise the browser opens an unauthorised bare URL.
  const authBaseUrl = `/?token=${encodeURIComponent(options.authToken)}`;

  const unauthorized = (): Response =>
    new Response("Unauthorized", {
      status: 401,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });

  const htmlHeaders = (
    contentType: string,
    setCookie: boolean,
  ): Readonly<Record<string, string>> => ({
    "content-type": contentType,
    ...(setCookie ? { "set-cookie": authCookie } : {}),
  });

  const sendToSubscribers = (message: ServerMessage): void => {
    for (const fn of subscribers) {
      try {
        fn(message);
      } catch {
        // Subscriber threw — don't let one bad listener stop the
        // others from receiving the update.
      }
    }
  };

  const sendToPeers = (message: ServerMessage): void => {
    const payload = JSON.stringify(message);
    for (const peer of peers) {
      try {
        peer.send(payload);
      } catch {
        // Peer dropped mid-broadcast; CrossWS will report `close`
        // / `error` next tick so just skip it here.
      }
    }
  };

  const webSocketHooks = {
    upgrade(request: Request) {
      const url = parseRequestUrl(request.url);
      if (!isAuthorized(url, request.headers)) return unauthorized();
    },
    open(peer: { send: (data: string) => void }) {
      peers.add(peer);
      // Send the latest known envelope right away so a freshly
      // opened tab doesn't have to wait for the next watcher event
      // to populate.
      peer.send(JSON.stringify({ type: "model-update", envelope: current }));
    },
    close(peer: { send: (data: string) => void }) {
      peers.delete(peer);
    },
    error(peer: { send: (data: string) => void }) {
      peers.delete(peer);
    },
  };

  const resolveWebSocketHooks: NonNullable<CrossWSOptions["resolve"]> = (
    request,
  ) => {
    const url = parseRequestUrl(request.url);
    if (url.pathname !== "/api/ws") {
      return {
        upgrade: () =>
          new Response("Not Found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
      };
    }
    return webSocketHooks;
  };

  const app = new H3();

  app.get("/api/model", (event) => {
    const url = parseRequestUrl(event.req.url);
    if (!isAuthorized(url, event.req.headers)) return unauthorized();
    return current;
  });

  app.get("/api/ws", defineWebSocketHandler(webSocketHooks));

  // Serve the pre-built Svelte SPA from `dist/ui/`. Resolve each
  // request path against the bundle dir, fall back to `index.html`
  // for client-side routes (Svelte Flow drill-down is in-app, but
  // a deep link / refresh hits `/something` and we want to bring
  // the SPA up regardless). Aggressive directory traversal blocked
  // by re-resolving and asserting the path stays under UI_ROOT.
  const serveAsset = async (
    requestPath: string,
  ): Promise<{ body: Buffer; contentType: string } | null> => {
    const clean = requestPath.replace(/^\/+/, "").split("?")[0] ?? "";
    const relative = clean === "" ? "index.html" : clean;
    const candidate = path.resolve(UI_ROOT, relative);
    if (!isInside(UI_ROOT, candidate)) return null;
    try {
      const body = await readFile(candidate);
      return { body, contentType: mimeFor(candidate) };
    } catch {
      return null;
    }
  };

  app.get("/", async (event) => {
    const url = parseRequestUrl(event.req.url);
    const auth = authState(url, event.req.headers);
    if (!auth.ok) return unauthorized();
    const asset = await serveAsset("index.html");
    if (!asset) {
      return new Response(
        "aact view UI bundle is missing — run `pnpm --filter @aact/view build:ui`.",
        {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8" },
        },
      );
    }
    return new Response(asset.body, {
      headers: htmlHeaders(asset.contentType, auth.shouldSetCookie),
    });
  });

  app.get("/**:path", async (event) => {
    const url = parseRequestUrl(event.req.url);
    if (url.pathname.startsWith("/api/")) {
      return new Response("Not Found", { status: 404 });
    }
    const auth = authState(url, event.req.headers);
    if (!auth.ok) return unauthorized();
    const asset = await serveAsset(url.pathname);
    if (asset) {
      return new Response(asset.body, {
        headers: htmlHeaders(asset.contentType, auth.shouldSetCookie),
      });
    }
    // SPA fallback — let the client route in-app.
    const indexAsset = await serveAsset("index.html");
    if (!indexAsset) return new Response("Not Found", { status: 404 });
    return new Response(indexAsset.body, {
      headers: htmlHeaders(indexAsset.contentType, auth.shouldSetCookie),
    });
  });

  const listener = await listen(toNodeHandler(app), {
    port: options.port,
    baseURL: authBaseUrl,
    open: options.noOpen ? false : true,
    showURL: false,
    qr: false,
    public: false,
    ws: { resolve: resolveWebSocketHooks },
  });

  const url = listener.url;

  return {
    listener,
    url,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    broadcast(envelope) {
      current = envelope;
      const message = { type: "model-update", envelope } as const;
      sendToPeers(message);
      sendToSubscribers(message);
    },
    broadcastError(error) {
      const message = { type: "model-error", error } as const;
      sendToPeers(message);
      sendToSubscribers(message);
    },
    setCurrent(envelope) {
      current = envelope;
    },
    close() {
      return listener.close();
    },
  };
};
