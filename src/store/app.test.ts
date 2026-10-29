import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Aria2File, Aria2Task, GlobalStat } from "@/lib/types";

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
    totalLength: "100",
    completedLength: "0",
    uploadLength: "0",
    downloadSpeed: "0",
    uploadSpeed: "0",
    connections: "0",
    dir: "/downloads",
    files: [],
    bittorrent: { info: { name: gid } },
  };
}
function downloadFile(path: string): Aria2File {
  return {
    index: "1",
    path,
    length: "100",
    completedLength: "0",
    selected: "true",
    uris: [],
  };
}
const globalStat: GlobalStat = {
  downloadSpeed: "0",
  uploadSpeed: "0",
  numActive: "1",
  numWaiting: "1",
  numStopped: "0",
};
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
      ? { ...globalStat }
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
  it("does not notify subscribers for an unchanged polling snapshot", async () => {
    const store = await setup();
    call.mockImplementation(async (method: string) => {
      if (method === "tellActive") return [task("download", "active")];
      return method === "getGlobalStat" ? { ...globalStat } : [];
    });
    await store.getState().refresh();
    const previous = store.getState();
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    await store.getState().refresh();
    unsubscribe();
    expect(subscriber).not.toHaveBeenCalled();
    expect(store.getState()).toBe(previous);
  });

  it("reuses unchanged task objects when a peer's progress changes", async () => {
    const store = await setup();
    let completedLength = "0";
    call.mockImplementation(async (method: string) => {
      if (method === "tellActive") {
        return [
          task("unchanged", "active"),
          { ...task("progress", "active"), completedLength },
        ];
      }
      return method === "getGlobalStat" ? { ...globalStat } : [];
    });
    await store.getState().refresh();
    const previous = store.getState();
    completedLength = "50";
    await store.getState().refresh();
    const next = store.getState();
    expect(next.tasks).not.toBe(previous.tasks);
    expect(next.tasks.find((item) => item.gid === "unchanged")).toBe(
      previous.tasks.find((item) => item.gid === "unchanged")
    );
    expect(next.tasks.find((item) => item.gid === "progress")).toMatchObject({
      completedLength: "50",
    });
    expect(next.stat).toBe(previous.stat);
    expect(next.startingGids).toBe(previous.startingGids);
  });

  it("publishes nested torrent-name changes without losing hydrated files", async () => {
    const store = await setup();
    let name = "original";
    call.mockImplementation(async (method: string) => {
      if (method === "tellActive") {
        return [
          { ...task("torrent", "active"), bittorrent: { info: { name } } },
        ];
      }
      return method === "getGlobalStat" ? { ...globalStat } : [];
    });
    store.setState({
      tasks: [
        {
          ...task("torrent", "active"),
          files: [downloadFile("/downloads/a")],
        },
      ],
    });
    await store.getState().refresh();
    const previous = store.getState().tasks[0];
    name = "renamed";
    await store.getState().refresh();
    const next = store.getState().tasks[0];
    expect(next).not.toBe(previous);
    expect(next.bittorrent?.info?.name).toBe("renamed");
    expect(next.files).toBe(previous.files);
  });

  it("updates global statistics without replacing unchanged tasks", async () => {
    const store = await setup();
    let downloadSpeed = "0";
    call.mockImplementation(async (method: string) => {
      if (method === "tellActive") return [task("download", "active")];
      return method === "getGlobalStat" ? { ...globalStat, downloadSpeed } : [];
    });
    await store.getState().refresh();
    const previous = store.getState();
    downloadSpeed = "4096";
    await store.getState().refresh();
    expect(store.getState().stat?.downloadSpeed).toBe("4096");
    expect(store.getState().tasks).toBe(previous.tasks);
  });

  it("hydrates names in bounded parallel batches without duplicate requests", async () => {
    const store = await setup();
    const details = new Map<
      string,
      ReturnType<typeof deferred<{ files: Aria2File[] }>>
    >();
    call.mockImplementation(async (method: string, gid?: string) => {
      if (method === "tellActive") {
        return Array.from({ length: 10 }, (_, index) => ({
          ...task(`http-${index}`, "active"),
          bittorrent: undefined,
        }));
      }
      if (method === "tellStatus") {
        const detail = deferred<{ files: Aria2File[] }>();
        details.set(gid!, detail);
        return detail.promise;
      }
      return method === "getGlobalStat" ? { ...globalStat } : [];
    });
    await store.getState().refresh();
    expect(details.size).toBe(8);
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    await store.getState().refresh();
    expect(
      call.mock.calls.filter(([method]) => method === "tellStatus")
    ).toHaveLength(8);
    expect(subscriber).not.toHaveBeenCalled();
    for (const [gid, detail] of details) {
      detail.resolve({ files: [downloadFile(`/downloads/${gid}.zip`)] });
    }
    await vi.waitFor(() => {
      expect(
        store.getState().tasks.filter((item) => item.files.length)
      ).toHaveLength(8);
    });
    expect(subscriber).toHaveBeenCalledTimes(1);
    unsubscribe();
    await store.getState().refresh();
    expect(details.size).toBe(10);
    for (const [gid, detail] of details) {
      detail.resolve({ files: [downloadFile(`/downloads/${gid}.zip`)] });
    }
    await vi.waitFor(() => {
      expect(
        store.getState().tasks.every((item) => item.files.length === 1)
      ).toBe(true);
    });
  });

  it("rotates failed name lookups so later HTTP tasks still get names", async () => {
    const store = await setup();
    const lookedUp: string[] = [];
    call.mockImplementation(async (method: string, gid?: string) => {
      if (method === "tellActive") {
        return Array.from({ length: 10 }, (_, index) => ({
          ...task(`http-${index}`, "active"),
          bittorrent: undefined,
        }));
      }
      if (method === "tellStatus") {
        lookedUp.push(gid!);
        if (Number(gid!.split("-")[1]) >= 2) throw new Error("Missing files");
        return { files: [downloadFile(`/downloads/${gid}.zip`)] };
      }
      return method === "getGlobalStat" ? { ...globalStat } : [];
    });
    await store.getState().refresh();
    expect(lookedUp).toHaveLength(8);
    await store.getState().refresh();
    await vi.waitFor(() => {
      expect(
        store.getState().tasks.find((item) => item.gid === "http-0")?.files[0]
          ?.path
      ).toBe("/downloads/http-0.zip");
      expect(
        store.getState().tasks.find((item) => item.gid === "http-1")?.files[0]
          ?.path
      ).toBe("/downloads/http-1.zip");
    });
  });

  it("discards stale name hydration after switching categories", async () => {
    const store = await setup();
    const oldDetail = deferred<{ files: Aria2File[] }>();
    let detailCalls = 0;
    call.mockImplementation(async (method: string) => {
      if (method === "tellActive" || method === "tellWaiting") {
        return [
          {
            ...task("http", method === "tellActive" ? "active" : "paused"),
            bittorrent: undefined,
          },
        ];
      }
      if (method === "tellStatus") {
        detailCalls += 1;
        return detailCalls === 1
          ? oldDetail.promise
          : { files: [downloadFile("/downloads/current.zip")] };
      }
      return method === "getGlobalStat" ? { ...globalStat } : [];
    });
    store.getState().setCategory("active");
    await store.getState().refresh();
    store.getState().setCategory("waiting");
    await store.getState().refresh();
    const subscriber = vi.fn();
    const unsubscribe = store.subscribe(subscriber);
    oldDetail.resolve({ files: [downloadFile("/downloads/stale.zip")] });
    // Allow the detached hydration promise to finish without another refresh.
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
    expect(subscriber).not.toHaveBeenCalled();
    expect(store.getState().tasks[0].files).toEqual([]);
    unsubscribe();
    await store.getState().refresh();
    await vi.waitFor(() => {
      expect(store.getState().tasks[0].files[0]?.path).toBe(
        "/downloads/current.zip"
      );
    });
  });

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
