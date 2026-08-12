import { watch, type FSWatcher } from "chokidar";

/**
 * Thin chokidar wrapper: watch the user's source file (PUML / DSL /
 * model-json), debounce rapid editor saves, fire one callback per
 * settled change.
 *
 * Debounce window: 80 ms. IDEs that save-on-format (VSCode, Cursor)
 * routinely emit two events ~40 ms apart — the first from the
 * write, the second from the formatter. A 80 ms tail collapses
 * them into a single re-load cycle.
 */
export interface WatcherOptions {
  readonly paths: readonly string[];
  readonly debounceMs?: number;
  readonly onChange: () => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export interface WatcherHandle {
  readonly close: () => Promise<void>;
}

export const startWatcher = (options: WatcherOptions): WatcherHandle => {
  const debounceMs = options.debounceMs ?? 80;
  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;
  let pending = false;

  const fire = async () => {
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    try {
      await options.onChange();
    } finally {
      inFlight = false;
      if (pending) {
        pending = false;
        // Coalesce: another change landed mid-load; re-fire once.
        queueMicrotask(() => void fire());
      }
    }
  };

  const watcher: FSWatcher = watch([...options.paths], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
  });

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void fire();
    }, debounceMs);
  };

  watcher.on("change", schedule);
  watcher.on("add", schedule);
  watcher.on("unlink", schedule);
  watcher.on("error", (error) => options.onError?.(error));

  return {
    close: async () => {
      if (timer) clearTimeout(timer);
      await watcher.close();
    },
  };
};
