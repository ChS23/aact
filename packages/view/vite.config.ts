import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

/**
 * Vite build for the workbench SPA. Output goes to `dist/ui/`, which
 * the h3 server serves as a static asset directory at runtime. The
 * compiled `dist/ui/index.html` is read on first request and inlined
 * into the response so the server can drop the entire UI dependency
 * once the page is in the user's browser tab.
 *
 * `base: "./"` produces relative asset paths inside the built HTML
 * — the server can mount the bundle under any URL prefix without
 * rewriting (`http://localhost:<port>/`, `/aact-view/` behind a
 * proxy, etc.).
 */
export default defineConfig({
  plugins: [svelte()],
  root: "ui",
  base: "./",
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    // ELK ships as one prebundled layout engine chunk. We isolate it
    // via manualChunks below; keep the warning threshold just above
    // today's ELK vendor size so unrelated growth still shows up.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Group every Svelte Flow / elkjs chunk under one vendor
        // chunk so the SPA loads as two files instead of a dozen
        // — cuts cold-start round-trips on the workbench HTTP
        // server (localhost, but every connection still pays a
        // few-ms setup tax).
        manualChunks: (id) => {
          if (id.includes("node_modules/@xyflow")) return "xyflow";
          if (id.includes("node_modules/elkjs")) return "elk";
          if (id.includes("node_modules/svelte")) return "svelte";
          return undefined;
        },
      },
    },
  },
});
