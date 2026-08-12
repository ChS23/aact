/**
 * Bridge between custom Svelte Flow nodes (which can't receive
 * props from App.svelte directly — Svelte Flow only forwards
 * `data` / `selected` / `dragging`) and the app-level state.
 *
 * App.svelte registers a `ViewActions` object via `setContext`.
 * Node components read it via `getContext` and call back when
 * the user interacts. Decoupling actions from data keeps the
 * `data` payload serialisable and avoids node re-renders when
 * the parent re-assigns a callback identity.
 */
export interface ViewActions {
  selectElement(name: string): void;
  selectBoundary(name: string): void;
  /** Drill-mode descent — replace the current scope with this
   *  boundary's children. */
  enterBoundary(name: string, label: string): void;
  /** Expand-mode toggle — open/close the boundary inline without
   *  hiding parent siblings. No-op outside Expand mode. */
  toggleBoundary(name: string, label: string): void;
}

export const VIEW_ACTIONS = Symbol("aact-view:actions");
