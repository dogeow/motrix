import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aria2Task } from "@/lib/types";

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    rpcPort: 6800,
    rpcSecret: "test",
    downloadDir: "/downloads",
  }),
}));
vi.mock("@/lib/aria2", () => ({
  EngineUnavailableError: Error,
  Aria2Client: class {
    connected = true;
    call = call;
    connect() {}
    close() {}
    onStatus() {}
    onNotification() {}
  },
}));

function task(gid: string, status: Aria2Task["status"]): Aria2Task {
  return {
    gid,
    status,
    files: [],
    bittorrent: { info: { name: gid } },
  } as unknown as Aria2Task;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  call.mockReset();
  call.mockImplementation(async (method: string) =>
    method === "getGlobalStat"
      ? { numActive: "1", numWaiting: "1", numStopped: "0" }
      : []
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

async function setup() {
  const { useAppStore } = await import("./app");
  await useAppStore.getState().init();
  return useAppStore;
}

describe("task list refresh", () => {
  it("keeps hydrated HTTP names when clearing the old category during a switch", async () => {
    const store = await setup();
    const file = {
      index: "1",
      path: "/downloads/report.zip",
      length: "100",
      completedLength: "0",
      selected: "true",
      uris: [],
    };
    store.setState({
      tasks: [
        { ...task("http", "active"), bittorrent: undefined, files: [file] },
      ],
    });
    call.mockImplementation(async (method: string) => {
      if (method === "tellActive")
        return [{ ...task("http", "active"), bittorrent: undefined }];
      return method === "getGlobalStat" ? {} : [];
    });
    store.getState().setCategory("active");
    await store.getState().refresh();
    expect(store.getState().tasks[0].files).toEqual([file]);
    expect(call.mock.calls.some(([method]) => method === "tellStatus")).toBe(
      false
    );
  });

  it("never publishes the previous category after switching views", async () => {
    const active = deferred<Aria2Task[]>();
    call.mockImplementation(async (method: string) => {
      if (method === "tellActive") return active.promise;
      if (method === "tellWaiting") return [task("paused", "paused")];
      return method === "getGlobalStat" ? {} : [];
    });
    const store = await setup();
    const pending = store.getState().refresh();
    await Promise.resolve();
    store.getState().setCategory("waiting");
    expect(store.getState().loading).toBe(true);
    expect(store.getState().tasks).toEqual([]);
    const published: string[][] = [];
    const unsubscribe = store.subscribe((state) =>
      published.push(state.tasks.map((item) => item.gid))
    );
    active.resolve([task("active", "active")]);
    await pending;
    unsubscribe();
    expect(published.flat()).not.toContain("active");
    expect(store.getState().tasks.map((item) => item.gid)).toEqual(["paused"]);
    expect(store.getState().loading).toBe(false);
  });

  it("discards a stale A response after switching A → B → A", async () => {
    const old = deferred<Aria2Task[]>();
    let calls = 0;
    call.mockImplementation(async (method: string) => {
      if (method === "tellActive")
        return ++calls === 1 ? old.promise : [task("new", "active")];
      return method === "getGlobalStat" ? {} : [];
    });
    const store = await setup();
    const pending = store.getState().refresh();
    await Promise.resolve();
    store.getState().setCategory("waiting");
    store.getState().setCategory("all");
    const published: string[][] = [];
    const unsubscribe = store.subscribe((state) =>
      published.push(state.tasks.map((item) => item.gid))
    );
    old.resolve([task("old", "active")]);
    await pending;
    unsubscribe();
    expect(published.flat()).not.toContain("old");
    expect(store.getState().tasks[0].gid).toBe("new");
  });

  it("preserves starting markers for tasks outside the selected category", async () => {
    const store = await setup();
    store.getState().markStarting(["hidden"]);
    store.getState().setCategory("active");
    await store.getState().refresh();
    expect(store.getState().startingGids).toEqual(["hidden"]);
  });

  it("keeps the last snapshot on errors and clears the error after recovery", async () => {
    const store = await setup();
    store.setState({ tasks: [task("previous", "active")], loading: false });
    call.mockRejectedValueOnce(new Error("RPC failed"));
    await store.getState().refresh();
    expect(store.getState().tasks[0].gid).toBe("previous");
    expect(store.getState().refreshError).toBe("RPC failed");
    expect(store.getState().loading).toBe(false);
    await store.getState().refresh();
    expect(store.getState().refreshError).toBeNull();
  });
});
