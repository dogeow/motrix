/** Coalesce polling and push events into one running refresh and one follow-up. */
export function createRefreshQueue(refresh: () => Promise<void>) {
  let running: Promise<void> | null = null;
  let requested = false;

  return function requestRefresh(): Promise<void> {
    requested = true;
    if (!running) {
      running = Promise.resolve().then(async () => {
        try {
          while (requested) {
            requested = false;
            await refresh();
          }
        } finally {
          running = null;
        }
      });
    }
    return running;
  };
}
